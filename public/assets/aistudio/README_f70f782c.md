# CrackVision AI: Real-Time Structural Crack Detection Prototype

> **AI-Driven Structural Crack Detection and Infrastructure Health Monitoring**  
> *Interactive real-time webcam inspection and still-image defect screening for concrete surfaces, bridge decks, walls, and pavements.*

---

## 1. Project Overview

**CrackVision AI** is a real-time computer-vision application designed to assist civil engineers, inspectors, and students in scanning concrete structures for visible surface cracks using an interactive live camera feed or still images.

- **Interactive Live Camera Window:** Uses OpenCV (`cv2.VideoCapture`) to access your webcam, process frames in real time (~80+ FPS pipeline latency), highlight candidate crack regions with high-contrast outlines and bounding boxes, and display live FPS and status badges.
- **Interactive Keyboard Controls:** Press `[S]` to snapshot, `[P]` to pause/freeze the live frame, `[R]` to reset/clear overlays, `[I]` to toggle between raw video and processed detection, and `[Q]` to quit safely.
- **Still-Image & Batch Mode:** Analyze single image files or full directories with structured terminal reports.
- **No Dedicated GPU Required:** Runs smoothly on standard Windows laptops using CPU-optimized image processing.

---

## 2. Detection Methodology (Honest Engineering Overview)

### Computer-Vision Baseline Pipeline
The current prototype uses an **experimental computer-vision baseline**, **NOT** a trained deep-learning AI model.

```
+-----------------------------------------------------------------------------------+
|                           REAL-TIME DETECTION PIPELINE                            |
|                                                                                   |
|  [Live Camera / Image Frame] (Preserves original unannotated frame)               |
|         │                                                                         |
|         ▼                                                                         |
|  [Grayscale Conversion]                                                           |
|         │                                                                         |
|         ▼                                                                         |
|  [CLAHE Contrast Normalization] (Normalizes shadows across uneven surfaces)       |
|         │                                                                         |
|         ▼                                                                         |
|  [Bilateral Filtering] (Suppresses concrete gravel noise while preserving edges) |
|         │                                                                         |
|         ▼                                                                         |
|  [Morphological Black-Hat: Closing(I) - I] (Isolates dark linear crevices)        |
|         │                                                                         |
|         ▼                                                                         |
|  [Statistical Adaptive Thresholding] (mean + k*std bounded by noise floor)        |
|         │                                                                         |
|         ▼                                                                         |
|  [Geometric Contour Filtering] (Rejects circular air voids/bugholes via aspect)  |
|         │                                                                         |
|         ▼                                                                         |
|  [HUD & Non-Destructive Overlay] (Red candidate highlight + Yellow contour)      |
+-----------------------------------------------------------------------------------+
```

### Why Black-Hat Filtering?
Cracks on concrete are thin, dark, continuous linear crevices surrounded by lighter cement paste and aggregate. 
- $\text{BlackHat}(I) = \text{Closing}(I) - I$.
- The morphological closing bridges narrow dark lines with neighboring lighter pixels.
- Subtracting the original image from the closed image isolates the crack crevice and removes wide-area lighting shifts and shadows.

### Limitations:
- **Baseline Heuristic:** It may flag dark stains, construction joints, shadows, or pencil lines as candidate cracks.
- **No Safety / Severity Rating:** The tool detects surface anomalies; it cannot determine whether a crack threatens structural integrity.
- **No Fabricated Confidence Scores:** Unlike fake demos, CrackVision AI reports genuine computer-vision metrics (candidate contour count, surface pixel area %, processing FPS), not invented AI confidence percentages.

---

## 3. Project Structure

```
CrackVisionAI/
│
├── main.py                  # CLI entry point (Live camera, still image, batch, menu)
├── camera.py                # Live webcam session, DirectShow backend, HUD overlay, hotkeys
├── crack_detector.py        # Modular detector architecture (BaseCrackDetector & Baseline CV)
├── image_processor.py       # File validation, OpenCV loading, CLAHE, denoising, non-destructive I/O
├── create_samples.py        # Generates synthetic concrete test images (cracks, smooth, rough)
├── test_crackvision.py      # Automated unit test suite (11 tests, includes camera & HUD tests)
├── requirements.txt         # Lightweight dependencies (OpenCV, NumPy, Matplotlib)
├── README.md                # Documentation and guide
│
├── sample_images/           # Synthetic test dataset
│   ├── concrete_cracked_wall.jpg
│   ├── concrete_intact_smooth.jpg
│   ├── concrete_intact_rough.jpg
│   ├── concrete_network_cracks.jpg
│   └── concrete_hairline_crack.jpg
│
└── outputs/                 # Dedicated directory for snapshots and annotated results
    └── intermediates/       # (Optional) Debug stages: blackhat, raw mask, preprocessed
```

---

## 4. Installation & Setup (Windows PowerShell / VS Code)

### Step 1: Open VS Code Terminal in the Project Directory
```powershell
cd C:\Users\Abhishek\.gemini\antigravity\scratch\CrackVisionAI
```

### Step 2: Create a virtual environment
```powershell
python -m venv .venv
```

### Step 3: Activate the virtual environment
```powershell
.\.venv\Scripts\Activate.ps1
```
*(If PowerShell displays an execution policy error, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` then re-run activation).*

### Step 4: Install dependencies
```powershell
pip install -r requirements.txt
```

---

## 5. Execution & Interactive Controls

### A. Start Live Camera Inspection
Simply run `main.py` without arguments:
```powershell
python main.py
```
This opens the interactive window titled:  
**`CrackVision AI | Live Inspection`**

#### Interactive Keyboard Controls (Inside the Camera Window):
| Key | Action | Description |
| :---: | :--- | :--- |
| **`Q`** | **Quit** | Safely releases webcam hardware and closes all OpenCV windows. |
| **`S`** | **Snapshot** | Captures the current frame and saves **both** the unannotated raw frame and the annotated detection image to `outputs/` with timestamps. |
| **`P`** | **Pause / Resume** | Freezes the live detection display so you can inspect a crack without camera shake; press again to resume. |
| **`R`** | **Reset** | Clears the detection overlay and re-syncs the live stream. |
| **`I`** | **View Toggle** | Switches between the raw camera feed and the processed detection view. |

### B. Selecting an External Webcam
If you have multiple webcams (e.g., built-in camera vs USB inspection camera), specify the camera index with `-c`:
```powershell
# Open external webcam at index 1:
python main.py -c 1

# Open external webcam at index 2:
python main.py -c 2
```

### C. Adjusting Detection Sensitivity
Use `--sensitivity` or `-s` (`low`, `medium`, `high`):
```powershell
# Strict mode (recommended for rough concrete):
python main.py -c 0 -s low

# High sensitivity (catches fainter hairline cracks):
python main.py -c 0 -s high
```

### D. Still-Image Inspection Mode
Inspect an existing photograph from disk:
```powershell
python main.py -i sample_images\concrete_cracked_wall.jpg
```

Save intermediate debug masks (grayscale, preprocessed, blackhat transform, raw threshold):
```powershell
python main.py -i sample_images\concrete_cracked_wall.jpg --save-intermediates
```

### E. Batch Folder Processing
Analyze all `.jpg`, `.jpeg`, and `.png` images in a directory with an automated summary table:
```powershell
python main.py -f sample_images -s low
```

### F. Interactive Text Menu
If you prefer a numbered menu prompt:
```powershell
python main.py --menu
```

---

## 6. Testing Procedure

### 1. Run Automated Unit Tests (11 Tests)
Verify file I/O, array immutability, detector logic, HUD drawing, snapshot generation, and camera error handling:
```powershell
python -m unittest test_crackvision.py -v
```

### 2. Verify Live Camera Functionality
1. Run `python main.py` in your VS Code terminal.
2. Confirm the window `CrackVision AI | Live Inspection` appears on your screen.
3. Aim the camera at a surface (or a drawn dark line on paper to simulate a crack) and verify that candidate regions are highlighted with red fill, yellow contours, and orange bounding boxes.
4. Press **`P`** to freeze the frame; check that the top badge shows `[PAUSED]`. Press **`P`** again to resume.
5. Press **`I`** to view the raw camera feed without overlays; check that the badge shows `[RAW FEED]`. Press **`I`** again to return to detection view.
6. Press **`S`** to take a snapshot. Check the terminal and `outputs/` folder to confirm two files were saved:
   - `outputs/snapshot_YYYYMMDD_HHMMSS_raw.jpg`
   - `outputs/snapshot_YYYYMMDD_HHMMSS_detected.jpg`
7. Press **`Q`** to exit; verify the camera hardware is released cleanly.

---

## 7. Roadmap & Modular Design for Future Expansion

1. **Modular Base Class (`BaseCrackDetector`):**
   - The detector interface returns a standardized `DetectionResult` dataclass.
   - To integrate a pretrained PyTorch or YOLOv8 segmentation model, implement `DeepLearningCrackDetector(BaseCrackDetector)`. Both `camera.py` and `main.py` will work with zero code changes.
2. **Flask Web Application Ready:**
   - Both `ImageProcessor` and `BaseCrackDetector` are decoupled from terminal printing, making it easy to create a Flask API route for drag-and-drop web uploads and browser-based inspection.

---

## 8. Safety & Engineering Disclaimer

> [!CAUTION]
> **Safety Notice:**  
> CrackVision AI is an educational prototype and preliminary screening tool. It does **not** determine structural safety, calculate crack depth, or replace on-site physical inspection by licensed structural engineers.
