# Construction Vision — AI-Driven Construction Site Safety & Structural Inspection

An industrial computer-vision inspection platform for **Structural Crack Detection**, **Worker Safety Helmet Detection**, **Combined Site Inspection**, **Live Browser Camera Monitoring**, **Persistent SQLite History**, and **Automated PDF Inspection Reports**.

---

## 1. Architecture Overview

Construction Vision supports two interoperable execution modes:

1. **Primary Web Runtime (Node.js + Express + React + TypeScript + SQLite)**
   - Runs on port `3000` with Vite in development and bundled `server.js` + `dist/` in production.
   - Executes real multimodal AI inference server-side via `@google/genai` (`gemini-4-hydrogen`) returning structured normalized bounding boxes (`box_2d` in `0..1000` scale), object categories, classifications, model-reported confidence scores, and AI-estimated crack severity.
   - Composites color-coded bounding boxes server-side with `sharp`, persists original/annotated images and PDF reports via a configurable `StorageProvider` (`local` persistent disk or `s3` object storage), and stores inspection history in SQLite (`better-sqlite3`).

2. **Deployable Python AI Backend (`backend/` — FastAPI + OpenCV + Ultralytics YOLO)**
   - Preserves and upgrades the original CrackVision AI modules (`crack_detection.py`, `image_processor.py`, `camera.py`) and adds `helmet_detection.py`, `inspection_service.py`, `report_generator.py`, `database.py`, and `main.py`.
   - Can be deployed alongside GPU/CPU workers and linked directly via **Settings > External Python FastAPI + YOLO URL** (or `PYTHON_BACKEND_URL`).

---

## 2. Inspection Modes & Detection Rules

- **Structural Crack Detection (`POST /api/inspect/cracks`)**
  - Detects visible concrete/masonry cracks with Yellow (`#FACC15`) bounding boxes, model-reported confidence, and AI-estimated severity (`Low`, `Medium`, `High`).
  - *Disclaimer*: Confidence scores are model-reported certainty (not calibrated accuracy), and severity is an AI-generated visual estimate, not a certified structural engineering assessment.
- **Worker Safety Helmet Detection (`POST /api/inspect/helmets`)**
  - **Green (`#16A34A`)**: Helmet detected — compliant.
  - **Red (`#DC2626`)**: No helmet detected — potential violation.
  - **Orange (`#EA580C`)**: Uncertain — manual verification required (workers with obscured, distant, shadowed, or out-of-frame heads are strictly classified as uncertain, never falsely flagged as violations).
  - **Compliance Formula**: `Helmet Compliance = (Workers Wearing Helmets / Total Workers Detected) × 100`.
- **Combined Inspection (`POST /api/inspect/combined`)**
  - Executes both independent crack and helmet modules on the same image and merges findings into a unified viewport and 4-section PDF report.

---

## 3. API Endpoints

- `GET /api/health` — Backend, SQLite, persistent storage, Gemini model availability, and optional Python backend status.
- `POST /api/inspect/cracks` — Structural crack inspection (`multipart/form-data` `file` or JSON `imageBase64`).
- `POST /api/inspect/helmets` — Safety helmet inspection.
- `POST /api/inspect/combined` — Combined crack + helmet inspection.
- `GET /api/dashboard` — Aggregate statistics computed strictly from SQLite records.
- `GET /api/inspections` — Searchable/filterable inspection list (`?search=&mode=&status=`).
- `GET /api/inspections/:id` — Single inspection record.
- `DELETE /api/inspections/:id` — Delete inspection record and stored artifacts.
- `GET /api/reports/:id` — Download/stream automated 4-section PDF inspection report.
- `GET /api/storage/*` — Serve stored original and annotated images.
- `GET /api/settings` & `PUT /api/settings` — Site metadata, thresholds, auto-scan interval, and external Python URL.

---

## 4. Environment & Persistent Storage Configuration

Configure environment variables via `.env` (see `.env.example`):

- `GEMINI_API_KEY`: Server-side Google AI API key (never exposed to browser).
- `STORAGE_BACKEND`: `"local"` (default) or `"s3"`.
- `STORAGE_ROOT`: Persistent disk path for original/annotated images and PDFs (e.g., `/var/data/construction_vision/storage` in production).
- `DB_PATH`: Persistent SQLite file path (e.g., `/var/data/construction_vision/construction_vision.db`).
- `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: Optional S3-compatible object storage credentials when `STORAGE_BACKEND="s3"`.
- `CORS_ORIGIN`: Allowed CORS origins (`*` or comma-separated URLs).

---

## 5. Running & Deploying

### Web Application (Node.js + Vite)
```bash
npm install
npm run dev        # Development server on port 3000
npm run build      # Builds frontend dist/ + bundles server.js
npm run start      # Production server on port 3000
```

### Python FastAPI + YOLO Backend (`backend/`)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Optional: configure trained Ultralytics YOLO weights (.pt)
export HELMET_MODEL_WEIGHTS=/path/to/helmet_yolov8n.pt
export CRACK_MODEL_WEIGHTS=/path/to/crack_yolov8n.pt  # falls back to OpenCV Black-Hat if unset

uvicorn main:app --host 0.0.0.0 --port 8000
```

### Hosting Requirements & Notes
- **AI Inference**: Gemini Vision requires outbound HTTPS access from the server and a valid `GEMINI_API_KEY`. The Python YOLO backend runs on CPU by default (`device="cpu"`) and accelerates automatically if CUDA is configured.
- **Model Weights**: Custom `.pt` weights are not bundled in the repository. Point `HELMET_MODEL_WEIGHTS` (e.g., YOLOv8 trained on construction PPE classes `helmet` / `no-helmet`) and optionally `CRACK_MODEL_WEIGHTS` to your trained checkpoints.
- **Storage**: Mount a persistent volume to `STORAGE_ROOT` and `DB_PATH` (or configure `STORAGE_BACKEND=s3`) so images, reports, and SQLite records survive container restarts.
- **Browser Camera Access**: Live camera inspection uses `navigator.mediaDevices.getUserMedia`, which requires `HTTPS` (or `localhost`) and user camera permission.

---

## 6. Drone Integration Readiness

All inspection endpoints accept `source_type="drone_feed"` and optional JSON `telemetry` metadata stored alongside each record in SQLite (`telemetry_json`), allowing external drone ground-station relays to transmit captured frames for remote structural/safety inspection without claiming autonomous flight control.
