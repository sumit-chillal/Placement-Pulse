from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List
import uuid
from datetime import datetime, timezone
import firebase_admin
from firebase_admin import credentials, messaging
import json


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Placement jobs live in MongoDB Atlas (written by the Express sync pipeline).
placement_client = AsyncIOMotorClient(os.environ['PLACEMENT_MONGO_URI'])
placement_db = placement_client[os.environ.get('PLACEMENT_DB_NAME', 'placement_scraper')]
placement_jobs = placement_db[os.environ.get('PLACEMENT_COLLECTION', 'jobs')]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")  # Ignore MongoDB's _id field
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str


# ── Firebase Admin (lazy) for FCM topic subscription ──────────────────────
FCM_TOPIC = os.environ.get('FCM_TOPIC', 'placement_alerts')
_fb_app = None


def _get_firebase():
    global _fb_app

    if _fb_app is not None:
        return _fb_app

    # Railway: JSON stored as an environment variable
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")

    if service_account_json:
        cred = credentials.Certificate(json.loads(service_account_json))
        _fb_app = firebase_admin.initialize_app(cred)
        return _fb_app

    # Local development: JSON file
    path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")

    if path and os.path.exists(path):
        cred = credentials.Certificate(path)
        _fb_app = firebase_admin.initialize_app(cred)
        return _fb_app

    raise RuntimeError("Firebase service account not configured")


class TokenIn(BaseModel):
    token: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    
    # Convert to dict and serialize datetime to ISO string for MongoDB
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    # Exclude MongoDB's _id field from the query results
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps back to datetime objects
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    
    return status_checks


def _serialize_job(doc: dict) -> dict:
    """Recursively make a Mongo doc JSON-safe (ObjectId -> str, datetime -> iso)."""
    from bson import ObjectId

    def clean(v):
        if isinstance(v, ObjectId):
            return str(v)
        if isinstance(v, datetime):
            return v.isoformat()
        if isinstance(v, list):
            return [clean(i) for i in v]
        if isinstance(v, dict):
            return {k: clean(val) for k, val in v.items() if k != "_id"}
        return v

    doc.pop("_id", None)
    return {k: clean(val) for k, val in doc.items()}


@api_router.get("/jobs")
async def get_jobs(page: int = 1, limit: int = 50, include_expired: bool = False):
    """Active placement listings, sorted chronologically by endDateISO.
    Expired drives are hidden by default; drives with unknown dates are kept."""
    page = max(1, page)
    limit = min(200, max(1, limit))

    query: dict = {}
    if not include_expired:
        start_of_today = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        query = {"$or": [{"endDateISO": {"$gte": start_of_today}}, {"endDateISO": None}]}

    total = await placement_jobs.count_documents(query)
    cursor = (
        placement_jobs.find(query)
        .sort([("endDateISO", 1), ("companyName", 1)])
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = [_serialize_job(doc) async for doc in cursor]

    return {
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": (total + limit - 1) // limit,
        "count": len(items),
        "data": items,
    }

@api_router.post("/subscribe")
async def subscribe(body: TokenIn):
    """Auto-register a visitor's FCM token to the global placement topic."""
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token is required")
    try:
        _get_firebase()
        resp = messaging.subscribe_to_topic([token], FCM_TOPIC)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FCM subscribe failed: {e}")
    return {
        "topic": FCM_TOPIC,
        "successCount": resp.success_count,
        "failureCount": resp.failure_count,
        "errors": [{"index": err.index, "reason": err.reason} for err in resp.errors],
    }


@api_router.post("/unsubscribe")
async def unsubscribe(body: TokenIn):
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token is required")
    try:
        _get_firebase()
        resp = messaging.unsubscribe_from_topic([token], FCM_TOPIC)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FCM unsubscribe failed: {e}")
    return {
        "topic": FCM_TOPIC,
        "successCount": resp.success_count,
        "failureCount": resp.failure_count,
    }

@api_router.post("/test-notification")
async def send_test_notification():
    """
    Send a test notification to every device subscribed to the
    placement_alerts topic.
    """
    try:
        _get_firebase()

        message = messaging.Message(
            notification=messaging.Notification(
                title="🎉 Placement Pulse",
                body="Push notifications are working successfully!",
            ),
            data={
                "type": "test",
                "title": "Placement Pulse",
                "body": "Push notifications are working successfully!"
            },
            topic=FCM_TOPIC,
        )

        message_id = messaging.send(message)

        return {
            "success": True,
            "message": "Notification sent successfully.",
            "messageId": message_id,
            "topic": FCM_TOPIC,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send notification: {str(e)}",
        )

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()