# Image → DXF on Windows

Two ways to use it. **Option A needs nothing installed** - start there if you just want to try it.

| | What you need | Pros | Cons |
|---|---|---|---|
| **A. Browser version** | Chrome, Edge or Firefox | No install, nothing uploaded, works offline | No PDF/TIFF input; image URLs only work for sites that allow it |
| **B. Full version** (Python app) | Internet once (setup installs Python 3.12 if missing) | History in %APPDATA%, auto-update, URL download from any site, TIFF/PDF input (classic screen) | One-time install, runs a small local server |

---

## Option A - browser version (no install)

1. Right-click `image-to-dxf-windows.zip` → **Extract All…** (don't run it from inside the zip).
2. Open the extracted folder and double-click **`open-browser-version.bat`**
   (or open `web\index.html` in your browser).
3. Upload / drag in an image, adjust, pick outlines or grid cells, click **Download DXF**.

Everything happens inside the browser tab; no file leaves your PC.

---

## Option B - full version (Python app)

### 1. Unzip
Right-click `image-to-dxf-windows.zip` → **Extract All…** and pick a normal folder such as `C:\Tools` or *Documents*
(avoid *Program Files* and avoid running it from inside the zip). You get a folder `image-to-dxf-windows`.

### 2. Setup (once, needs internet, 1-5 minutes)
Double-click **`setup.bat`** (the old `install.bat` does the same). It runs `setup.ps1` with PowerShell (execution policy bypassed
for that one run only) and:
1. looks for **Python 3.10+** (`py` launcher, `python` on PATH, the usual install folders). If none is found it installs
   **Python 3.12 for your user account** with `winget`, or - if winget is missing or fails - downloads the official python.org
   installer and runs it silently (per-user, "Add to PATH"). No admin rights needed.
2. creates a private environment in the `venv` folder and installs the components (Flask, OpenCV, NumPy, Shapely, ezdxf…);
3. adds **"Image to DXF" shortcuts** (with icon) to the Desktop and the Start menu;
4. writes everything to **`setup.log`** in the folder.

Optional PDF input: in PowerShell run `powershell -ExecutionPolicy Bypass -File setup.ps1 -Pdf` (or `venv\Scripts\pip install -r requirements-pdf.txt`).
If Windows SmartScreen says *"Windows protected your PC"*: click **More info → Run anyway** (the files are plain text scripts you can open in Notepad).

### 3. Run
Use the **Image to DXF** shortcut (or double-click **`run.bat`**; it runs setup first if needed). A black window opens and, after a few seconds, your browser opens at <http://localhost:5000/>
(if port 5000 is busy the next free port is used; the window tells you which).
**Keep the black window open while using the app**; close it (or press Ctrl+C) to stop.

### 4. Use
The app now opens the same **Hard Version 1.5** interface as the website (tabs Trace · Edit · Frame · Layers · Table/Output · Fold/Box ·
3D Preview · History · All), running from your PC. Differences from the website:
- **History** is stored in `%APPDATA%\ImageToDXF\history` (survives browser data clean-ups and updates).
- **Updates:** *Version* menu → *Check for updates* asks GitHub Releases for a newer build; *Install update* downloads
  `image-to-dxf-windows.zip` and replaces the program files (keeps `venv`, history, settings and logs). Tick **Auto-update** to
  install new releases automatically each time the app starts. After an update restart the app once so the Python parts reload.
- The older server-based screen (with PDF/TIFF input and server-side URL fetching) is still there at <http://localhost:5000/classic/>.

Camera note: browsers only allow the camera on `http://localhost` or HTTPS - that is why you must open the app via the address
`http://localhost:5000/` that `run.bat` opens (not a LAN IP like `http://192.168.x.x:5000`).

### Updating / uninstalling
- Update: *Version* menu → *Check for updates* / *Install update* (or Auto-update). Manual way: extract the new zip over the old folder and run `setup.bat` again.
- Go back to Hard Version 1: download `image-to-dxf-windows-hard-v1.0.zip` from the *Hard Version 1* release on GitHub and extract it to a new folder
  (turn Auto-update off first, or it would update itself again). The website keeps Hard Version 1 at `/v1/`.
- Uninstall: delete the folder, the two shortcuts and (optional) `%APPDATA%\ImageToDXF`. Python itself stays installed (remove it in *Settings → Apps* if you want).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Setup could not install Python | Look in `setup.log`. Install Python 3.12 from python.org yourself and tick **Add python.exe to PATH**; close the window and run `setup.bat` again. Typing `python` and getting the Microsoft Store means Python is *not* installed (or "App execution aliases" are shadowing it: Settings → Apps → Advanced app settings → App execution aliases → turn off *python.exe*). |
| Pip errors / "No matching distribution" / "Could not find a version" | Very new Python versions sometimes lack ready-made packages. Install **Python 3.12**, delete the `venv` folder, run `setup.bat` again. Use 64-bit Python. |
| Pip fails with SSL / connection / proxy errors | Check your internet; on a company network ask IT for the pip proxy, or try another network. |
| Window flashes and closes | Read `setup.log` / `server.log` in the folder, or open *Command Prompt*, `cd` into the folder and run `setup.bat` / `run.bat` there. |
| "Check for updates" fails | Needs internet access to api.github.com; a company proxy may block it. Update manually from the Releases page. |
| Browser doesn't open | Open the address shown in the black window (usually <http://localhost:5000/>) manually. |
| "Address already in use" / page shows something else | `run.bat` picks the next free port automatically; use the URL printed in the window. |
| Firewall prompt | Choose **Cancel / Private networks only**; the app only needs to listen on this PC (`127.0.0.1`). |
| Camera doesn't work | Use `http://localhost:…` (not an IP address), allow the camera in the browser's address-bar popup, close other apps that use the camera. In the browser-only version, camera works from `web\index.html` in Chrome/Edge; if blocked, use the upload tab with a photo from your phone. |
| PDF upload says it isn't available | Run `venv\Scripts\pip install -r requirements-pdf.txt` (or `setup.ps1 -Pdf`) and use <http://localhost:5000/classic/>, or export the page to PNG/JPG. |
| Image URL fails | The site may block downloads. Save the image and upload it. (The browser-only version is stricter: it needs the site to allow cross-origin requests.) |
| Antivirus quarantines something | The batch files are plain text. Add the folder to the exclusion list or use Option A. |

---

## Optional: build a stand-alone `.exe` (advanced)

Not needed for normal use. The exe cannot update itself (download the new zip and rebuild). After `setup.bat`, double-click **`build_exe.bat`**. It installs PyInstaller and produces
`dist\ImageToDXF\ImageToDXF.exe` (plus a copy of `web\`) that you can copy to another Windows PC **without Python**.
Takes several minutes and ~300 MB; the exe opens the same local server + browser page. Antivirus tools sometimes flag
unsigned PyInstaller executables; if that is a problem stick to `run.bat`.

## What's in the folder
`setup.bat` + `setup.ps1` (setup) · `install.bat` (same as setup.bat) · `run.bat` · `icon.ico` · `open-browser-version.bat` · `build_exe.bat` (optional) ·
`app.py`, `desktop_api.py` (history / version / update API), `pipeline.py`, `selection.py`, `urlfetch.py`, `launcher.py` · `web\` (the Hard 1.5 interface,
also usable without install; `web\v1\` is Hard Version 1) · `static\` (older server screen, `/classic/`) · `requirements*.txt` · logs: `setup.log`, `server.log`
