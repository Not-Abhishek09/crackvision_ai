"""FastAPI Server for Construction Vision (Python + OpenCV + Ultralytics YOLO)."""

import os
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from database import get_inspection_by_id, init_db, list_inspections
from inspection_service import InspectionService, STORAGE_ROOT


app = FastAPI(
    title="Construction Vision AI Backend",
    description="Structural Crack & Worker Safety Helmet Inspection API",
    version="2.0.0",
)

cors_origins = os.environ.get("CORS_ORIGIN", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins] if cors_origins != ["*"] else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
service = InspectionService()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "backend": "python-fastapi",
        "crack_detector": service.crack_detector.get_method_name(),
        "crack_ai_model_loaded": service.crack_detector.is_ai_model(),
        "helmet_yolo_loaded": service.helmet_detector.is_loaded,
        "helmet_weights_path": str(service.helmet_detector.weights_path),
    }


@app.post("/api/inspect/cracks")
async def inspect_cracks(
    file: UploadFile = File(...),
    source_type: str = Form("upload"),
    zone_label: str = Form("Zone A"),
):
    data = await file.read()
    try:
        return service.run("cracks", data, source_type=source_type, zone_label=zone_label)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/inspect/helmets")
async def inspect_helmets(
    file: UploadFile = File(...),
    source_type: str = Form("upload"),
    zone_label: str = Form("Zone A"),
):
    if not service.helmet_detector.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Helmet YOLO weights not found at '{service.helmet_detector.weights_path}'. "
                "Configure HELMET_MODEL_WEIGHTS with a trained PPE YOLO .pt file."
            ),
        )
    data = await file.read()
    try:
        return service.run("helmets", data, source_type=source_type, zone_label=zone_label)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/inspect/combined")
async def inspect_combined(
    file: UploadFile = File(...),
    source_type: str = Form("upload"),
    zone_label: str = Form("Zone A"),
):
    if not service.helmet_detector.is_loaded:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Helmet YOLO weights not found at '{service.helmet_detector.weights_path}'. "
                "Configure HELMET_MODEL_WEIGHTS with a trained PPE YOLO .pt file."
            ),
        )
    data = await file.read()
    try:
        return service.run("combined", data, source_type=source_type, zone_label=zone_label)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/inspections")
def get_inspections(limit: int = 200):
    items = list_inspections(limit=limit)
    return {"items": items, "total": len(items)}


@app.get("/api/inspections/{inspection_id}")
def get_inspection(inspection_id: str):
    item = get_inspection_by_id(inspection_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return item


@app.get("/api/reports/{inspection_id}")
def get_report(inspection_id: str):
    item = get_inspection_by_id(inspection_id)
    if not item:
        raise HTTPException(status_code=404, detail="Inspection not found")
    pdf_path = STORAGE_ROOT / item["pdf_report_key"]
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF report file not found")
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=f"{inspection_id}_inspection_report.pdf",
    )


@app.get("/api/storage/{key:path}")
def get_storage_file(key: str):
    resolved = (STORAGE_ROOT / key).resolve()
    if not str(resolved).startswith(str(STORAGE_ROOT.resolve())) or not resolved.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(resolved))
