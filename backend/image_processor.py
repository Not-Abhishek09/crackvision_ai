"""Image Processor Module for Construction Vision (preserved & upgraded from CrackVision AI).

Handles image file loading, byte decoding, validation, color space transformations,
denoising, contrast enhancement, and output saving.
"""

from pathlib import Path
from typing import Tuple
import cv2
import numpy as np

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}


class ImageProcessingError(Exception):
    """Custom exception for image processing and I/O failures."""
    pass


class ImageProcessor:
    """Provides validated image loading, decoding, preprocessing, and saving functionality."""

    @staticmethod
    def validate_image_path(path: Path) -> Path:
        if not path.exists():
            raise ImageProcessingError(f"File not found: '{path}'.")
        if path.is_dir():
            raise ImageProcessingError(f"Expected an image file, but found a directory: '{path}'.")
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
            raise ImageProcessingError(
                f"Unsupported file format '{path.suffix}'. Supported formats: {supported}"
            )
        return path.resolve()

    @staticmethod
    def load_image(image_path: Path) -> np.ndarray:
        valid_path = ImageProcessor.validate_image_path(image_path)
        image = cv2.imread(str(valid_path), cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise ImageProcessingError(f"Failed to decode image at '{valid_path}'.")
        return image

    @staticmethod
    def decode_bytes(raw_bytes: bytes) -> np.ndarray:
        if not raw_bytes:
            raise ImageProcessingError("Empty image payload.")
        arr = np.frombuffer(raw_bytes, dtype=np.uint8)
        image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if image is None or image.size == 0:
            raise ImageProcessingError("Failed to decode uploaded image bytes.")
        return image

    @staticmethod
    def to_grayscale(image: np.ndarray) -> np.ndarray:
        if len(image.shape) == 2:
            return image.copy()
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    @staticmethod
    def preprocess_for_crack_detection(
        grayscale_image: np.ndarray,
        apply_clahe: bool = True,
        denoise_method: str = "bilateral",
    ) -> np.ndarray:
        processed = grayscale_image.copy()
        if apply_clahe:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            processed = clahe.apply(processed)
        if denoise_method == "bilateral":
            processed = cv2.bilateralFilter(processed, d=7, sigmaColor=50, sigmaSpace=50)
        elif denoise_method == "gaussian":
            processed = cv2.GaussianBlur(processed, (5, 5), 0)
        return processed

    @staticmethod
    def save_image(image: np.ndarray, output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        success = cv2.imwrite(str(output_path), image)
        if not success:
            raise ImageProcessingError(f"OpenCV failed to write image to '{output_path}'.")
        return output_path.resolve()

    @staticmethod
    def get_image_dimensions(image: np.ndarray) -> Tuple[int, int, int]:
        h, w = image.shape[:2]
        c = image.shape[2] if len(image.shape) > 2 else 1
        return w, h, c
