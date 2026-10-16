# Image → DXF on Windows

Two ways to use it. **Option A needs nothing installed** - start there if you just want to try it.

| | What you need | Pros | Cons |
|---|---|---|---|
| **A. Browser version** | Chrome, Edge or Firefox | No install, nothing uploaded, works offline | No PDF/TIFF input; image URLs only work for sites that allow it |
| **B. Full version** (Python app) | Python 3.10+ (free), internet once | URL download from any site, TIFF/PDF input | One-time install, runs a small local server |

---

## Option A - browser version (no install)

1. Right-click `image-to-dxf-windows.zip` → **Extract All…** (don't run it from inside the zip).
2. Open the extracted folder and double-click **`open-browser-version.bat`**
   (or open `web\index.html` in your browser).
3. Upload / drag in an image, adjust, pick outlines or grid cells, click **Download DXF**.

Everything happens inside the browser tab; no file leaves your PC.

---

## Option B - full version (Python app)

### 1. Install Python (once)
1. Go to <https://www.python.org/downloads/windows/> and download **Python 3.12** (64-bit). 3.10 or newer works.
2. Run the installer. **On the first screen tick "Add python.exe to PATH"** (bottom of the window), then *Install Now*.
3. Skip this step if you already have Python 3.10+ (check: open *Command Prompt* and type `py --version`).

### 2. Unzip
Right-click `image-to-dxf-windows.zip` → **Extract All…** and pick a normal folder such as `C:\Tools` or *Documents*
(avoid *Program Files* and avoid running it from inside the zip). You get a folder `image-to-dxf-windows`.

### 3. Install (once, needs internet, 1-3 minutes)
Double-click **`install.bat`**. It checks for Python 3.10+, creates a private environment in the `venv` folder and downloads the components
(Flask, OpenCV, NumPy, Shapely, ezdxf…). It asks whether you want optional **PDF input** (PyMuPDF) - answer `y` if you will upload scanned PDFs.
Wait for **"Install finished"**.

If Windows SmartScreen says *"Windows protected your PC"*: click **More info → Run anyway** (the file is a plain text script you can open in Notepad).

### 4. Run
Double-click **`run.bat`**. A black window opens and, after a few seconds, your browser opens at <http://localhost:5000/>
(if port 5000 is busy the next free port is used; the window tells you which).
**Keep the black window open while using the app**; close it (or press Ctrl+C) to stop.

### 5. Use
1. **Source:** upload/drag an image, use a web link, or the camera tab.
2. **Processing:** set the threshold, output width in mm or inches, etc.
3. Optionally show the **grid** and click cells, drag a box, or click outlines to pick only what you need.
4. **Download DXF** (or a zip of separate files, per your split choice).

Camera note: browsers only allow the camera on `http://localhost` or HTTPS - that is why you must open the app via the address
`http://localhost:5000/` that `run.bat` opens (not a LAN IP like `http://192.168.x.x:5000`).

### Updating / uninstalling
- Update: extract the new zip over the old folder, run `install.bat` again.
- Uninstall: delete the folder. (Nothing is installed system-wide except Python itself.)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `install.bat` says *Python 3.10 or newer was not found* | Install Python from python.org and tick **Add python.exe to PATH**; close the window and run `install.bat` again. Typing `python` and getting the Microsoft Store means Python is *not* installed (or "App execution aliases" are shadowing it: Settings → Apps → Advanced app settings → App execution aliases → turn off *python.exe*). |
| Pip errors / "No matching distribution" / "Could not find a version" | Very new Python versions sometimes lack ready-made packages. Install **Python 3.12**, delete the `venv` folder, run `install.bat` again. Use 64-bit Python. |
| Pip fails with SSL / connection / proxy errors | Check your internet; on a company network ask IT for the pip proxy, or try another network. |
| Window flashes and closes | Open *Command Prompt*, `cd` into the folder and run `install.bat` / `run.bat` there to read the message. |
| Browser doesn't open | Open the address shown in the black window (usually <http://localhost:5000/>) manually. |
| "Address already in use" / page shows something else | `run.bat` picks the next free port automatically; use the URL printed in the window. |
| Firewall prompt | Choose **Cancel / Private networks only**; the app only needs to listen on this PC (`127.0.0.1`). |
| Camera doesn't work | Use `http://localhost:…` (not an IP address), allow the camera in the browser's address-bar popup, close other apps that use the camera. In the browser-only version, camera works from `web\index.html` in Chrome/Edge; if blocked, use the upload tab with a photo from your phone. |
| PDF upload says it isn't available | Re-run `install.bat` and answer `y` to the PDF question (or: `venv\Scripts\pip install -r requirements-pdf.txt`), or export the page to PNG/JPG. |
| Image URL fails | The site may block downloads. Save the image and upload it. (The browser-only version is stricter: it needs the site to allow cross-origin requests.) |
| Antivirus quarantines something | The batch files are plain text. Add the folder to the exclusion list or use Option A. |

---

## Optional: build a stand-alone `.exe` (advanced)

Not needed for normal use. After `install.bat`, double-click **`build_exe.bat`**. It installs PyInstaller and produces
`dist\ImageToDXF\ImageToDXF.exe` (plus a copy of `web\`) that you can copy to another Windows PC **without Python**.
Takes several minutes and ~300 MB; the exe opens the same local server + browser page. Antivirus tools sometimes flag
unsigned PyInstaller executables; if that is a problem stick to `run.bat`.

## What's in the folder
`install.bat` · `run.bat` · `open-browser-version.bat` · `build_exe.bat` (optional) · `app.py`, `pipeline.py`, `selection.py`, `urlfetch.py`, `launcher.py`, `static\` (the app) ·
`web\` (browser-only edition) · `requirements*.txt`
