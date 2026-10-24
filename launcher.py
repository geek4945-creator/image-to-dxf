"""Start the local server on a free port and open the browser. Used by run.bat (and the optional PyInstaller exe).

  python launcher.py [--port 5000] [--host 127.0.0.1] [--no-browser]
"""
import argparse
import os
import subprocess
import socket
import sys
import threading
import time
import urllib.request
import webbrowser


def free_port(host, start):
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit(f"No free port found in {start}-{start + 49}")


def auto_update():
    """Hard 1.5: if 'Auto-update' is on (Version menu), install a newer GitHub release before the server starts."""
    try:
        import desktop_api as da
        if not da.load_settings().get("auto_update"):
            return
        print("Checking for updates ...", flush=True)
        info = da.check_update()
        if info.get("available"):
            print(f"Installing update {info['current']} -> {info['latest']} ...", flush=True)
            print(da.apply_update(info)["message"], flush=True)
            if not os.environ.get("I2D_RESTARTED"):          # restart once so updated Python files are used
                os.environ["I2D_RESTARTED"] = "1"
                sys.exit(subprocess.call([sys.executable] + sys.argv))
        else:
            print(f"Up to date ({info.get('current')}).", flush=True)
    except SystemExit:
        raise
    except Exception as e:                                    # never block start-up on an update problem
        print(f"Update check skipped: {e}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5000)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    port = free_port(a.host, a.port)
    auto_update()
    from app import app  # imported late so import errors show a readable message below

    url = f"http://{'localhost' if a.host in ('127.0.0.1', '0.0.0.0') else a.host}:{port}/"

    def ready_then_open():
        for _ in range(100):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1).read()
                break
            except Exception:
                time.sleep(0.2)
        if not a.no_browser:
            webbrowser.open(url)

    threading.Thread(target=ready_then_open, daemon=True).start()
    print("=" * 60)
    print(f"  Image to DXF is running at  {url}")
    print("  Keep this window open while you use it. Press Ctrl+C or close the window to stop.")
    print("=" * 60, flush=True)
    app.run(host=a.host, port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    try:
        main()
    except ImportError as e:
        print(f"\nMissing component: {e}\nRun install.bat again (or: pip install -r requirements.txt).")
        sys.exit(1)
