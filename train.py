"""
BakhawScan - continue training YOLOv8n locally (settings for a 4 GB GPU).

Put this file inside your bakhawscan folder, next to:
    weights/run1_best.pt
    dataset/data.yaml

Run (with your virtual environment activated):
    python train.py
"""
from pathlib import Path

import torch
from ultralytics import YOLO

BASE = Path(__file__).resolve().parent
WEIGHTS = BASE / "weights" / "run1_best.pt"
DATA = BASE / "dataset" / "data.yaml"
PROJECT = BASE / "runs_local"

EPOCHS = 50
IMGSZ = 640
BATCH = 4          # 4 GB GPU: if you still get "out of memory", use 2
PATIENCE = 20
RUN_NAME = "run2"


def main():
    if not WEIGHTS.exists():
        raise FileNotFoundError(f"Weights not found: {WEIGHTS}")
    if not DATA.exists():
        raise FileNotFoundError(f"data.yaml not found: {DATA}")

    use_gpu = torch.cuda.is_available()
    print("GPU available:", use_gpu, torch.cuda.get_device_name(0) if use_gpu else "")
    if use_gpu:
        torch.cuda.empty_cache()

    model = YOLO(str(WEIGHTS))
    model.train(
        data=str(DATA),
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=BATCH,
        patience=PATIENCE,
        optimizer="SGD",   # the automatic choice picked "MuSGD", which needs extra GPU memory
        lr0=0.005,         # gentler learning rate for continuing from run1
        seed=0,
        workers=2,
        cache=False,
        device=0 if use_gpu else "cpu",
        project=str(PROJECT),
        name=RUN_NAME,
        exist_ok=True,     # reuse runs_local/run2 instead of creating run22, run23...
    )

    best = YOLO(str(PROJECT / RUN_NAME / "weights" / "best.pt"))
    best.val(data=str(DATA), split="test", imgsz=IMGSZ, batch=BATCH)


if __name__ == "__main__":
    main()
