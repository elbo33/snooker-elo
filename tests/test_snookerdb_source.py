from __future__ import annotations

import hashlib

from snooker_elo import snookerdb_source
from snooker_elo.snookerdb_source import RemoteDatabaseInfo, check_snookerdb_update, git_blob_sha


def test_git_blob_sha_matches_github_content_sha_format(tmp_path):
    path = tmp_path / "sample.db"
    data = b"sqlite bytes"
    path.write_bytes(data)

    expected = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

    assert git_blob_sha(path) == expected


def test_check_update_compares_local_blob_sha_to_remote(monkeypatch, tmp_path):
    path = tmp_path / "snookerdb.db"
    path.write_bytes(b"current database")
    sha = git_blob_sha(path)

    def fake_remote(repo, path, ref, token=None):
        return RemoteDatabaseInfo(
            repo=repo,
            ref=ref,
            path=path,
            sha=sha,
            size=123,
            download_url="https://example.test/snookerdb.db",
            html_url="https://example.test/blob/snookerdb.db",
        )

    monkeypatch.setattr(snookerdb_source, "fetch_remote_database_info", fake_remote)

    status = check_snookerdb_update(path)

    assert status.local_exists is True
    assert status.local_sha == sha
    assert status.remote_sha == sha
    assert status.is_current is True
