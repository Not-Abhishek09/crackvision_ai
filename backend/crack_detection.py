"""Structural Crack Detection Module for Construction Vision.

Preserves the uploaded BaseCrackDetector & BaselineMorphologicalCrackDetector
and adds Ultralytics YOLO support + AI-estimated severity classification.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np

from image_processor import ImageProcessor


@dataclass
class CrackDetectionItem:
    id: str
    object_category: str
    classification: str
    severity: str  # Low | Medium | High
    model_reported_confidence: Optional[float]
    box_2d: List[int]  # [ymin, xmin, ymax, xmax] normalized 0..1000
    pixel_box: Dict[str, int]  # {x, y, width, height}
    location_description: str


@dataclass
class DetectionResult:
    method_name: str
    is_deep_learning: bool
    candidate_contour_count: int
    total_crack_pixels: int
    crack_pixel_ratio_percent: float
    bounding_boxes: List[Tuple[int, int, int, int]]
    mask: np.ndarray
    annotated_image: np.ndarray
    processing_time_seconds: float
    sensitivity_level: str = "medium"
    confidence_score: Optional[float] = None
    confidence_description: str = "N/A (Heuristic Computer Vision Baseline)"
    estimated_overall_severity: str = "None"
    detections: List[CrackDetectionItem] = field(default_factory=list)
    intermediate_stages: Dict[str, np.ndarray] = field(default_factory=dict)
    notes: str = ""


class BaseCrackDetector(ABC):
    @abstractmethod
    def detect(self, original_image: np.ndarray) -> DetectionResult:
        pass

    @abstractmethod
    def get_method_name(self) -> str:
        pass

    @abstractmethod
    def is_ai_model(self) -> bool:
        pass


def estimate_crack_severity(width_px: int, height_px: int, area_px: int, img_area: int) -> str:
    """Estimates relative crack severity (Low / Medium / High) from geometry.
    This is an automated screening estimate, NOT a certified structural assessment.
    """
    diag_ratio = ((width_px ** 2 + height_px ** 2) ** 0.5) / max((img_area ** 0.5), 1.0)
    area_ratio = area_px / max(img_area, 1)
    if diag_ratio >= 0.45 or area_ratio >= 0.012:
        return "High"
    if diag_ratio >= 0.20 or area_ratio >= 0.003:
        return "Medium"
    return "Low"


class BaselineMorphologicalCrackDetector(BaseCrackDetector):
    """Upgraded OpenCV Morphological Black-Hat + Geometric Filtering Crack Detector."""

    SENSITIVITY_PROFILES = {
        "low": {"k_factor": 2.7, "min_floor": 45, "min_area": 45, "min_aspect": 2.4},
        "medium": {"k_factor": 2.3, "min_floor": 35, "min_area": 35, "min_aspect": 2.0},
        "high": {"k_factor": 1.9, "min_floor": 25, "min_area": 25, "min_aspect": 1.7},
    }

    def __init__(
        self,
        sensitivity: str = "medium",
        blackhat_kernel_size: int = 15,
        overlay_color: Tuple[int, int, int] = (0, 220, 255),  # BGR Yellow-Amber
        overlay_alpha: float = 0.40,
    ):
        self.sensitivity = sensitivity.lower() if sensitivity.lower() in self.SENSITIVITY_PROFILES else "medium"
        self.profile = self.SENSITIVITY_PROFILES[self.sensitivity]
        self.blackhat_kernel_size = blackhat_kernel_size
        self.overlay_color = overlay_color
        self.overlay_alpha = overlay_alpha

    def get_method_name(self) -> str:
        return f"OpenCV Morphological Black-Hat ({self.sensitivity.capitalize()} Sensitivity)"

    def is_ai_model(self) -> bool:
        return False

    def detect(self, original_image: np.ndarray) -> DetectionResult:
        start_time = time.perf_counter()
        img_h, img_w = original_image.shape[:2]
        img_area = img_h * img_w

        gray = ImageProcessor.to_grayscale(original_image)
        preprocessed = ImageProcessor.preprocess_for_crack_detection(
            gray, apply_clahe=True, denoise_method="bilateral"
        )

        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (self.blackhat_kernel_size, self.blackhat_kernel_size)
        )
        blackhat = cv2.morphologyEx(preprocessed, cv2.MORPH_BLACKHAT, kernel)

        bh_mean = float(np.mean(blackhat))
        bh_std = float(np.std(blackhat))
        effective_thresh = max(
            int(bh_mean + (self.profile["k_factor"] * bh_std)),
            self.profile["min_floor"],
        )
        _, thresh_raw = cv2.threshold(blackhat, effective_thresh, 255, cv2.THRESH_BINARY)
        clean_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh_clean = cv2.morphologyEx(thresh_raw, cv2.MORPH_OPEN, clean_kernel)

        contours, _ = cv2.findContours(thresh_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        filtered_contours = []
        bounding_boxes: List[Tuple[int, int, int, int]] = []
        detections: List[CrackDetectionItem] = []
        filtered_mask = np.zeros_like(gray, dtype=np.uint8)

        min_area = self.profile["min_area"]
        min_aspect = self.profile["min_aspect"]
        severity_rank = {"None": 0, "Low": 1, "Medium": 2, "High": 3}
        overall_severity = "None"

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue

            x, y, w, h = cv2.boundingRect(cnt)
            longer_side = max(w, h)
            shorter_side = max(min(w, h), 1)
            aspect_ratio = longer_side / shorter_side
            perimeter = cv2.arcLength(cnt, True)
            circularity = (4 * np.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0

            is_crack = (aspect_ratio >= min_aspect) or (circularity < 0.22 and area >= (min_area * 1.5))
            if not is_crack:
                continue

            filtered_contours.append(cnt)
            bounding_boxes.append((x, y, w, h))
            cv2.drawContours(filtered_mask, [cnt], -1, 255, thickness=cv2.FILLED)

            sev = estimate_crack_severity(w, h, int(area), img_area)
            if severity_rank[sev] > severity_rank[overall_severity]:
                overall_severity = sev

            box_2d = [
                int((y / max(img_h, 1)) * 1000),
                int((x / max(img_w, 1)) * 1000),
                int(((y + h) / max(img_h, 1)) * 1000),
                int(((x + w) / max(img_w, 1)) * 1000),
            ]
            detections.append(
                CrackDetectionItem(
                    id=f"CRK-{len(detections) + 1:02d}",
                    object_category="structural_crack",
                    classification="Elongated Surface Crack Candidate",
                    severity=sev,
                    model_reported_confidence=None,
                    box_2d=box_2d,
                    pixel_box={"x": int(x), "y": int(y), "width": int(w), "height": int(h)},
                    location_description=f"Region ({x},{y}) {w}x{h} px",
                )
            )

        annotated_image = original_image.copy()
        if filtered_contours:
            overlay = original_image.copy()
            overlay[filtered_mask == 255] = self.overlay_color
            annotated_image = cv2.addWeighted(
                overlay, self.overlay_alpha, annotated_image, 1.0 - self.overlay_alpha, 0
            )
            cv2.drawContours(annotated_image, filtered_contours, -1, (21, 204, 250), thickness=1)
            for idx, (bx, by, bw, bh) in enumerate(bounding_boxes):
                cv2.rectangle(annotated_image, (bx, by), (bx + bw, by + bh), (21, 204, 250), 2)
                label = f"{detections[idx].id} ({detections[idx].severity})"
                cv2.putText(
                    annotated_image, label, (bx, max(16, by - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (21, 204, 250), 1, cv2.LINE_AA
                )

        crack_pixels = int(np.count_nonzero(filtered_mask))
        crack_ratio = (crack_pixels / img_area) * 100.0 if img_area > 0 else 0.0

        return DetectionResult(
            method_name=self.get_method_name(),
            is_deep_learning=False,
            candidate_contour_count=len(filtered_contours),
            total_crack_pixels=crack_pixels,
            crack_pixel_ratio_percent=round(crack_ratio, 3),
            bounding_boxes=bounding_boxes,
            mask=filtered_mask,
            annotated_image=annotated_image,
            processing_time_seconds=time.perf_counter() - start_time,
            sensitivity_level=self.sensitivity,
            confidence_score=None,
            confidence_description="N/A (OpenCV heuristic baseline — configure CRACK_MODEL_WEIGHTS for YOLO)",
            estimated_overall_severity=overall_severity,
            detections=detections,
            intermediate_stages={
                "grayscale": gray,
                "preprocessed": preprocessed,
                "blackhat": blackhat,
                "threshold_raw": thresh_raw,
                "filtered_mask": filtered_mask,
            },
            notes="Heuristic screening result; severity is an automated geometric estimate only.",
        )


class YOLOCrackDetector(BaseCrackDetector):
    """Ultralytics YOLO Crack Detector (loaded once and reused).
    Configure CRACK_MODEL_WEIGHTS to point to a trained crack detection .pt model.
    """

    def __init__(self, weights_path: str, conf_threshold: float = 0.35):
        self.weights_path = Path(weights_path)
        self.conf_threshold = conf_threshold
        self._model: Any = None
        if self.weights_path.exists():
            from ultralytics import YOLO  # type: ignore
            self._model = YOLO(str(self.weights_path))

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def get_method_name(self) -> str:
        return f"Ultralytics YOLO Crack Model ({self.weights_path.name})"

    def is_ai_model(self) -> bool:
        return True

    def detect(self, original_image: np.ndarray) -> DetectionResult:
        if self._model is None:
            raise RuntimeError(
                f"YOLO crack weights not found at '{self.weights_path}'. "
                "Set CRACK_MODEL_WEIGHTS to a valid .pt checkpoint."
            )

        start_time = time.perf_counter()
        img_h, img_w = original_image.shape[:2]
        img_area = img_h * img_w
        results = self._model.predict(original_image, conf=self.conf_threshold, device="cpu", verbose=False)

        detections: List[CrackDetectionItem] = []
        bounding_boxes: List[Tuple[int, int, int, int]] = []
        mask = np.zeros((img_h, img_w), dtype=np.uint8)
        annotated = original_image.copy()
        severity_rank = {"None": 0, "Low": 1, "Medium": 2, "High": 3}
        overall_severity = "None"
        confs: List[float] = []

        if results:
            res = results[0]
            if res.boxes is not None:
                for box in res.boxes:
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                    conf = float(box.conf[0].item())
                    w = max(2, x2 - x1)
                    h = max(2, y2 - y1)
                    sev = estimate_crack_severity(w, h, w * h, img_area)
                    if severity_rank[sev] > severity_rank[overall_severity]:
                        overall_severity = sev
                    confs.append(conf)
                    bounding_boxes.append((x1, y1, w, h))
                    cv2.rectangle(mask, (x1, y1), (x2, y2), 255, -1)
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (21, 204, 250), 2)

                    det_id = f"CRK-{len(detections) + 1:02d}"
                    cv2.putText(
                        annotated,
                        f"{det_id} {sev} {conf * 100:.0f}%",
                        (x1, max(16, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.45,
                        (21, 204, 250),
                        1,
                        cv2.LINE_AA,
                    )
                    detections.append(
                        CrackDetectionItem(
                            id=det_id,
                            object_category="structural_crack",
                            classification="YOLO Structural Crack",
                            severity=sev,
                            model_reported_confidence=round(conf, 3),
                            box_2d=[
                                int((y1 / max(img_h, 1)) * 1000),
                                int((x1 / max(img_w, 1)) * 1000),
                                int((y2 / max(img_h, 1)) * 1000),
                                int((x2 / max(img_w, 1)) * 1000),
                            ],
                            pixel_box={"x": x1, "y": y1, "width": w, "height": h},
                            location_description=f"Region ({x1},{y1}) {w}x{h} px",
                        )
                    )

        avg_conf = round(sum(confs) / len(confs), 3) if confs else None
        crack_pixels = int(np.count_nonzero(mask))

        return DetectionResult(
            method_name=self.get_method_name(),
            is_deep_learning=True,
            candidate_contour_count=len(detections),
            total_crack_pixels=crack_pixels,
            crack_pixel_ratio_percent=round((crack_pixels / max(img_area, 1)) * 100.0, 3),
            bounding_boxes=bounding_boxes,
            mask=mask,
            annotated_image=annotated,
            processing_time_seconds=time.perf_counter() - start_time,
            confidence_score=avg_conf,
            confidence_description="Model-reported confidence from Ultralytics YOLO",
            estimated_overall_severity=overall_severity,
            detections=detections,
            notes="YOLO crack detection completed; severity is an automated screening estimate.",
        )


def create_crack_detector(sensitivity: str = "medium") -> BaseCrackDetector:
    """Factory loading YOLO weights if configured and present, else falling back to OpenCV Baseline."""
    weights = os.environ.get("CRACK_MODEL_WEIGHTS", "").strip()
    if weights and Path(weights).exists():
        detector = YOLOCrackDetector(weights_path=weights)
        if detector.is_loaded:
            return detector
    return BaselineMorphologicalCrackDetector(sensitivity=sensitivity)
