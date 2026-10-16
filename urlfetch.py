"""SSRF-safe URL fetching."""
import ipaddress
import socket
from urllib.parse import urlparse, urljoin

import requests
import urllib3.util.connection as u3conn

MAX_BYTES = 20 * 1024 * 1024
MAX_REDIRECTS = 5
TIMEOUT = (5, 15)


class FetchError(ValueError):
    pass


def _ip_ok(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return False
    if getattr(a, "ipv4_mapped", None):
        a = a.ipv4_mapped
    return a.is_global and not a.is_multicast


def check_url(url: str) -> str:
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https"):
        raise FetchError("Only http and https URLs are allowed")
    if not u.hostname:
        raise FetchError("URL has no host")
    if u.username or u.password:
        raise FetchError("Credentials in URL not allowed")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise FetchError("Could not resolve host")
    if not infos or not all(_ip_ok(i[4][0]) for i in infos):
        raise FetchError("URL resolves to a non-public address (blocked)")
    return u.geturl()


# Connection-time guard: re-validates the IP actually connected to (defeats DNS rebinding).
_orig_create_connection = u3conn.create_connection


def _guarded_create_connection(address, *a, **kw):
    host, port = address
    host = host.strip("[]")
    last = None
    for fam, st, proto, _, sa in socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM):
        if not _ip_ok(sa[0]):
            last = FetchError("blocked non-public address")
            continue
        return _orig_create_connection((sa[0], port), *a, **kw)
    raise last or OSError("no usable address")


u3conn.create_connection = _guarded_create_connection


def fetch(url: str) -> bytes:
    s = requests.Session()
    s.trust_env = False  # ignore proxy env vars
    cur = url
    for _ in range(MAX_REDIRECTS + 1):
        cur = check_url(cur)
        try:
            r = s.get(cur, stream=True, timeout=TIMEOUT, allow_redirects=False,
                      headers={"User-Agent": "image-to-dxf/1.0"})
        except Exception as e:
            raise FetchError(f"Fetch failed: {type(e).__name__}")
        with r:
            if r.status_code in (301, 302, 303, 307, 308):
                loc = r.headers.get("Location")
                if not loc:
                    raise FetchError("Bad redirect")
                cur = urljoin(cur, loc)
                continue
            if r.status_code != 200:
                raise FetchError(f"Remote server returned HTTP {r.status_code}")
            cl = r.headers.get("Content-Length")
            if cl and cl.isdigit() and int(cl) > MAX_BYTES:
                raise FetchError("File too large (limit 20 MB)")
            buf = bytearray()
            for chunk in r.iter_content(65536):
                buf += chunk
                if len(buf) > MAX_BYTES:
                    raise FetchError("File too large (limit 20 MB)")
            return bytes(buf)
    raise FetchError("Too many redirects")
