"""The practice server shares one attempt across devices without silent overwrites or file leaks."""

import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location(
    "practice_server", ROOT / "scripts/practice_server.py"
)
practice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(practice)

PROJECT = {"attempt": {"chapters": []}, "draft": {"index": None}, "files": {}}
HEADERS = {"Content-Type": "application/json", "X-Nexo-Practice": "1"}


@pytest.fixture
def running(tmp_path):
    (tmp_path / "dist/practice").mkdir(parents=True)
    (tmp_path / "dist/practice/index.html").write_text("<h1>practice</h1>")
    (tmp_path / "__init__.py").write_text("SECRET = 1\n")
    httpd = practice.server(tmp_path, "127.0.0.1", 0)
    Thread(target=httpd.serve_forever, daemon=True).start()
    yield tmp_path, httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def call(port, method, path, body=None, headers=None):
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    data = json.dumps(body) if body is not None else None
    connection.request(method, path, data, headers or {})
    response = connection.getresponse()
    payload = response.read()
    connection.close()
    return response, json.loads(payload) if payload.startswith(b"{") else payload


def save(port, expected, project=PROJECT, headers=HEADERS):
    body = {"expected_revision": expected, "project": project}
    return call(port, "PUT", practice.API, body, headers)


def test_empty_then_saved_attempt_is_shared_and_marked_as_host_storage(running):
    root, port = running
    response, _ = call(port, "GET", practice.API)
    assert response.status == 204 and response.getheader("X-Nexo-Practice-Store") == "host"
    response, result = save(port, None)
    assert response.status == 200
    response, saved = call(port, "GET", practice.API)
    assert saved == {"revision": result["revision"], "project": PROJECT}
    assert json.loads((root / ".local/practice/project.json").read_text()) == saved


def test_stale_revision_is_rejected_and_keeps_the_winner(running):
    _, port = running
    _, first = save(port, None)
    with ThreadPoolExecutor(4) as pool:
        statuses = sorted(
            response.status
            for response, _ in pool.map(lambda _: save(port, first["revision"]), range(4))
        )
    assert statuses == [200, 409, 409, 409]
    response, _ = save(port, first["revision"])
    assert response.status == 409


def test_daily_backup_keeps_the_first_saved_version(running):
    root, port = running
    _, first = save(port, None)
    _, second = save(port, first["revision"], {**PROJECT, "note": "second"})
    save(port, second["revision"], {**PROJECT, "note": "third"})
    backups = list((root / ".local/practice/backups").glob("*.json"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text()) == {"revision": first["revision"], "project": PROJECT}


@pytest.mark.parametrize(
    "headers",
    [
        {"Content-Type": "application/json"},
        {"Content-Type": "text/plain", "X-Nexo-Practice": "1"},
    ],
)
def test_cross_site_style_writes_are_refused(running, headers):
    _, port = running
    response, _ = save(port, None, headers=headers)
    assert response.status == 403
    assert call(port, "GET", practice.API)[0].status == 204


@pytest.mark.parametrize(
    "body",
    [
        {"project": PROJECT},
        {"expected_revision": "", "project": PROJECT},
        {"expected_revision": None, "project": {"draft": {}}},
    ],
)
def test_malformed_saves_are_refused(running, body):
    _, port = running
    assert call(port, "PUT", practice.API, body, HEADERS)[0].status == 400


def test_serves_only_static_pages(running):
    _, port = running
    response, body = call(port, "GET", "/static/practice/index.html")
    assert response.status == 200 and b"practice" in body
    for path in ["/static/../__init__.py", "/static/%2e%2e/__init__.py", "/__init__.py"]:
        response, body = call(port, "GET", path)
        assert b"SECRET" not in body
        assert response.status in {302, 404}
    assert call(port, "POST", practice.API, PROJECT, HEADERS)[0].status == 404


@pytest.mark.parametrize(
    ("address", "allowed"),
    [
        ("127.0.0.1", True),
        ("192.168.1.20", True),
        ("10.0.0.5", True),
        ("::ffff:192.168.1.20", True),
        ("fe80::1", True),
        ("100.101.102.87", True),
        ("8.8.8.8", False),
        ("2001:4860:4860::8888", False),
    ],
)
def test_only_local_network_clients_are_answered(address, allowed):
    assert practice.private_client(address) is allowed
