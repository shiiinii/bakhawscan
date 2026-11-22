"""
BakhawScan backend - FastAPI wrapper around the trained YOLOv8n model.

Run from this folder (with your virtual environment activated):
    uvicorn main:app --host 0.0.0.0 --port 8000

Endpoints
    GET  /health    -> model status and class names
    POST /predict   -> form field "file" (an image); returns boxes in pixels of that image

Optional settings (environment variables)
    MODEL_PATH       path to the weights        (default: weights/best.pt)
    CONF_FLOOR       lowest confidence returned (default: 0.10, the app's slider minimum)
    NMS_IOU          overlap limit for NMS      (default: 0.5, removes duplicate boxes)
    IMGSZ            inference image size       (default: 640, same as training)
    MAX_DET          most boxes per image       (default: 300)
    HIDE_CLASSES     classes not returned       (default: Healthy_leaves)
    ALLOWED_ORIGINS  comma-separated origins    (default: * = any, fine for local testing)
"""
import io
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError

BASE = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("MODEL_PATH", BASE / "weights" / "best.pt"))
CONF_FLOOR = float(os.getenv("CONF_FLOOR", "0.10"))
NMS_IOU = float(os.getenv("NMS_IOU", "0.5"))
IMGSZ = int(os.getenv("IMGSZ", "640"))
MAX_DET = int(os.getenv("MAX_DET", "300"))
HIDE = {c.strip() for c in os.getenv("HIDE_CLASSES", "Healthy_leaves").split(",") if c.strip()}
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
MAX_BYTES = 15 * 1024 * 1024

state = {"model": None, "device": "cpu"}
lock = threading.Lock()  # the live camera can send overlapping requests; run them one at a time


@asynccontextmanager
async def lifespan(app: FastAPI):
    import torch
    from ultralytics import YOLO

    if not MODEL_PATH.exists():
        raise RuntimeError(f"Model file not found: {MODEL_PATH}")
    state["device"] = 0 if torch.cuda.is_available() else "cpu"
    state["model"] = YOLO(str(MODEL_PATH))
    # warm-up so the first real request is not slow
    state["model"].predict(Image.new("RGB", (IMGSZ, IMGSZ)), imgsz=IMGSZ, device=state["device"], verbose=False)
    print(f"Model loaded: {MODEL_PATH.name} on {'GPU' if state['device'] == 0 else 'CPU'}; classes: {state['model'].names}")
    yield


app = FastAPI(title="BakhawScan API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    m = state["model"]
    return {
        "status": "ok" if m is not None else "loading",
        "model": MODEL_PATH.name,
        "device": "gpu" if state["device"] == 0 else "cpu",
        "classes": list(m.names.values()) if m is not None else [],
        "returned_classes_exclude": sorted(HIDE),
    }


# Plain "def" (not async): FastAPI runs it in a worker thread, so inference does not block the server.
@app.post("/predict")
def predict(file: UploadFile = File(...)):
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image is larger than 15 MB.")
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="The file is not a readable image.")

    w, h = img.size
    with lock:
        result = state["model"].predict(
            img, conf=CONF_FLOOR, iou=NMS_IOU, imgsz=IMGSZ,
            max_det=MAX_DET, device=state["device"], verbose=False,
        )[0]

    names = result.names
    detections = []
    if result.boxes is not None and len(result.boxes):
        xyxy = result.boxes.xyxy.cpu().numpy()
        conf = result.boxes.conf.cpu().numpy()
        cls = result.boxes.cls.cpu().numpy().astype(int)
        for (x1, y1, x2, y2), c, k in zip(xyxy, conf, cls):
            name = names[int(k)]
            if name in HIDE:
                continue
            detections.append({
                "class_name": name,
                "confidence": round(float(c), 4),
                "box": [round(float(x1), 1), round(float(y1), 1), round(float(x2), 1), round(float(y2), 1)],
            })
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    return {"image_width": w, "image_height": h, "detections": detections}
