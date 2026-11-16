"""Worker Safety Helmet Detection Module for Construction Vision.

Uses Ultralytics YOLO when trained PPE/helmet weights are configured via HELMET_MODEL_WEIGHTS.
Color convention (BGR for OpenCV):
- GREEN  (74, 163, 22)  : Helmet detected - compliant
- RED    (38, 38, 220)  : No helmet detected - potential violation
- ORANGE (12, 88, 234)  : Uncertain - manual verification required
"""

from dataclasses import dataclass
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np


COLOR_COMPLIANT_BGR = (74, 163, 22)
COLOR_VIOLATION_BGR = (38, 38, 220)
COLOR_UNCERTAIN_BGR = (12, 88, 234)


@dataclass
class HelmetDetectionItem:
    id: str
    object_category: str
    classification: str  # helmet_detected | no_helmet | uncertain
    model_reported_confidence: float
    box_2d: List[int]  # [ymin, xmin, ymax, xmax] normalized 0..1000
    pixel_box: Dict[str, int]
    reason: str


@dataclass
class HelmetDetectionResult:
    model_configured: bool
    model_name: str
    total_workers: int
    workers_wearing_helmet: int
    workers_without_helmet: int
    uncertain_detections: int
    helmet_compliance_percent: Optional[float]
    detections: List[HelmetDetectionItem]
    violations: List[str]
    annotated_image: np.ndarray
    processing_time_seconds: float
    notes: str


class YOLOHelmetDetector:
    """Ultralytics YOLO Safety Helmet & Worker Detector.

    Supports custom PPE weights (e.g. classes: helmet / no-helmet / person)
    configured via HELMET_MODEL_WEIGHTS environment variable.
    If no helmet-specific weights are present, raises a clear configuration error
    rather than fabricating fake detections.
    """

    def __init__(self, weights_path: Optional[str] = None, conf_threshold: float = 0.40):
        self.weights_path = Path(weights_path or os.environ.get("HELMET_MODEL_WEIGHTS", "weights/helmet_yolov8n.pt"))
        self.conf_threshold = conf_threshold
        self._model: Any = None
        if self.weights_path.exists():
            from ultralytics import YOLO  # type: ignore
            self._model = YOLO(str(self.weights_path))

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def _classify_label(self, class_name: str, conf: float, x1: int, y1: int, img_h: int) -> Tuple[str, str]:
        name = class_name.lower().strip()
        # Never mark edge-cropped / obscured heads as non-compliant
        if y1 <= 2:
            return "uncertain", "Head region touches top frame edge; manual verification required"
        if conf < 0.55:
            return "uncertain", f"Low model certainty ({conf * 100:.0f}%); manual verification required"
        if any(tok in name for tok in ("no_helmet", "no-helmet", "without_helmet", "no_hardhat", "head")):
            return "no_helmet", f"Model detected '{class_name}' without safety helmet"
        if any(tok in name for tok in ("helmet", "hardhat", "hard_hat")):
            return "helmet_detected", f"Model detected '{class_name}'"
        return "uncertain", f"Ambiguous PPE class '{class_name}'; manual verification required"

    def detect(self, original_image: np.ndarray) -> HelmetDetectionResult:
        if not self.is_loaded:
            raise RuntimeError(
                f"Helmet YOLO weights not found at '{self.weights_path}'. "
                "Download or train a PPE helmet YOLO checkpoint and set HELMET_MODEL_WEIGHTS."
            )

        start_time = time.perf_counter()
        img_h, img_w = original_image.shape[:2]
        annotated = original_image.copy()
        results = self._model.predict(original_image, conf=self.conf_threshold, device="cpu", verbose=False)

        detections: List[HelmetDetectionItem] = []
        if results and results[0].boxes is not None:
            names = results[0].names or {}
            for box in results[0].boxes:
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                conf = float(box.conf[0].item())
                cls_id = int(box.cls[0].item())
                cls_name = str(names.get(cls_id, cls_id))

                # Skip standalone non-person background classes if model has them
                classification, reason = self._classify_label(cls_name, conf, x1, y1, img_h)
                det_id = f"WRK-{len(detections) + 1:02d}"

                color = (
                    COLOR_COMPLIANT_BGR
                    if classification == "helmet_detected"
                    else COLOR_VIOLATION_BGR
                    if classification == "no_helmet"
                    else COLOR_UNCERTAIN_BGR
                )
                tag = (
                    "HELMET OK"
                    if classification == "helmet_detected"
                    else "NO HELMET"
                    if classification == "no_helmet"
                    else "UNCERTAIN"
                )

                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                cv2.putText(
                    annotated,
                    f"{det_id} {tag} {conf * 100:.0f}%",
                    (x1, max(16, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    color,
                    1,
                    cv2.LINE_AA,
                )

                detections.append(
                    HelmetDetectionItem(
                        id=det_id,
                        object_category="construction_worker",
                        classification=classification,
                        model_reported_confidence=round(conf, 3),
                        box_2d=[
                            int((y1 / max(img_h, 1)) * 1000),
                            int((x1 / max(img_w, 1)) * 1000),
                            int((y2 / max(img_h, 1)) * 1000),
                            int((x2 / max(img_w, 1)) * 1000),
                        ],
                        pixel_box={"x": x1, "y": y1, "width": max(2, x2 - x1), "height": max(2, y2 - y1)},
                        reason=reason,
                    )
                )

        total = len(detections)
        wearing = sum(1 for d in detections if d.classification == "helmet_detected")
        missing = sum(1 for d in detections if d.classification == "no_helmet")
        uncertain = sum(1 for d in detections if d.classification == "uncertain")
        compliance = round((wearing / total) * 100.0, 1) if total > 0 else None
        violations = [
            f"{d.id}: No helmet detected ({d.model_reported_confidence * 100:.0f}% model certainty) - {d.reason}"
            for d in detections
            if d.classification == "no_helmet"
        ]

        return HelmetDetectionResult(
            model_configured=True,
            model_name=f"Ultralytics YOLO ({self.weights_path.name})",
            total_workers=total,
            workers_wearing_helmet=wearing,
            workers_without_helmet=missing,
            uncertain_detections=uncertain,
            helmet_compliance_percent=compliance,
            detections=detections,
            violations=violations,
            annotated_image=annotated,
            processing_time_seconds=time.perf_counter() - start_time,
            notes=f"Detected {total} worker(s): {wearing} compliant, {missing} missing helmet, {uncertain} uncertain.",
        )
