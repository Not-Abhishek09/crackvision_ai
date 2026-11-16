"""Inspection Orchestration Service for Construction Vision Python Backend."""

from dataclasses import asdict
from datetime import datetime, timezone
import os
from pathlib import Path
import time
import uuid
import cv2
import numpy as np

from crack_detection import BaseCrackDetector, create_crack_detector
from database import insert_inspection
from helmet_detection import YOLOHelmetDetector
from image_processor import ImageProcessor
from report_generator import generate_pdf_report


STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "data/storage"))


class InspectionService:
    """Reuses initialized AI model singletons across FastAPI requests."""

    def __init__(self):
        self.crack_detector: BaseCrackDetector = create_crack_detector(sensitivity="medium")
        self.helmet_detector: YOLOHelmetDetector = YOLOHelmetDetector()

    def run(
        self,
        mode: str,
        image_bytes: bytes,
        source_type: str = "upload",
        site_name: str = "North Sector Structural Site",
        zone_label: str = "Zone A",
        inspector_name: str = "Site Safety Engineer",
    ) -> dict:
        t0 = time.perf_counter()
        image = ImageProcessor.decode_bytes(image_bytes)
        img_w, img_h, _ = ImageProcessor.get_image_dimensions(image)

        insp_id = f"INSP-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        created_at = datetime.now(timezone.utc).isoformat()
        insp_dir = STORAGE_ROOT / "inspections" / insp_id
        insp_dir.mkdir(parents=True, exist_ok=True)

        orig_rel = f"inspections/{insp_id}/original.jpg"
        orig_path = STORAGE_ROOT / orig_rel
        ImageProcessor.save_image(image, orig_path)

        crack_results = None
        helmet_results = None
        crack_ann_path = None
        helmet_ann_path = None

        unified_img = image.copy()

        if mode in ("cracks", "combined"):
            c_res = self.crack_detector.detect(image)
            crack_results = {
                "total_cracks": c_res.candidate_contour_count,
                "estimated_overall_severity": c_res.estimated_overall_severity,
                "average_model_confidence": c_res.confidence_score,
                "detections": [asdict(d) for d in c_res.detections],
                "notes": c_res.notes,
                "severity_disclaimer": c_res.confidence_description,
            }
            crack_ann_path = insp_dir / "annotated_cracks.jpg"
            ImageProcessor.save_image(c_res.annotated_image, crack_ann_path)
            unified_img = c_res.annotated_image.copy()

        if mode in ("helmets", "combined"):
            h_res = self.helmet_detector.detect(image)
            helmet_results = {
                "total_workers": h_res.total_workers,
                "workers_wearing_helmet": h_res.workers_wearing_helmet,
                "workers_without_helmet": h_res.workers_without_helmet,
                "uncertain_detections": h_res.uncertain_detections,
                "helmet_compliance_percent": h_res.helmet_compliance_percent,
                "detections": [asdict(d) for d in h_res.detections],
                "violations": h_res.violations,
                "notes": h_res.notes,
            }
            helmet_ann_path = insp_dir / "annotated_helmets.jpg"
            ImageProcessor.save_image(h_res.annotated_image, helmet_ann_path)

            if mode == "combined":
                # Overlay helmet boxes cleanly onto unified image
                for d in h_res.detections:
                    pb = d.pixel_box
                    x1, y1 = pb["x"], pb["y"]
                    x2, y2 = x1 + pb["width"], y1 + pb["height"]
                    color = (
                        (74, 163, 22)
                        if d.classification == "helmet_detected"
                        else (38, 38, 220)
                        if d.classification == "no_helmet"
                        else (12, 88, 234)
                    )
                    cv2.rectangle(unified_img, (x1, y1), (x2, y2), color, 2)
            else:
                unified_img = h_res.annotated_image.copy()

        ann_rel = f"inspections/{insp_id}/annotated.jpg"
        ImageProcessor.save_image(unified_img, STORAGE_ROOT / ann_rel)

        status = "Nominal"
        if helmet_results and helmet_results["workers_without_helmet"] > 0:
            status = "Critical Alert" if (crack_results and crack_results["estimated_overall_severity"] == "High") else "Safety Violation"
        elif crack_results and crack_results["estimated_overall_severity"] == "High":
            status = "Critical Alert"
        elif (crack_results and crack_results["total_cracks"] > 0) or (helmet_results and helmet_results["uncertain_detections"] > 0):
            status = "Attention Required"

        summary = {
            "structural_findings": [crack_results["notes"]] if crack_results else [],
            "worker_safety_findings": [helmet_results["notes"]] if helmet_results else [],
            "potential_hazards": helmet_results["violations"] if helmet_results else [],
            "recommended_actions": [
                "Verify all AI screening detections manually on site before structural or disciplinary actions."
            ],
            "manual_verification_warnings": [
                "Severity estimates and heuristic detections are preliminary screening indicators only."
            ],
        }

        pdf_rel = f"inspections/{insp_id}/report.pdf"
        record = {
            "id": insp_id,
            "created_at": created_at,
            "mode": mode,
            "source_type": source_type,
            "site_name": site_name,
            "zone_label": zone_label,
            "inspector_name": inspector_name,
            "status": status,
            "image_width": img_w,
            "image_height": img_h,
            "original_image_key": orig_rel,
            "annotated_image_key": ann_rel,
            "crack_annotated_key": f"inspections/{insp_id}/annotated_cracks.jpg" if crack_ann_path else None,
            "helmet_annotated_key": f"inspections/{insp_id}/annotated_helmets.jpg" if helmet_ann_path else None,
            "pdf_report_key": pdf_rel,
            "inference_engine": f"{self.crack_detector.get_method_name()} / YOLO Helmet",
            "processing_time_ms": int((time.perf_counter() - t0) * 1000),
            "crack_results": crack_results,
            "helmet_results": helmet_results,
            "summary": summary,
            "telemetry_json": None,
        }

        generate_pdf_report(
            record=record,
            output_pdf_path=STORAGE_ROOT / pdf_rel,
            original_image_path=orig_path,
            crack_annotated_path=crack_ann_path,
            helmet_annotated_path=helmet_ann_path,
        )
        return insert_inspection(record)
