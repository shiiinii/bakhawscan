# BakhawScan backend

FastAPI server that runs `weights/best.pt` and answers `POST /predict` for the web app.

## One-time setup (Windows, in your bakhawscan folder)

    bakhaw-env\Scripts\activate
    pip install -r backend\requirements.txt

(torch and ultralytics are already in bakhaw-env.)

## Run

    cd backend
    uvicorn main:app --host 0.0.0.0 --port 8000

You should see: `Model loaded: best.pt on GPU; classes: {...}`
Check it in a browser: http://localhost:8000/health

## Connect the web app

1. In a second terminal: `cd web` then `python -m http.server 8080`
2. Open http://localhost:8080
3. Settings > Detection source > My FastAPI model, API address `http://localhost:8000`

Use localhost for both. A hosted HTTPS page cannot call a plain http API.

## Settings (optional environment variables)

CONF_FLOOR (0.10), NMS_IOU (0.5), IMGSZ (640), MAX_DET (300), HIDE_CLASSES (Healthy_leaves), ALLOWED_ORIGINS (*).
Example: `set NMS_IOU=0.4` then start uvicorn.
