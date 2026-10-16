"""Build image-to-dxf-windows.zip and image-to-dxf-web.zip (output next to the project folder)."""
import os, shutil, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
WINFILES = os.path.join(HERE, "windows")           # bat files + WINDOWS-INSTALL.md live here
APP = ["app.py", "pipeline.py", "selection.py", "urlfetch.py", "launcher.py",
       "requirements.txt", "requirements-pdf.txt", "requirements-dev.txt", "README.md"]
SKIP = {"__pycache__", ".venv", "venv", "tests", ".pytest_cache", "server.log"}


def crlf(path):
    b = open(path, "rb").read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    open(path, "wb").write(b)


def copytree(src, dst):
    shutil.copytree(src, dst, ignore=lambda d, names: [n for n in names if n in SKIP or n.endswith(".pyc")])


def zipdir(folder, zpath, root):
    if os.path.exists(zpath):
        os.remove(zpath)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for d, _, files in os.walk(folder):
            for f in sorted(files):
                full = os.path.join(d, f)
                z.write(full, os.path.join(root, os.path.relpath(full, folder)))


def main():
    win = os.path.join(OUT, "image-to-dxf-windows")
    shutil.rmtree(win, ignore_errors=True)
    os.makedirs(win)
    for f in APP:
        shutil.copy(os.path.join(HERE, f), win)
    copytree(os.path.join(HERE, "static"), os.path.join(win, "static"))
    copytree(os.path.join(HERE, "web"), os.path.join(win, "web"))
    for f in os.listdir(WINFILES):
        shutil.copy(os.path.join(WINFILES, f), win)
    for f in os.listdir(win):
        if f.endswith((".bat", ".txt")):
            crlf(os.path.join(win, f))
    # the Windows package doesn't need dev deps
    os.remove(os.path.join(win, "requirements-dev.txt"))
    zipdir(win, os.path.join(OUT, "image-to-dxf-windows.zip"), "image-to-dxf-windows")
    webz = os.path.join(OUT, "image-to-dxf-web.zip")
    zipdir(os.path.join(HERE, "web"), webz, "image-to-dxf-web")
    print("built", os.path.join(OUT, "image-to-dxf-windows.zip"), webz)


if __name__ == "__main__":
    main()
