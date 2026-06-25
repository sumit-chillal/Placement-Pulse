# 🚀 Automated Placement Portal Tracker

An intelligent, full-stack Progressive Web App (PWA) designed to automate the extraction, structuring, and broadcasting of placement drives from the Canara Engineering College placement portal. 

This project completely eliminates the need for manual portal checking by combining headless browser automation, zero-knowledge AI data parsing, and real-time push notifications into a seamless background worker pipeline.

---

## 💡 The Core Concept

Manual tracking of academic placement portals often leads to delayed applications, missed deadlines, and high user friction. This system introduces an automated, set-and-forget ecosystem that treats the placement portal as a dynamic data stream:

1. **Autonomous Retrieval:** Instead of forcing students to log in repeatedly, a background worker monitors the portal at dynamic intervals.
2. **Deterministic Structuring:** Raw, erratic HTML text layouts are transformed into predictable, clean JSON datasets using lightweight Large Language Models.
3. **Instant Dissemination:** New updates are pushed directly to user lock-screens via system-level push notifications the moment they are published.

---

## ✨ Key Features

* **Dynamic High-Frequency Extraction:** Automated scraping via Puppeteer and `node-cron`, scaling intelligently between 30-minute daytime intervals and 2-hour nighttime intervals to preserve portal server integrity.
* **Zero-Knowledge AI Parsing:** Utilizes the Google Gen AI SDK (Gemini 2.5 Flash) with strict JSON schema enforcement to clean unstructured raw HTML into normalized records (handling edge cases and missing fields gracefully).
* **Real-Time Push Infrastructure:** Broadcasts instant lock-screen alerts to subscribers for newly identified placement drives using Firebase Cloud Messaging (FCM HTTP v1 API).
* **Glassmorphism PWA Frontend:** A sleek, mobile-first React interface featuring 60FPS local memory filtering (by company, criteria, and deadlines) and a persistent local storage cache for offline viewing.
* **Resilient Error Monitoring:** Integrated Discord Webhook alerts that trigger automatically after 3 consecutive scraping failures to instantly notify administrators of target DOM mutations.

---

## 🏗️ System Architecture & Data Flow
[Placement Portal]
│ (Puppeteer Scraper / Node-Cron)
▼
[Raw HTML/Text Container]
│ (Gemini 2.5 Flash API + Strict JSON Schema)
▼
[Normalized JSON Object]
│ (MD5 Hash Diffing Engine: companyName + endDate)
├─► [Duplicate Found] ──► Drop / Skip
│
└─► [New Entry Found] ──► Write to MongoDB Atlas
│
▼
[FCM HTTP v1 Topic Broadcast]
│
▼
[React PWA Client Notification]


1. **Extraction:** The worker navigates the portal in an incognito context, processes the target authentication walls, and extracts raw text payload containers.
2. **Structuring:** The raw text payload is passed to Gemini 2.5 Flash, which standardizes variables like Company Name, Job Role, CTC, Eligibility Criteria, Selection Workflow, and Deadlines.
3. **Diffing & Storage:** The backend generates a unique MD5 hash for the record. If the hash does not exist in MongoDB Atlas, it is recognized as a new placement drive.
4. **Broadcast:** Upon a successful database write, the Express server triggers an administrative broadcast to the client-subscribed `placement_alerts` Firebase topic.
5. **Consumption:** The React PWA pulls the consolidated state from the REST API (`GET /api/jobs`) and presents it in an optimized interface with local-first filtering mechanisms.

---

## 🛠️ Tech Stack Matrix

### Frontend (Client)
* **Framework:** React.js (Hooks, Context API)
* **Styling:** Tailwind CSS (Modern Glassmorphic utility tokens)
* **Service Layer:** Firebase Client Web SDK & Native Service Workers
* **Capabilities:** Progressive Web App (PWA) Manifest for mobile home-screen installation

### Backend (Server & Micro-Worker)
* **Runtime:** FastAPI
* **Automation:** Puppeteer (Headless Browser Chromium instance)
* **Orchestration:** `node-cron` (Cron-pattern scheduler)
* **Intelligence Layer:** Google Gen AI SDK (Gemini-2.5-Flash)
* **Push Services:** Firebase Admin SDK (FCM Topic Messaging)

### Database & Storage
* **Engine:** MongoDB Atlas
* **ODM:** Mongoose (Strict data schema definition)

---

## 👨‍💻 Author
Developed by **Sumit**