"""Serve the study pages to devices on the home network and keep one shared practice attempt.

Run on the Mac that hosts Nexo, not in Kubernetes. Every device opening
http://<this-mac>:8095/static/practice/index.html reads and saves the same attempt, stored in
.local/practice/project.json. Only loopback, private-network and Tailscale clients are answered.

    browser A ─GET─┐                      ┌─ project.json (revision r1)
    browser B ─PUT {expected: r1}─▶ lock ─┤  matches r1 → write, return r2
    browser A ─PUT {expected: r1}─▶ lock ─┘  stale → 409, A reloads; nothing is overwritten
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import posixpath
import tempfile
import threading
import uuid
from datetime import date
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs
try:
    from .tutor import TutorStore, PROVIDERS
except ImportError:
    from tutor import TutorStore, PROVIDERS

ROOT = Path(__file__).resolve().parents[1]
PORT = 8095
API = "/static/practice/api/project"  # "api/project" relative to the practice page.
MAX_BYTES = 64 * 1024 * 1024  # Pasted images are stored inline as data URLs.
TAILNET = ipaddress.ip_network("100.64.0.0/10")  # Tailscale addresses; not "private" to Python.


class Conflict(Exception):
    pass


class ProjectStore:
    """One JSON file holding {revision, project}; the revision check and write share one lock."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def load(self) -> dict | None:
        with self.lock:
            return self._read()

    def _read(self) -> dict | None:
        try:
            return json.loads(self.path.read_text())
        except FileNotFoundError:
            return None

    def save(self, project: dict, expected: str | None) -> str:
        with self.lock:
            saved = self._read()
            if (saved["revision"] if saved else None) != expected:
                raise Conflict
            revision = str(uuid.uuid4())
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if saved:
                backup = self.path.parent / "backups" / f"{date.today().isoformat()}.json"
                backup.parent.mkdir(exist_ok=True)
                try:
                    with backup.open("x") as handle:
                        json.dump(saved, handle)
                except FileExistsError:
                    pass
            # Write a temporary file, then rename it, so a crash never leaves half a project.
            descriptor, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".project.")
            try:
                with os.fdopen(descriptor, "w") as handle:
                    json.dump({"revision": revision, "project": project}, handle)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
            except BaseException:
                os.unlink(temporary)
                raise
            return revision


def parse_save(body: bytes) -> tuple[dict, str | None]:
    """Check the envelope only; the practice page validates the project itself on load."""
    payload = json.loads(body)
    if not isinstance(payload, dict) or set(payload) != {"expected_revision", "project"}:
        raise ValueError("Expected expected_revision and project.")
    expected, project = payload["expected_revision"], payload["project"]
    if expected is not None and (not isinstance(expected, str) or not expected):
        raise ValueError("expected_revision must be a revision string or null.")
    if not isinstance(project, dict) or not {"attempt", "draft", "files"} <= set(project):
        raise ValueError("project must contain attempt, draft and files.")
    return project, expected


def private_client(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip in TAILNET


class PracticeHandler(SimpleHTTPRequestHandler):
    store: ProjectStore
    tutor: TutorStore

    def reply(self, status: int, payload: dict | None = None) -> None:
        body = json.dumps(payload).encode() if payload is not None else b""
        self.send_response(status)
        # The page reads this header to know it should save here instead of in the browser.
        self.send_header("X-Nexo-Practice-Store", "host")
        self.send_header("Cache-Control", "no-store")
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self) -> bool:
        if private_client(self.client_address[0]):
            return True
        self.send_error(403, "Only devices on this network can use practice.")
        return False

    def static_path(self) -> str | None:
        """The page path below /static/, decoded and normalized, or None for anything else."""
        path = posixpath.normpath(unquote(urlsplit(self.path).path))
        return path.removeprefix("/static") if path.startswith("/static/") else None

    def static(self) -> bool:
        return self.static_path() is not None and self.path != API

    def translate_path(self, path: str) -> str:
        # The served directory is static/ itself, so a decoded ".." has nowhere outside to reach.
        return super().translate_path(self.static_path() or "/missing")

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        if not self.allowed():
            return
        if urlsplit(self.path).path == "/static/practice/api/tutor":
            try:
                ident = parse_qs(urlsplit(self.path).query).get("id", [""])[0]
                self.reply(200, self.tutor.public(ident))
            except ValueError as error:
                self.reply(400, {"error": str(error)})
        elif self.path == API:
            saved = self.store.load()
            if saved:
                self.reply(200, saved)
            else:
                self.reply(204)
        elif self.static():
            super().do_GET()
        else:
            self.send_response(302)
            self.send_header("Location", "/static/practice/index.html")
            self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        if not self.allowed():
            return
        if self.static():
            super().do_HEAD()
        else:
            self.send_error(405)

    def do_POST(self):
        if not self.allowed(): return
        if self.path not in ["/static/practice/api/tutor/ask", "/static/practice/api/tutor/cancel"]:
            self.reply(404, {"error": "Unknown action."}); return
        if self.headers.get("X-Nexo-Practice") != "1" or self.headers.get_content_type() != "application/json":
            self.reply(403, {"error": "Missing request headers."}); return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= 12_000_000: raise ValueError("Request too large.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict): raise ValueError("Expected an object.")
            result = self.tutor.cancel(payload.get("id")) if self.path.endswith("/cancel") else self.tutor.ask(payload)
            self.reply(200, result)
        except (ValueError, TypeError) as error:
            self.reply(400, {"error": str(error)})
        except OSError:
            self.reply(503, {"error": "Host could not save the conversation."})

    def do_PUT(self) -> None:  # noqa: N802
        if not self.allowed():
            return
        if self.path != API:
            self.send_error(405)
            return
        # A custom header and JSON type force a CORS preflight, which this server never approves,
        # so another website open in a LAN browser cannot overwrite the attempt.
        if self.headers.get("X-Nexo-Practice") != "1" or self.headers.get_content_type() != (
            "application/json"
        ):
            self.reply(403, {"error": "Missing practice request headers."})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BYTES:
            self.reply(413, {"error": "The practice project is empty or too large."})
            return
        try:
            project, expected = parse_save(self.rfile.read(length))
            revision = self.store.save(project, expected)
        except Conflict:
            self.reply(409, {"error": "This attempt changed on another device or tab."})
        except ValueError as error:
            self.reply(400, {"error": str(error)})
        except OSError:
            self.reply(503, {"error": "The Mac could not save the attempt. Retry."})
        else:
            self.reply(200, {"revision": revision})

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        if self.path != API:  # Autosave runs every few seconds; keep the log readable.
            super().log_message(format, *args)


def server(root: Path, host: str, port: int) -> ThreadingHTTPServer:
    store = ProjectStore(root / ".local/practice/project.json")
    saved = store.load()
    if saved:
        entries = [saved["project"], *saved["project"].get("past", [])]
        changed = False
        for number, entry in enumerate(reversed(entries), 1):
            if not entry.get("attemptNumber"):
                entry["attemptNumber"] = number
                changed = True
            if not entry["draft"].get("id"):
                entry["draft"]["id"] = uuid.uuid4().hex
                changed = True
            for chapter in entry["attempt"]["chapters"]:
                if not chapter.get("id"):
                    chapter["id"] = uuid.uuid4().hex
                    changed = True
            if not entry.get("drawingId"):
                entry["drawingId"] = uuid.uuid4().hex
                changed = True
        if changed: store.save(saved["project"], saved["revision"])
    handler = partial(PracticeHandler, directory=str(root / "dist"))
    PracticeHandler.store = store
    PracticeHandler.tutor = TutorStore(root / ".local/tutor")
    return ThreadingHTTPServer((host, port), handler)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="0.0.0.0", help="Interface to listen on.")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    httpd = server(ROOT, args.host, args.port)
    page = f"http://<this-mac>:{args.port}/static/practice/index.html"
    print(f"Sketchbook: {page} (Ctrl+C to stop)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
