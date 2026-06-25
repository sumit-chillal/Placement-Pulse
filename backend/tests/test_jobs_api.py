"""Backend API tests for GET /api/jobs and /manifest.json + /sw.js (PWA assets).

These tests hit the public REACT_APP_BACKEND_URL (FastAPI on :8001 behind ingress).
"""
import os
import re
import json
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://cron-web-harvester.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# ---------- GET /api/jobs ----------
class TestJobsEndpoint:
    def test_jobs_returns_200_and_envelope_shape(self, client):
        r = client.get(f"{BASE_URL}/api/jobs", timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("page", "limit", "total", "totalPages", "count", "data"):
            assert key in body, f"missing key {key} in response"
        assert isinstance(body["data"], list)
        assert body["count"] == len(body["data"])
        assert body["page"] == 1
        assert body["limit"] == 50

    def test_jobs_default_hides_expired(self, client):
        r_default = client.get(f"{BASE_URL}/api/jobs", timeout=30)
        r_expired = client.get(f"{BASE_URL}/api/jobs?includeExpired=true", timeout=30)
        assert r_default.status_code == 200
        assert r_expired.status_code == 200
        total_default = r_default.json()["total"]
        total_expired = r_expired.json()["total"]
        # includeExpired should return more or equal
        assert total_expired >= total_default, (
            f"includeExpired total ({total_expired}) should be >= default total ({total_default})"
        )

    def test_each_job_has_required_fields(self, client):
        r = client.get(f"{BASE_URL}/api/jobs?includeExpired=true&limit=50", timeout=30)
        assert r.status_code == 200
        data = r.json()["data"]
        assert len(data) > 0, "expected at least one job in collection"
        required = [
            "companyName", "ctc", "description",
            "eligibilityCriteria", "selectionWorkflow",
            "registrationLink", "startDate", "endDate",
            "startDateISO", "endDateISO",
        ]
        for job in data:
            for f in required:
                assert f in job, f"job missing field '{f}': {job.get('companyName')}"
            assert isinstance(job["eligibilityCriteria"], list)
            assert isinstance(job["selectionWorkflow"], list)
            # registrationLink is string or null
            assert job["registrationLink"] is None or isinstance(job["registrationLink"], str)
            # _id should not leak
            assert "_id" not in job, "Mongo _id leaked into response"

    def test_chronological_sort_by_endDateISO(self, client):
        r = client.get(f"{BASE_URL}/api/jobs?includeExpired=true&limit=100", timeout=30)
        data = r.json()["data"]
        # Build list of (endDateISO or None) preserving order; nulls allowed but
        # non-null values must be non-decreasing.
        prev = None
        for job in data:
            cur = job.get("endDateISO")
            if cur is None:
                continue
            if prev is not None:
                assert cur >= prev, f"Out of order: {prev} then {cur}"
            prev = cur

    def test_blueflame_has_multi_step_workflow(self, client):
        r = client.get(f"{BASE_URL}/api/jobs?includeExpired=true&limit=100", timeout=30)
        data = r.json()["data"]
        blueflame = [j for j in data if "blueflame" in (j.get("companyName") or "").lower()]
        assert blueflame, "Expected a Blueflame Labs drive in dataset"
        assert len(blueflame[0]["selectionWorkflow"]) >= 2, (
            f"Blueflame workflow should have multiple steps, got {blueflame[0]['selectionWorkflow']}"
        )

    def test_pagination_params_respected(self, client):
        r = client.get(f"{BASE_URL}/api/jobs?page=1&limit=2&includeExpired=true", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["limit"] == 2
        assert len(body["data"]) <= 2


# ---------- PWA assets ----------
class TestPWAAssets:
    def test_manifest_served_and_valid(self, client):
        r = client.get(f"{BASE_URL}/manifest.json", timeout=15)
        assert r.status_code == 200
        # Manifest should be JSON-parseable
        body = json.loads(r.text)
        assert "name" in body
        assert body.get("display") == "standalone"
        assert body.get("start_url")
        sizes = {i.get("sizes") for i in body.get("icons", [])}
        assert "192x192" in sizes
        assert "512x512" in sizes

    def test_service_worker_served(self, client):
        r = client.get(f"{BASE_URL}/sw.js", timeout=15)
        assert r.status_code == 200
        assert len(r.text) > 0
