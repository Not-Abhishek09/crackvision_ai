"""Image Processor Module for CrackVision AI.

Handles image file loading, validation, color space transformations,
denoising, contrast enhancement, and output saving.
"""

from pathlib import Path
from typing import Optional, Tuple
import cv2
import numpy as np

# Supported image file extensions
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}


class ImageProcessingError(Exception):
    """Custom exception for image processing and I/O failures."""
    pass


class ImageProcessor:
    """Provides validated image loading, preprocessing, and saving functionality."""

    @staticmethod
    def validate_image_path(path: Path) -> Path:
        """Validates that the file exists and has a supported extension.

        Args:
            path: Path to the image file.

        Returns:
            Resolved absolute Path.

        Raises:
            ImageProcessingError: If the file is missing, a directory, or has an unsupported extension.
        """
        if not path.exists():
            raise ImageProcessingError(f"File not found: '{path}'. Please check the path and try again.")
        if path.is_dir():
            raise ImageProcessingError(f"Expected an image file, but found a directory: '{path}'.")
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
            raise ImageProcessingError(
                f"Unsupported file format '{path.suffix}'. Supported formats are: {supported}"
            )
        return path.resolve()

    @staticmethod
    def load_image(image_path: Path) -> np.ndarray:
        """Loads an image from disk using OpenCV.

        Args:
            image_path: Path to the image file.

        Returns:
            Color image as a BGR NumPy ndarray.

        Raises:
            ImageProcessingError: If the image cannot be decoded or read.
        """
        valid_path = ImageProcessor.validate_image_path(image_path)

        # cv2.imread returns None if decoding fails or file is corrupted
        image = cv2.imread(str(valid_path), cv2.IMREAD_COLOR)
        if image is None:
            raise ImageProcessingError(
                f"Failed to read image at '{valid_path}'. The file may be corrupted, truncated, or unreadable."
            )
        if image.size == 0:
            raise ImageProcessingError(f"Loaded image at '{valid_path}' is empty (0 bytes decoded).")

        return image

    @staticmethod
    def to_grayscale(image: np.ndarray) -> np.ndarray:
        """Converts an image to single-channel grayscale without altering the input.

        Args:
            image: Input image (BGR or already grayscale).

        Returns:
            Grayscale single-channel image.
        """
        if len(image.shape) == 2:
            return image.copy()
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    @staticmethod
    def preprocess_for_crack_detection(
        grayscale_image: np.ndarray,
        apply_clahe: bool = True,
        denoise_method: str = "bilateral"
    ) -> np.ndarray:
        """Applies contrast enhancement and edge-preserving denoising.

        Concrete surfaces often have non-uniform illumination (shadows) and high-frequency
        aggregate texture. This function uses CLAHE to normalize local contrast and
        a bilateral filter or Gaussian blur to smooth gravel grain while keeping crack edges sharp.

        Args:
            grayscale_image: Single-channel grayscale image.
            apply_clahe: Whether to apply Contrast Limited Adaptive Histogram Equalization.
            denoise_method: 'bilateral' (edge-preserving) or 'gaussian'.

        Returns:
            Preprocessed grayscale image.
        """
        processed = grayscale_image.copy()

        # Step 1: Optional CLAHE for local contrast normalization
        if apply_clahe:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            processed = clahe.apply(processed)

        # Step 2: Denoise to suppress fine concrete aggregate grain
        if denoise_method == "bilateral":
            # Bilateral filter smooths flat textures while preserving sharp boundaries
            processed = cv2.bilateralFilter(processed, d=7, sigmaColor=50, sigmaSpace=50)
        elif denoise_method == "gaussian":
            processed = cv2.GaussianBlur(processed, (5, 5), 0)

        return processed

    @staticmethod
    def save_image(image: np.ndarray, output_path: Path) -> Path:
        """Saves an image to disk, ensuring destination directories exist.

        Args:
            image: Image array to save.
            output_path: Destination path.

        Returns:
            Path to the saved image.

        Raises:
            ImageProcessingError: If writing to disk fails.
        """
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            success = cv2.imwrite(str(output_path), image)
            if not success:
                raise ImageProcessingError(f"OpenCV failed to write image to '{output_path}'.")
            return output_path.resolve()
        except Exception as e:
            raise ImageProcessingError(f"Could not save output image to '{output_path}': {e}") from e

    @staticmethod
    def get_image_dimensions(image: np.ndarray) -> Tuple[int, int, int]:
        """Returns (width, height, channels) of an image array."""
        h, w = image.shape[:2]
        c = image.shape[2] if len(image.shape) > 2 else 1
        return w, h, c
