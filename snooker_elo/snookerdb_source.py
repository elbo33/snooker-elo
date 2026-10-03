from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_REPO = "obrienjoey/snookerdb"
DEFAULT_REF = "main"
DEFAULT_DB_PATH = "Database/snookerdb.db"
DEFAULT_API_URL = "https://api.github.com/repos/{repo}/contents/{path}?ref={ref}"


@dataclass(frozen=True)
class RemoteDatabaseInfo:
    repo: str
    ref: str
    path: str
    sha: str
    size: int
    download_url: str
    html_url: str


@dataclass(frozen=True)
class SnookerDBUpdateStatus:
    local_path: str
    local_exists: bool
    local_sha: str | None
    remote_sha: str
    remote_size: int
    download_url: str
    is_current: bool


def fetch_remote_database_info(
    repo: str = DEFAULT_REPO,
    path: str = DEFAULT_DB_PATH,
    ref: str = DEFAULT_REF,
    token: str | None = None,
) -> RemoteDatabaseInfo:
    """Read GitHub's content metadata for the published SnookerDB SQLite file."""
    url = DEFAULT_API_URL.format(repo=repo, path=path, ref=ref)
    payload = _request_json(url, token=token)
    return RemoteDatabaseInfo(
        repo=repo,
        ref=ref,
        path=path,
        sha=payload["sha"],
        size=int(payload["size"]),
        download_url=payload["download_url"],
        html_url=payload["html_url"],
    )


def check_snookerdb_update(
    local_path: str | Path = "data/snookerdb.db",
    repo: str = DEFAULT_REPO,
    source_path: str = DEFAULT_DB_PATH,
    ref: str = DEFAULT_REF,
    token: str | None = None,
) -> SnookerDBUpdateStatus:
    remote = fetch_remote_database_info(repo=repo, path=source_path, ref=ref, token=token)
    path = Path(local_path)
    local_sha = git_blob_sha(path) if path.exists() else None
    return SnookerDBUpdateStatus(
        local_path=str(path),
        local_exists=path.exists(),
        local_sha=local_sha,
        remote_sha=remote.sha,
        remote_size=remote.size,
        download_url=remote.download_url,
        is_current=local_sha == remote.sha,
    )


def download_snookerdb(
    local_path: str | Path = "data/snookerdb.db",
    repo: str = DEFAULT_REPO,
    source_path: str = DEFAULT_DB_PATH,
    ref: str = DEFAULT_REF,
    token: str | None = None,
) -> SnookerDBUpdateStatus:
    remote = fetch_remote_database_info(repo=repo, path=source_path, ref=ref, token=token)
    destination = Path(local_path)
    destination.parent.mkdir(parents=True, exist_ok=True)

    fd, temp_name = tempfile.mkstemp(prefix=f"{destination.name}.", suffix=".tmp", dir=destination.parent)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        _download(remote.download_url, temp_path, token=token)
        downloaded_sha = git_blob_sha(temp_path)
        if downloaded_sha != remote.sha:
            raise ValueError(
                f"Downloaded database SHA {downloaded_sha} did not match GitHub SHA {remote.sha}"
            )
        shutil.move(str(temp_path), destination)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    return SnookerDBUpdateStatus(
        local_path=str(destination),
        local_exists=True,
        local_sha=remote.sha,
        remote_sha=remote.sha,
        remote_size=remote.size,
        download_url=remote.download_url,
        is_current=True,
    )


def git_blob_sha(path: str | Path) -> str:
    """Return the same SHA GitHub reports for a file in the contents API."""
    file_path = Path(path)
    size = file_path.stat().st_size
    digest = hashlib.sha1()
    digest.update(f"blob {size}\0".encode())
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _request_json(url: str, token: str | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=_headers(token))
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def _download(url: str, destination: Path, token: str | None = None) -> None:
    request = urllib.request.Request(url, headers=_headers(token))
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def _headers(token: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "snooker-elo",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers
