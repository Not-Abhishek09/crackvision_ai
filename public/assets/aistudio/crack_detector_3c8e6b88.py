"""Crack Detector Module for CrackVision AI.

Provides a modular architecture for structural crack detection in concrete,
asphalt, masonry, and infrastructure surfaces.
Includes a base detector interface and a baseline morphological image-processing detector.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import time
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np

from image_processor import ImageProcessor


@dataclass
class DetectionResult:
    """Holds comprehensive results from a crack detection run."""
    method_name: str
    is_deep_learning: bool
    candidate_contour_count: int
    total_crack_pixels: int
    crack_pixel_ratio_percent: float
    bounding_boxes: List[Tuple[int, int, int, int]]  # (x, y, w, h)
    mask: np.ndarray  # Binary mask (0 or 255)
    annotated_image: np.ndarray  # Color image with highlights
    processing_time_seconds: float
    sensitivity_level: str = "medium"
    confidence_score: Optional[float] = None  # Genuine AI score only; None for heuristics
    confidence_description: str = "N/A (Heuristic Computer Vision Baseline)"
    intermediate_stages: Dict[str, np.ndarray] = field(default_factory=dict)
    notes: str = ""


class BaseCrackDetector(ABC):
    """Abstract base class for all crack detectors.

    Ensures that experimental image-processing baselines and future deep-learning
    models (e.g., PyTorch U-Net, YOLO, MobileNet) share an identical interface,
    allowing effortless substitution in CLI, automated batching, and future Flask routes.
    """

    @abstractmethod
    def detect(self, original_image: np.ndarray) -> DetectionResult:
        """Runs crack detection on the provided color image.

        Args:
            original_image: Color image (BGR) as a NumPy array. Must not be modified in-place.

        Returns:
            DetectionResult dataclass containing detection statistics and visualizations.
        """
        pass

    @abstractmethod
    def get_method_name(self) -> str:
        """Returns human-readable name of the detection method."""
        pass

    @abstractmethod
    def is_ai_model(self) -> bool:
        """Returns True if the detector uses a trained AI/deep-learning model."""
        pass


class BaselineMorphologicalCrackDetector(BaseCrackDetector):
    """Baseline Computer-Vision Crack Detector using Morphological Black-Hat and Geometric Filtering.

    NOTE ON METHODOLOGY:
    This is an experimental computer-vision algorithm, NOT a trained deep-learning AI model.
    It does not generate machine-learned confidence scores or evaluate structural safety.

    ALGORITHM OVERVIEW:
    1. Grayscale & CLAHE: Normalizes local lighting variations across concrete surfaces.
    2. Edge-Preserving Denoising: Suppresses fine concrete gravel grain while preserving edges.
    3. Morphological Black-Hat:
       - Black-Hat = Morphological Closing(I) - I.
       - Structural cracks in concrete are narrow dark crevices surrounded by lighter cement.
       - Morphological closing bridges these thin dark lines with surrounding lighter pixels.
       - Subtracting the original from the closed image highlights thin dark linear features
         while eliminating large-scale lighting variations (shadows, gradients).
    4. Adaptive Statistical Thresholding:
       - Rather than pure Otsu (which forces a two-class split even on pure noise), we use
         a statistical threshold: mean + (k * std), bounded by a noise floor.
       - Adjusting k allows tuning between strict (few false alarms) and sensitive (detects fainter cracks).
    5. Geometric & Morphological Filtering:
       - Concrete surfaces frequently feature small circular bugholes (air voids) or aggregate specs.
       - Structural cracks are elongated, high-perimeter-to-area features.
       - Artifacts are filtered based on contour area, elongation (aspect ratio), and circularity.
    6. Non-Destructive Annotation:
       - Highlights candidate crack regions in bright color overlaid on a copy of the input.
    """

    # Pre-configured sensitivity presets
    SENSITIVITY_PROFILES = {
        "low": {"k_factor": 2.7, "min_floor": 45, "min_area": 45, "min_aspect": 2.4},
        "medium": {"k_factor": 2.3, "min_floor": 35, "min_area": 35, "min_aspect": 2.0},
        "high": {"k_factor": 1.9, "min_floor": 25, "min_area": 25, "min_aspect": 1.7},
    }

    def __init__(
        self,
        sensitivity: str = "medium",
        blackhat_kernel_size: int = 15,
        overlay_color: Tuple[int, int, int] = (0, 0, 255),  # BGR Red
        overlay_alpha: float = 0.50
    ):
        """Initializes baseline detector parameters.

        Args:
            sensitivity: Sensitivity level ('low', 'medium', or 'high').
            blackhat_kernel_size: Size of elliptical kernel for black-hat transform.
            overlay_color: BGR tuple for highlighting candidate cracks (default: Red).
            overlay_alpha: Transparency factor for overlay blend (0.0 to 1.0).
        """
        self.sensitivity = sensitivity.lower() if sensitivity.lower() in self.SENSITIVITY_PROFILES else "medium"
        self.profile = self.SENSITIVITY_PROFILES[self.sensitivity]
        self.blackhat_kernel_size = blackhat_kernel_size
        self.overlay_color = overlay_color
        self.overlay_alpha = overlay_alpha

    def get_method_name(self) -> str:
        return f"Baseline Computer Vision (Black-Hat + Geometric Filtering, {self.sensitivity.capitalize()} Sensitivity)"

    def is_ai_model(self) -> bool:
        return False

    def detect(self, original_image: np.ndarray) -> DetectionResult:
        """Executes the baseline detection pipeline."""
        start_time = time.perf_counter()

        # Step 1: Grayscale conversion (never alters original_image)
        gray = ImageProcessor.to_grayscale(original_image)

        # Step 2: Denoising & contrast enhancement
        preprocessed = ImageProcessor.preprocess_for_crack_detection(
            gray, apply_clahe=True, denoise_method="bilateral"
        )

        # Step 3: Morphological Black-Hat Transform
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (self.blackhat_kernel_size, self.blackhat_kernel_size)
        )
        blackhat = cv2.morphologyEx(preprocessed, cv2.MORPH_BLACKHAT, kernel)

        # Step 4: Statistical Adaptive Thresholding
        bh_mean = float(np.mean(blackhat))
        bh_std = float(np.std(blackhat))
        k = self.profile["k_factor"]
        floor = self.profile["min_floor"]
        calc_thresh = int(bh_mean + (k * bh_std))
        effective_thresh = max(calc_thresh, floor)

        _, thresh_raw = cv2.threshold(blackhat, effective_thresh, 255, cv2.THRESH_BINARY)

        # Morphological opening with a small 3x3 kernel to remove isolated single-pixel noise
        clean_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh_clean = cv2.morphologyEx(thresh_raw, cv2.MORPH_OPEN, clean_kernel)

        # Step 5: Contour extraction and geometric filtering
        contours, _ = cv2.findContours(thresh_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        filtered_contours = []
        bounding_boxes: List[Tuple[int, int, int, int]] = []
        filtered_mask = np.zeros_like(gray, dtype=np.uint8)

        min_area = self.profile["min_area"]
        min_aspect = self.profile["min_aspect"]

        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area:
                continue

            # Bounding box & aspect ratio calculation
            x, y, w, h = cv2.boundingRect(cnt)
            longer_side = max(w, h)
            shorter_side = max(min(w, h), 1)
            aspect_ratio = longer_side / shorter_side

            # Perimeter to area ratio: cracks have high perimeter relative to their area
            perimeter = cv2.arcLength(cnt, True)
            circularity = (4 * np.pi * area) / (perimeter * perimeter) if perimeter > 0 else 0

            # Structural cracks are elongated (high aspect ratio) or non-circular (low circularity)
            # Bugholes/circular aggregate pits have circularity closer to 1.0 and low aspect ratio
            is_crack_candidate = (aspect_ratio >= min_aspect) or (circularity < 0.22 and area >= (min_area * 1.5))

            if is_crack_candidate:
                filtered_contours.append(cnt)
                bounding_boxes.append((x, y, w, h))
                cv2.drawContours(filtered_mask, [cnt], -1, 255, thickness=cv2.FILLED)

        # Step 6: Create visualization on a clean copy
        annotated_image = original_image.copy()

        if filtered_contours:
            # Create a tinted overlay mask
            overlay = original_image.copy()
            overlay[filtered_mask == 255] = self.overlay_color
            annotated_image = cv2.addWeighted(
                overlay, self.overlay_alpha, annotated_image, 1.0 - self.overlay_alpha, 0
            )

            # Draw crisp contour boundaries in bright yellow
            cv2.drawContours(annotated_image, filtered_contours, -1, (0, 255, 255), thickness=1)

            # Draw bounding boxes with subtle outline
            for (bx, by, bw, bh) in bounding_boxes:
                cv2.rectangle(annotated_image, (bx, by), (bx + bw, by + bh), (0, 165, 255), 1)

        # Draw professional metadata banner at top of output image
        annotated_image = self._draw_annotation_banner(
            annotated_image, len(filtered_contours), original_image.shape[1], original_image.shape[0]
        )

        total_pixels = original_image.shape[0] * original_image.shape[1]
        crack_pixels = int(np.count_nonzero(filtered_mask))
        crack_ratio = (crack_pixels / total_pixels) * 100.0 if total_pixels > 0 else 0.0

        elapsed = time.perf_counter() - start_time

        intermediates = {
            "grayscale": gray,
            "preprocessed": preprocessed,
            "blackhat": blackhat,
            "threshold_raw": thresh_raw,
            "filtered_mask": filtered_mask
        }

        return DetectionResult(
            method_name=self.get_method_name(),
            is_deep_learning=self.is_ai_model(),
            candidate_contour_count=len(filtered_contours),
            total_crack_pixels=crack_pixels,
            crack_pixel_ratio_percent=round(crack_ratio, 3),
            bounding_boxes=bounding_boxes,
            mask=filtered_mask,
            annotated_image=annotated_image,
            processing_time_seconds=elapsed,
            sensitivity_level=self.sensitivity,
            confidence_score=None,
            confidence_description="N/A (Baseline heuristic — confidence scores require a trained AI model)",
            intermediate_stages=intermediates,
            notes="Heuristic candidate regions detected. Preliminary screening only; requires engineer verification."
        )

    def _draw_annotation_banner(
        self, image: np.ndarray, contour_count: int, width: int, height: int
    ) -> np.ndarray:
        """Draws an informative status badge onto the annotated image."""
        banner_h = max(36, int(height * 0.055))
        banner = image.copy()
        cv2.rectangle(banner, (0, 0), (width, banner_h), (25, 25, 25), -1)
        image = cv2.addWeighted(banner, 0.75, image, 0.25, 0)

        status_text = (
            f"CrackVision AI | Mode: Baseline CV ({self.sensitivity}) | Candidates: {contour_count} regions"
            if contour_count > 0
            else f"CrackVision AI | Mode: Baseline CV ({self.sensitivity}) | No candidate cracks detected"
        )
        font_scale = max(0.42, banner_h / 75.0)
        cv2.putText(
            image,
            status_text,
            (10, int(banner_h * 0.65)),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (255, 255, 255),
            1,
            cv2.LINE_AA
        )
        return image
