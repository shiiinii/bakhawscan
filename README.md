# BakhawScan — Improved Progressive Web App

An updated **static PWA frontend** for the BakhawScan student research project. It preserves the original `POST /predict` FastAPI integration and does not require Node.js, React, Streamlit, or a frontend build step.

## What's new

- Responsive desktop sidebar and mobile bottom navigation.
- Overview with saved scan counts and recent observations.
- Improved leaf scanner with camera/file input, drag and drop, a confidence slider, and clear simulated-versus-model labels.
- Results screen with an image comparison toggle, per-class counts, confidence scores, educational leaf-condition notes, and exports (annotated PNG and JSON).
- Local history with up to **12 saved scans** (photo preview, timestamp, mode, bounding boxes), delete controls, and reopen functionality.
- Experimental **bounding-box photo coverage** indicator with explicitly unvalidated low/moderate/high bands. **This is not an estimate of actual damaged leaf area and not a medical/plant disease diagnosis.**
- Learn page with the three supported symptom classes and four mangrove species mentioned in the original proposal.
- Installable PWA with a cached frontend shell. The trained model **does not work offline** unless separately implemented.

## Folder layout

```text
bakhawscan-upgraded/
├── README.md
└── web/
    ├── index.html           # Site layout and pages
    ├── styles.css           # Responsive design
    ├── app.js               # Scanner, history, charts, settings, API integration
    ├── manifest.webmanifest # PWA identity
    ├── sw.js                # Offline app shell
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

## Run it on your computer

1. Extract the ZIP.
2. Open a terminal in the `web` folder.
3. Run `python -m http.server 8000` (or `py -m http.server 8000` on Windows).
4. Open `http://localhost:8000` in Chrome or Edge.
5. Use **Demo** mode to explore the UI without a backend. Demo draws **random placeholder boxes** and cannot detect actual spots.

> Don't run it by double-clicking `index.html` if you want installable/offline PWA behavior. Use `localhost` or a hosted HTTPS URL.

## Connect a trained YOLOv8s model

**Important:** The ZIP contains only the frontend. There is no `best.pt`, model training code, or FastAPI server bundled in this ZIP. A running backend is required for real model-powered results.

1. Run/deploy your FastAPI backend with the trained model and a `POST /predict` route.
2. Open **Settings → Detection source → My FastAPI model**.
3. Enter the base API URL, for example `https://your-api.example.com` (without `/predict`).
4. Return to **Leaf scanner**, choose an image, and select **Analyze leaf**.

### API contract (unchanged from original)

The frontend sends a multipart form upload:

```http
POST /predict
Content-Type: multipart/form-data
file: <uploaded JPEG>
```

The response must be JSON and contain:

```json
{
  "image_width": 1280,
  "image_height": 960,
  "detections": [
    {
      "class_name": "Brown_spot",
      "confidence": 0.92,
      "box": [120, 85, 180, 145]
    }
  ]
}
```

- `box` coordinates are `[x1,y1,x2,y2]` in **pixels**, relative to the uploaded image.
- Supported classes are `Black_spot`, `Brown_spot`, and `White_spot` (plural and underscore/case variants are accepted).
- Confidence values must be decimal scores between `0` and `1`.
- The frontend resizes the image to at most 1280 px on its longest side before uploading.
- If the frontend and API use different origins, configure **CORS** on the FastAPI backend to allow your frontend's actual origin.
- A hosted HTTPS website must use a reachable **HTTPS API**. The app cannot run a Python backend inside GitHub Pages.
- If your current API returns a different schema, adjust `parseDetections()` in `app.js` or adjust the backend response.

## Hosting the frontend for free with GitHub Pages

1. Create or open the GitHub repository for your frontend.
2. Move/upload the **contents of `web/`** (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`) to the repository root. Alternatively, put them in a `docs/` directory for Pages.
3. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, `main`, and `/ (root)` (or `/docs` if using that folder).
4. After the site is published, open the GitHub Pages address. The PWA frontend is now public; you can install it on compatible browsers.
5. The detection model will work only after its backend is hosted separately and configured in the app.

If you publish a new version, update the cache name in `web/sw.js` (for example `bakhawscan-shell-v3`) so installed browsers pick up the new assets.

## Data and limitations

- History data is stored **only in the current browser's localStorage**. It does not sync to GitHub or a server, and clearing site data may remove it. Browser quotas may allow fewer than 12 entries.
- Real-model photos are uploaded to the configured external API during inference. Consider the backend's privacy/storage policy if deploying to real users.
- Demo results are random simulations. The app labels demo scans separately from API scans.
- The experimental severity-like *spotting proxy* is calculated from the fraction of the **entire photo covered by the union of detection rectangles** (an approximate grid computation). It **does not** segment the leaf or measure damaged pixels. The displayed low/moderate/high thresholds are illustrative, not scientifically validated.
- Model confidence is not the probability that a specific disease is present. The PWA cannot identify disease causes or mangrove species from detections.
- Existing icons are kept from the original archive.
