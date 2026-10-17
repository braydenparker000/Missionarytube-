#!/usr/bin/env python3
"""Clone the public Google Drive music library into Cloudflare R2.

Designed for resumable GitHub Actions runs. Object keys are immutable/content-versioned:
  audio/<drive-file-id>/<md5-or-downloaded-sha256>.<extension>

By default, a rerun downloads and hashes R2 objects before skipping them.
Opt-in incremental runs may retain prior full-GET proof after strict identity
checks. The canonical mapping only publishes a complete, stable library.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import http.client
import json
import mimetypes
import os
import random
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

DRIVE_ROOT = "https://www.googleapis.com/drive/v3/files"
AUDIO_RE = re.compile(r"\.(mp3|m4a|m4b|aac|flac|wav|wave|ogg|oga|opus|weba|webm|mp4|aif|aiff|wma|mka)$", re.I)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
EXT_RE = re.compile(r"^[a-z0-9]{1,8}$")
AUDIO_MIME_BY_EXTENSION = {
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "m4b": "audio/mp4", "aac": "audio/aac",
    "flac": "audio/flac", "wav": "audio/wav", "wave": "audio/wav", "ogg": "audio/ogg",
    "oga": "audio/ogg", "opus": "audio/ogg", "weba": "audio/webm", "webm": "audio/webm",
    "mp4": "audio/mp4", "aif": "audio/aiff", "aiff": "audio/aiff",
    "wma": "audio/x-ms-wma", "mka": "audio/x-matroska",
}
RETRYABLE = {408, 429, 500, 502, 503, 504}
LOG_LOCK = threading.Lock()
CHUNK_SIZE = 1024 * 1024
CANONICAL_KEY = "catalog/drive-r2-map-v1.json"
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
DOWNLOAD_INTERVAL = 0.0
DOWNLOAD_LOCK = threading.Lock()
NEXT_DOWNLOAD_AT = 0.0
DRIVE_SECRETS = set()
DRIVE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded", "downloadQuotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg", "insufficientFilePermissions", "appNotAuthorizedToFile", "accessNotConfigured", "forbidden", "fileNotDownloadable", "cannotDownloadAbusiveFile", "domainPolicy", "authError", "notFound", "backendError"}
RATE_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}


class MigrationError(RuntimeError):
    """An error with a controlled message that is safe for public CI logs."""


class DrivePauseError(MigrationError):
    """A source-wide limit means queued downloads should not keep retrying."""


def drive_error_reason(error: urllib.error.HTTPError) -> str:
    if hasattr(error, "_safe_drive_reason"):
        return error._safe_drive_reason
    reason = "unclassified"
    raw = ""
    try:
        raw = error.read(16384).decode("utf-8", errors="replace")
        payload = json.loads(raw)
        data = payload.get("error", {})
        for entry in data.get("errors", []) + data.get("details", []):
            if entry.get("reason") in DRIVE_REASONS:
                reason = entry["reason"]
                break
    except Exception:
        pass
    # Redact the request's key and any URLs/identifiers before keeping a short
    # provider-response diagnostic. This contains no SDK or request repr.
    secrets = urllib.parse.parse_qs(urllib.parse.urlsplit(error.url).query).get("key", [])
    if os.environ.get("GOOGLE_DRIVE_API_KEY"):
        secrets.append(os.environ["GOOGLE_DRIVE_API_KEY"])
    secrets.extend(os.environ.get(name, "") for name in (
        "GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"))
    with LOG_LOCK:
        secrets.extend(DRIVE_SECRETS)
    for value in filter(None, secrets):
        raw = raw.replace(value, "[REDACTED]")
    raw = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw, flags=re.I | re.S)
    raw = html.unescape(re.sub(r"<[^>]*>", " ", raw))
    raw = re.sub(r'https?://[^\s"<>]+', "[URL]", raw)
    raw = re.sub(r"[A-Za-z0-9_./+=-]{24,}", "[IDENTIFIER]", raw)
    raw = re.sub(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b", "[IP]", raw)
    raw = re.sub(r"[^\s@]+@[^\s@]+", "[EMAIL]", raw)
    error._safe_drive_summary = " ".join(raw.split())[:1000]
    error._safe_drive_reason = reason
    return reason


def pace_download() -> None:
    global NEXT_DOWNLOAD_AT
    if DOWNLOAD_INTERVAL <= 0:
        return
    with DOWNLOAD_LOCK:
        now = time.monotonic()
        delay = max(0.0, NEXT_DOWNLOAD_AT - now)
        NEXT_DOWNLOAD_AT = max(now, NEXT_DOWNLOAD_AT) + DOWNLOAD_INTERVAL
    if delay:
        time.sleep(delay)


def retry_delay(error: Exception, attempt: int) -> float:
    requested = None
    if isinstance(error, urllib.error.HTTPError):
        value = error.headers.get("Retry-After") if error.headers else None
        if value:
            try:
                requested = float(value)
            except ValueError:
                try:
                    requested = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
                except (ValueError, TypeError, OverflowError):
                    pass
        rate_limited = error.code == 429 or drive_error_reason(error) in RATE_REASONS
    else:
        rate_limited = False
    fallback = min(64.0 if rate_limited else 20.0, (4.0 if rate_limited else 1.0) * (2**attempt)) + random.random() * 0.5
    if requested is not None and requested > 3600:
        raise DrivePauseError("Drive requested a retry delay over one hour; migration paused without further requests.")
    return max(fallback, requested) if requested is not None and 0 <= requested <= 3600 else fallback


def safe_error(error: Exception) -> str:
    # SDK/network exceptions can contain signed request URLs and credentials.
    # Never copy their messages, repr, response bodies, or tracebacks to reports.
    if isinstance(error, MigrationError):
        return str(error)
    if isinstance(error, urllib.error.HTTPError):
        return f"HTTP {error.code} ({drive_error_reason(error)}; request details omitted)"
    response = getattr(error, "response", {})
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode") if isinstance(response, dict) else None
    if isinstance(status, int):
        return f"R2 HTTP {status} (request details omitted)"
    return f"{type(error).__name__} (details omitted to protect credentials)"


def log(message: str) -> None:
    with LOG_LOCK:
        print(message, flush=True)


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise MigrationError(f"Missing required environment variable: {name}")
    return value


class DriveOAuth:
    """A server-side grant; refreshing is serialized and never logged."""

    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        self.credentials = {"client_id": client_id, "client_secret": client_secret,
                            "refresh_token": refresh_token, "grant_type": "refresh_token"}
        self.lock = threading.Lock()
        self.token = ""
        self.expires_at = 0.0
        self.failed = False

    def __repr__(self):
        return "DriveOAuth(credentials omitted)"

    def headers(self) -> dict[str, str]:
        with self.lock:
            if self.failed:
                raise DrivePauseError("Drive OAuth refresh previously failed; migration remains paused.")
            if time.monotonic() >= self.expires_at:
                request = urllib.request.Request(
                    "https://oauth2.googleapis.com/token",
                    data=urllib.parse.urlencode(self.credentials).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(request, timeout=45) as response:
                        data = json.loads(response.read(65536))
                    token = data.get("access_token")
                    expires_in = float(data.get("expires_in", 0))
                    if not isinstance(token, str) or not token or any(c.isspace() for c in token):
                        raise ValueError("Invalid access token")
                    if not 120 <= expires_in <= 86400:
                        raise ValueError("Invalid token lifetime")
                except Exception:
                    self.failed = True
                    raise DrivePauseError("Drive OAuth refresh failed; check the owner grant and Actions secrets. Provider details omitted.") from None
                self.token = token
                self.expires_at = time.monotonic() + expires_in - 60
                with LOG_LOCK:
                    DRIVE_SECRETS.add(token)
            return {"Authorization": "Bearer " + self.token}


def drive_auth_from_env():
    mode = os.environ.get("GOOGLE_DRIVE_AUTH_MODE", "public_api_key").strip()
    if mode == "oauth":
        return DriveOAuth(*(required_env(name) for name in (
            "GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN")))
    if mode != "public_api_key":
        raise MigrationError("Invalid Google Drive authentication mode.")
    return required_env("GOOGLE_DRIVE_API_KEY")


def drive_url(path: str, params: dict[str, str], auth) -> str:
    query = dict(params)
    if not isinstance(auth, DriveOAuth):
        query["key"] = auth
    return f"{DRIVE_ROOT}{path}?{urllib.parse.urlencode(query)}"


def drive_headers(auth) -> dict[str, str]:
    headers = {"User-Agent": "jarvis-r2-migrator/1.0", "Accept": "*/*"}
    if isinstance(auth, DriveOAuth):
        headers.update(auth.headers())
    return headers


def authorized_drive_request(url: str, auth):
    headers = drive_headers(auth)
    authorization = headers.pop("Authorization", None)
    request = urllib.request.Request(url, headers=headers)
    if authorization:
        # urllib copies ordinary headers to redirects, including other hosts.
        # Send the owner token only on this original Drive API request.
        request.add_unredirected_header("Authorization", authorization)
    return request


def drive_request(path: str, params: dict[str, str], api_key: str, *, raw: bool = False):
    url = drive_url(path, params, api_key)
    last = None
    for attempt in range(6):
        try:
            request = authorized_drive_request(url, api_key)
            response = urllib.request.urlopen(request, timeout=45)
            if raw:
                return response
            with response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 403 and drive_error_reason(exc) not in RATE_REASONS:
                raise DrivePauseError("Drive metadata returned HTTP 403; migration paused without repeated attempts.") from None
            if exc.code not in RETRYABLE and exc.code != 403:
                raise
            if attempt >= 5:
                raise
            retry_after = exc.headers.get("Retry-After")
            try:
                delay = float(retry_after) if retry_after else None
            except ValueError:
                delay = None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
            if attempt >= 5:
                raise
            delay = None
        if delay is None:
            delay = min(20.0, 0.8 * (2**attempt)) + random.random() * 0.5
        time.sleep(delay)
    raise MigrationError(f"Drive request failed: {safe_error(last)}")


def list_music(root_id: str, api_key: str) -> tuple[str, list[dict]]:
    info = drive_request(
        f"/{root_id}",
        {"fields": "id,name,mimeType"},
        api_key,
    )
    if info.get("mimeType") != "application/vnd.google-apps.folder":
        raise MigrationError("Configured music root is not a Drive folder.")

    visited: set[str] = set()
    files: dict[str, dict] = {}
    frontier = [{"id": root_id, "path": info.get("name") or "Music"}]

    def read_folder(current: dict) -> list[dict]:
        children = []
        token = ""
        seen_tokens: set[str] = set()
        while True:
            params = {
                "q": f"'{current['id']}' in parents and trashed = false",
                "pageSize": "1000",
                "fields": "nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,md5Checksum,capabilities(canDownload))",
            }
            if token:
                params["pageToken"] = token
            page = drive_request("", params, api_key)
            if page.get("incompleteSearch") or not isinstance(page.get("files"), list):
                raise MigrationError("Drive returned an incomplete listing; migration stopped.")
            for item in page["files"]:
                if not isinstance(item, dict):
                    raise MigrationError("Drive returned invalid file metadata; migration stopped.")
                fid = item.get("id", "")
                name = item.get("name", "")
                if not isinstance(fid, str) or not ID_RE.fullmatch(fid) or not isinstance(name, str):
                    raise MigrationError("Drive returned invalid file metadata; migration stopped.")
                if item.get("mimeType") == "application/vnd.google-apps.folder":
                    children.append({"id": fid, "path": f"{current['path']}/{name}"})
                elif AUDIO_RE.search(name):
                    record = {
                        **item,
                        "folder": current["path"],
                        "availability": "blocked"
                        if item.get("capabilities", {}).get("canDownload") is False
                        else "ready",
                    }
                    with LOG_LOCK:
                        files[fid] = record
            token = page.get("nextPageToken") or ""
            if not token:
                break
            if token in seen_tokens:
                raise MigrationError("Drive pagination repeated; migration stopped.")
            seen_tokens.add(token)
        return children

    while frontier:
        level = []
        for current in frontier:
            if current["id"] in visited:
                continue
            if len(visited) >= 5000:
                raise MigrationError("Music root contains more than 5,000 folders.")
            visited.add(current["id"])
            level.append(current)
        frontier = []
        for offset in range(0, len(level), 6):
            batch = level[offset : offset + 6]
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(batch))) as pool:
                for children in pool.map(read_folder, batch):
                    frontier.extend(children)
            log(f"Drive inventory: {len(files)} audio files across {len(visited)} folders")

    result = sorted(files.values(), key=lambda item: item["id"])
    return info.get("name") or "Music", result


def source_md5(file: dict) -> str:
    value = file.get("md5Checksum") or ""
    if not isinstance(value, str) or (value and not re.fullmatch(r"[a-fA-F0-9]{32}", value)):
        raise MigrationError("Drive returned an invalid MD5 checksum.")
    return value.lower()


def object_key(file: dict, *, sha256: str = "") -> str:
    if not ID_RE.fullmatch(file.get("id", "")):
        raise MigrationError("Invalid Drive file ID.")
    name = file.get("name", "")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "bin"
    if not EXT_RE.match(ext):
        ext = "bin"
    md5 = source_md5(file)
    if md5:
        version = md5
    else:
        if not re.fullmatch(r"[a-f0-9]{64}", sha256):
            raise MigrationError("A downloaded content hash is required when Drive has no MD5.")
        version = sha256
    return f"audio/{file['id']}/{version}.{ext}"


def content_type(file: dict) -> str:
    mime = (file.get("mimeType") or "").strip()
    if mime.startswith("audio/"):
        return mime
    name = file.get("name", "")
    extension = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    # System MIME databases differ for supported audio containers such as M4B,
    # WAVE and WEBA. Keep catalog delivery deterministic across runner images.
    return AUDIO_MIME_BY_EXTENSION.get(extension) or mimetypes.guess_type(name)[0] or "application/octet-stream"


def r2_client(account_id: str, access_key: str, secret_key: str):
    # Keep local unit tests and --help dependency-free; only live transfer needs boto3.
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 10, "mode": "adaptive"},
            connect_timeout=20,
            read_timeout=90,
            max_pool_connections=16,
        ),
    )


def missing_object(error: Exception) -> bool:
    details = getattr(error, "response", {})
    if not isinstance(details, dict):
        return False
    code = str(details.get("Error", {}).get("Code", ""))
    return code in {"404", "NoSuchKey", "NotFound"} or details.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404


def r2_identity(response: dict) -> dict | None:
    """Capture an object identity, never a substitute for initial byte hashing.

    LastModified, ETag and checksum metadata must all exist. The identity stored
    in a baseline comes from the SAME GET response whose entire body was hashed,
    so a later HEAD cannot accidentally bless an overwrite after that GET.
    """
    modified = response.get("LastModified")
    etag = response.get("ETag")
    metadata = response.get("Metadata")
    size = response.get("ContentLength")
    if (not isinstance(modified, datetime) or modified.tzinfo is None
            or not isinstance(etag, str) or not re.fullmatch(r'"?[a-fA-F0-9]{32}(?:-[0-9]+)?"?', etag)
            or not isinstance(metadata, dict) or type(size) is not int or size <= 0):
        return None
    required = ("source-drive-id", "source-md5", "source-sha256", "source-size")
    if not all(isinstance(metadata.get(key), str) for key in required):
        return None
    identity = {
        "etag": etag,
        "lastModified": modified.astimezone(timezone.utc).isoformat(),
        "size": size,
        "metadata": {key: metadata[key] for key in required},
    }
    version = response.get("VersionId")
    if version is not None:
        if not isinstance(version, str) or not version or len(version) > 1024:
            return None
        identity["versionId"] = version
    return identity


def remote_hashes_if_verified(client, bucket: str, key: str, expected_size: int, *, md5: str = "", sha256: str = "", include_identity: bool = False) -> dict | None:
    """Read the entire stored object. HEAD metadata and ETags are not byte proof."""
    if not md5 and not sha256:
        raise MigrationError("R2 verification requires an expected content hash.")
    try:
        response = client.get_object(Bucket=bucket, Key=key)
    except Exception as exc:
        if missing_object(exc):
            return None
        raise
    body = response["Body"]
    try:
        if int(response.get("ContentLength", -1)) != expected_size:
            return None
        digest_md5, digest_sha256 = hashlib.md5(), hashlib.sha256()
        size = 0
        while chunk := body.read(CHUNK_SIZE):
            size += len(chunk)
            if size > expected_size:
                return None
            digest_md5.update(chunk)
            digest_sha256.update(chunk)
        hashes = {"md5": digest_md5.hexdigest(), "sha256": digest_sha256.hexdigest(), "size": size}
        if size != expected_size or (md5 and hashes["md5"] != md5) or (sha256 and hashes["sha256"] != sha256):
            return None
        if include_identity:
            hashes["r2Identity"] = r2_identity(response)
        return hashes
    finally:
        body.close()


def download_drive_file(file: dict, api_key: str, destination: Path) -> dict:
    params = {"alt": "media"}
    url = drive_url(f"/{file['id']}", params, api_key)
    expected_size = int(file["size"])
    expected_md5 = source_md5(file)

    for attempt in range(6):
        md5 = hashlib.md5()
        sha256 = hashlib.sha256()
        total = 0
        try:
            request = authorized_drive_request(url, api_key)
            pace_download()
            with urllib.request.urlopen(request, timeout=90) as response, destination.open("wb") as out:
                while True:
                    chunk = response.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > expected_size:
                        raise MigrationError("Drive response exceeded expected file size.")
                    md5.update(chunk)
                    sha256.update(chunk)
                    out.write(chunk)
            digest = md5.hexdigest()
            if total != expected_size:
                raise MigrationError(f"Drive response was incomplete ({total}/{expected_size} bytes).")
            if expected_md5 and digest != expected_md5:
                raise MigrationError("Drive MD5 verification failed.")
            return {"size": total, "md5": digest, "sha256": sha256.hexdigest()}
        except urllib.error.HTTPError as exc:
            if exc.code not in RETRYABLE and exc.code != 403:
                raise
            reason = drive_error_reason(exc)
            if attempt == 0:
                log(f"Drive download response: HTTP {exc.code}; reason={reason}. Request details omitted.")
                if exc.code == 403:
                    log("Sanitized Drive response: " + getattr(exc, "_safe_drive_summary", "No readable body"))
            if exc.code == 403 and reason == "unclassified":
                raise DrivePauseError("Drive returned an unclassified HTTP 403; paused for diagnosis without repeated attempts.") from None
            if reason in {"downloadQuotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"}:
                raise DrivePauseError(f"Drive source quota reached ({reason}); migration paused without further downloads.") from None
            if exc.code == 403 and reason not in RATE_REASONS and reason != "unclassified":
                raise MigrationError(f"Drive refused this download ({reason}); no access restriction was bypassed.") from None
            error = exc
        except DrivePauseError:
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, MigrationError) as exc:
            error = exc
        destination.unlink(missing_ok=True)
        if attempt >= 5:
            if isinstance(error, urllib.error.HTTPError) and (error.code == 429 or drive_error_reason(error) in RATE_REASONS):
                raise DrivePauseError(f"Drive rate limit persisted after backoff: {safe_error(error)}") from None
            raise MigrationError(f"Download failed after retries: {safe_error(error)}") from None
        time.sleep(retry_delay(error, attempt))
    raise MigrationError("Unreachable download failure.")


def migrate_one(client, bucket: str, api_key: str, public_base: str, temp_root: Path, file: dict) -> dict:
    if file.get("availability") != "ready":
        raise MigrationError("Drive reports this file as non-downloadable.")
    size = int(file.get("size") or 0)
    if size <= 0:
        raise MigrationError("Invalid Drive file size.")

    if not ID_RE.fullmatch(file.get("id", "")):
        raise MigrationError("Invalid Drive file ID.")
    expected_md5 = source_md5(file)
    tmp = temp_root / f"{file['id']}.part"
    downloaded = None
    try:
        # A metadata revision is not a content hash. Missing-MD5 sources must be
        # downloaded again on resume to establish the actual immutable key.
        if not expected_md5:
            downloaded = download_drive_file(file, api_key, tmp)
        key = object_key(file, sha256=downloaded["sha256"] if downloaded else "")
        hashes = remote_hashes_if_verified(
            client, bucket, key, size, md5=expected_md5,
            sha256=downloaded["sha256"] if downloaded else "", include_identity=True,
        )
        if hashes:
            status = "skipped"
        else:
            downloaded = downloaded or download_drive_file(file, api_key, tmp)
            client.upload_file(
                str(tmp), bucket, key,
                ExtraArgs={
                    "ContentType": content_type(file),
                    "CacheControl": "public, max-age=31536000, immutable",
                    "Metadata": {
                        "source-drive-id": file["id"],
                        "source-md5": downloaded["md5"],
                        "source-sha256": downloaded["sha256"],
                        "source-size": str(size),
                    },
                },
            )
            hashes = remote_hashes_if_verified(
                client, bucket, key, size, md5=downloaded["md5"], sha256=downloaded["sha256"], include_identity=True,
            )
            if not hashes:
                raise MigrationError("R2 downloaded-byte/hash verification failed.")
            status = "copied"
    finally:
        tmp.unlink(missing_ok=True)

    url = f"{public_base.rstrip('/')}/{key}" if public_base else ""
    return {
        "driveId": file["id"],
        "key": key,
        "url": url,
        "name": file.get("name", ""),
        "folder": file.get("folder", ""),
        "size": size,
        "md5": hashes["md5"],
        "sourceMd5": expected_md5,
        "sha256": hashes["sha256"],
        "verifiedBytes": hashes["size"],
        "verification": "r2-get-hash-v1",
        "verificationCheck": "get-hash-v1",
        "byteVerifiedAt": datetime.now(timezone.utc).isoformat(),
        "sourceRevision": inventory_revision([file]),
        "r2Identity": hashes.get("r2Identity"),
        "mimeType": content_type(file),
        "modifiedTime": file.get("modifiedTime", ""),
        "status": status,
    }


def json_bytes(payload: dict | list) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def upload_json(client, bucket: str, key: str, payload: dict, *, cache_control: str,
                precondition: dict | None = None) -> None:
    body = json_bytes(payload)
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType="application/json; charset=utf-8",
            CacheControl=cache_control,
            **(precondition or {}),
        )
    except Exception as exc:
        if precondition:
            status = getattr(exc, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode")
            if status in {409, 412}:
                raise MigrationError("Canonical R2 baseline changed at publication; conditional write refused.") from None
            if type(exc).__name__ == "ParamValidationError":
                raise MigrationError("R2 client lacks conditional publication support; refusing an unconditional write.") from None
        raise
    if not remote_hashes_if_verified(client, bucket, key, len(body), sha256=hashlib.sha256(body).hexdigest()):
        raise MigrationError(f"R2 verification failed for {key}.")


def inventory_revision(inventory: list[dict]) -> str:
    """Reject a library that changed during transfer, including renames/removals."""
    fields = ("id", "name", "folder", "size", "md5Checksum", "modifiedTime", "mimeType", "availability")
    snapshot = [{field: file.get(field, "") for field in fields} for file in sorted(inventory, key=lambda item: item["id"])]
    return hashlib.sha256(json_bytes(snapshot)).hexdigest()


def reusable_evidence(file: dict) -> bool:
    """Require retained byte proof and checksum metadata tied to that proof."""
    identity = file.get("r2Identity")
    if not isinstance(identity, dict):
        return False
    try:
        modified = datetime.fromisoformat(identity["lastModified"])
        verified = datetime.fromisoformat(file["byteVerifiedAt"])
        # Re-run the same identity parser for serialized baseline evidence.
        response = {"ETag": identity["etag"], "LastModified": modified,
                    "ContentLength": identity["size"], "Metadata": identity["metadata"]}
        if "versionId" in identity:
            response["VersionId"] = identity["versionId"]
        return (verified.tzinfo is not None and r2_identity(response) == identity
                and identity["size"] == file["size"]
                and identity["metadata"] == {
                    "source-drive-id": file["driveId"], "source-md5": file["md5"],
                    "source-sha256": file["sha256"], "source-size": str(file["size"]),
                }
                and file.get("sourceMd5") == file["md5"]
                and bool(re.fullmatch(r"[a-f0-9]{64}", file.get("sourceRevision", "")))
                and file.get("verificationCheck") in {"get-hash-v1", "prior-get-head-v1"})
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def read_canonical(client, bucket: str) -> tuple[bytes, str] | None:
    """Read a bounded manifest; access/network failures must not become misses."""
    try:
        response = client.get_object(Bucket=bucket, Key=CANONICAL_KEY)
    except Exception as exc:
        if missing_object(exc):
            return None
        raise
    body = response["Body"]
    try:
        declared = response.get("ContentLength")
        if type(declared) is not int or not 0 <= declared <= MAX_MANIFEST_BYTES:
            raise MigrationError("Invalid or oversized canonical R2 mapping; incremental run stopped.")
        data = body.read(MAX_MANIFEST_BYTES + 1)
        if len(data) != declared or len(data) > MAX_MANIFEST_BYTES:
            raise MigrationError("Incomplete or oversized canonical R2 mapping; incremental run stopped.")
        etag = response.get("ETag")
        if not isinstance(etag, str) or not re.fullmatch(r'"?[a-fA-F0-9]{32}(?:-[0-9]+)?"?', etag):
            raise MigrationError("Canonical R2 mapping lacks a conditional-write identity; incremental run stopped.")
        return data, etag
    finally:
        body.close()


def load_incremental_baseline(client, bucket: str, root_id: str) -> dict:
    snapshot = read_canonical(client, bucket)
    raw, etag = snapshot if snapshot is not None else (None, None)
    baseline = {"sha256": hashlib.sha256(raw).hexdigest() if raw is not None else None,
                "etag": etag, "files": {}}
    if raw is not None:
        try:
            report = json.loads(raw)
            validate_report(report)
            if (report["mode"] == "full" and report["complete"] is True
                    and report.get("driveRootId") == root_id and report.get("r2Bucket") == bucket):
                baseline["files"] = {file["driveId"]: file for file in report["files"]}
        except (MigrationError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
            pass
    if not baseline["files"]:
        log("No valid complete canonical baseline; using full R2 GET verification for every file.")
    return baseline


def head_matches_evidence(client, bucket: str, file: dict) -> bool:
    if not reusable_evidence(file):
        return False
    try:
        response = client.head_object(Bucket=bucket, Key=file["key"])
    except Exception as exc:
        if missing_object(exc):
            return False
        raise
    return r2_identity(response) == file["r2Identity"]


def migrate_incremental_one(client, bucket: str, api_key: str, public_base: str,
                            temp_root: Path, file: dict, baseline: dict) -> dict:
    previous = baseline["files"].get(file["id"])
    # A missing source checksum cannot establish unchanged content, even when
    # size and modifiedTime match. Keep the original Drive-download path.
    if (previous and file.get("availability") == "ready" and source_md5(file)
            and previous.get("sourceRevision") == inventory_revision([file])
            and previous.get("key") == object_key(file)
            and head_matches_evidence(client, bucket, previous)):
        return {
            **previous,
            "url": f"{public_base.rstrip('/')}/{previous['key']}" if public_base else "",
            "status": "skipped",
            "verificationCheck": "prior-get-head-v1",
            "baselineSha256": baseline["sha256"],
            "identityCheckedAt": datetime.now(timezone.utc).isoformat(),
        }
    return migrate_one(client, bucket, api_key, public_base, temp_root, file)


def recheck_incremental_baseline(client, bucket: str, baseline: dict, results: list[dict]) -> None:
    # Catch changes early, then also use a conditional canonical PUT so a
    # publisher racing after this check cannot be overwritten silently.
    snapshot = read_canonical(client, bucket)
    raw, etag = snapshot if snapshot is not None else (None, None)
    digest = hashlib.sha256(raw).hexdigest() if raw is not None else None
    if digest != baseline["sha256"] or etag != baseline["etag"]:
        raise MigrationError("Canonical R2 baseline changed during migration; refusing publication.")
    for file in results:
        if reusable_evidence(file):
            unchanged = head_matches_evidence(client, bucket, file)
        else:
            unchanged = remote_hashes_if_verified(client, bucket, file["key"], file["size"],
                                                  md5=file["md5"], sha256=file["sha256"])
        if not unchanged:
            raise MigrationError("An R2 object changed during migration; refusing publication.")


def validate_report(report: dict) -> None:
    """All guards run before writing either staging or the canonical mapping."""
    files = report.get("files", [])
    if (report.get("version") != 1 or report.get("verification") != "r2-get-hash-v1"
            or report.get("mode") not in {"full", "smoke"} or not files
            or report.get("failures") or report.get("failedCount") != 0
            or report.get("verifiedCount") != len(files) or report.get("selectedCount") != len(files)):
        raise MigrationError("Refusing to publish an incomplete or unverified R2 mapping.")
    if report["mode"] == "full" and (report.get("complete") is not True
            or len(files) != report.get("inventoryCount")
            or sum(file["size"] for file in files) != report.get("inventoryBytes")):
        raise MigrationError("Refusing to publish incomplete canonical R2 mapping.")
    if report["mode"] == "smoke" and report.get("complete") is not False:
        raise MigrationError("Smoke mappings must never be marked complete.")
    seen = set()
    for file in files:
        fid = file.get("driveId", "")
        if (not ID_RE.fullmatch(fid) or fid in seen or file.get("verification") != "r2-get-hash-v1"
                or file.get("size", 0) <= 0 or file.get("verifiedBytes") != file.get("size")
                or not re.fullmatch(r"[a-f0-9]{32}", file.get("md5", ""))
                or not re.fullmatch(r"[a-f0-9]{64}", file.get("sha256", ""))
                or (file.get("sourceMd5") and file["sourceMd5"] != file["md5"])):
            raise MigrationError("Refusing to publish invalid R2 file verification evidence.")
        expected_key = object_key({"id": fid, "name": file["name"], "md5Checksum": file.get("sourceMd5", "")}, sha256=file["sha256"])
        if file.get("key") != expected_key:
            raise MigrationError("Refusing to publish a non-content-versioned R2 key.")
        check = file.get("verificationCheck")
        if check not in {None, "get-hash-v1", "prior-get-head-v1"}:
            raise MigrationError("Unknown R2 verification check.")
        if check == "prior-get-head-v1" and (
                report.get("transferMode") != "incremental" or report.get("mode") != "full"
                or not reusable_evidence(file)
                or not re.fullmatch(r"[a-f0-9]{64}", file.get("baselineSha256", ""))
                or file.get("baselineSha256") != report.get("baselineSha256")):
            raise MigrationError("Refusing to publish unbound prior R2 byte verification evidence.")
        seen.add(fid)


def publish_report(client, bucket: str, report: dict, *, baseline: dict | None = None) -> str:
    validate_report(report)
    precondition = None
    if report.get("transferMode") == "incremental":
        if baseline is None or baseline["sha256"] != report.get("baselineSha256"):
            raise MigrationError("Incremental publication requires its original canonical baseline.")
        precondition = {"IfMatch": baseline["etag"]} if baseline["etag"] else {"IfNoneMatch": "*"}
    # Validate the exact manifest bytes in R2 before making them discoverable at
    # the well-known URL. A smoke run never writes the canonical mapping.
    digest = hashlib.sha256(json_bytes(report)).hexdigest()
    upload_json(client, bucket, f"catalog/versions/{digest}.json", report, cache_control="public, max-age=31536000, immutable")
    key = CANONICAL_KEY if report["mode"] == "full" else "catalog/drive-r2-smoke-v1.json"
    upload_json(client, bucket, key, report, cache_control="no-cache", precondition=precondition)
    return key


def main() -> int:
    global DOWNLOAD_INTERVAL
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5, help="0 means full library; positive values are smoke-test item counts")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--incremental", action="store_true",
                        help="opt in to prior full-GET proof reuse after HEAD identity checks; requires --limit 0")
    args = parser.parse_args()
    if args.limit < 0 or args.concurrency < 1 or args.concurrency > 8:
        raise MigrationError("Invalid limit/concurrency.")
    if args.incremental and args.limit != 0:
        raise MigrationError("Incremental mode requires --limit 0; smoke runs always verify all bytes.")
    DOWNLOAD_INTERVAL = float(os.environ.get("DRIVE_DOWNLOAD_INTERVAL_SECONDS", "0"))
    if not 0 <= DOWNLOAD_INTERVAL <= 60:
        raise MigrationError("Invalid Drive download interval.")

    api_key = drive_auth_from_env()
    account_id = required_env("R2_ACCOUNT_ID")
    access_key = required_env("R2_ACCESS_KEY_ID")
    secret_key = required_env("R2_SECRET_ACCESS_KEY")
    bucket = required_env("R2_BUCKET")
    public_base = os.environ.get("R2_PUBLIC_BASE_URL", "").strip()
    if public_base:
        parsed = urllib.parse.urlsplit(public_base)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise MigrationError("R2 public base must be an HTTPS URL without credentials, query, or fragment.")

    repo_root = Path(__file__).resolve().parents[1]
    config = json.loads((repo_root / "public/assets/drive-config.json").read_text("utf-8"))
    root_id = os.environ.get("MUSIC_ROOT_ID", config.get("folderId", "")).strip()
    if not ID_RE.fullmatch(root_id):
        raise MigrationError("Invalid Drive music root ID.")

    client = r2_client(account_id, access_key, secret_key)
    client.head_bucket(Bucket=bucket)
    log(f"R2 destination verified: bucket={bucket}")
    root_name, inventory = list_music(root_id, api_key)
    if not inventory:
        raise MigrationError("Drive music inventory is empty; existing R2 mapping will not be replaced.")
    source_revision = inventory_revision(inventory)
    total_inventory_bytes = sum(int(item.get("size") or 0) for item in inventory)
    log(f"Authoritative Drive inventory: {len(inventory)} tracks, {total_inventory_bytes / 1_000_000_000:.2f} GB")

    baseline = load_incremental_baseline(client, bucket, root_id) if args.incremental else None
    selected = inventory if args.limit == 0 else inventory[: args.limit]
    mode = "full" if args.limit == 0 else "smoke"
    log(f"Starting {mode} migration for {len(selected)} tracks with concurrency={args.concurrency}")
    if DOWNLOAD_INTERVAL:
        log(f"Drive download pacing: at least {DOWNLOAD_INTERVAL:g} seconds between new requests")

    results: list[dict] = []
    failures: list[dict] = []
    completed = 0
    with tempfile.TemporaryDirectory(prefix="drive-r2-") as tmp:
        temp_root = Path(tmp)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            worker = migrate_incremental_one if args.incremental else migrate_one
            extra = (baseline,) if args.incremental else ()
            future_map = {
                pool.submit(worker, client, bucket, api_key, public_base, temp_root, item, *extra): item
                for item in selected
            }
            for future in concurrent.futures.as_completed(future_map):
                item = future_map[future]
                try:
                    results.append(future.result())
                except Exception as exc:
                    error = safe_error(exc)
                    failures.append({"driveId": item.get("id"), "name": item.get("name"), "error": error[:500]})
                    log(f"FAILED {item.get('id')}: {error[:200]}")
                    if isinstance(exc, DrivePauseError):
                        for pending in future_map:
                            pending.cancel()
                        log("Source-wide limit: queued downloads cancelled. Verified R2 objects are preserved.")
                        break
                completed += 1
                if completed % 25 == 0 or completed == len(selected):
                    copied = sum(1 for r in results if r["status"] == "copied")
                    skipped = sum(1 for r in results if r["status"] == "skipped")
                    log(f"Progress {completed}/{len(selected)} · copied={copied} skipped={skipped} failed={len(failures)}")

    results.sort(key=lambda r: r["driveId"])
    report = {
        "version": 1,
        "mode": mode,
        "complete": False,
        "verification": "r2-get-hash-v1",
        "sourceRevision": source_revision,
        "transferMode": "incremental" if args.incremental else "full-verification",
        "baselineSha256": baseline["sha256"] if baseline else None,
        "reusedCount": sum(1 for r in results if r.get("verificationCheck") == "prior-get-head-v1"),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "driveRootId": root_id,
        "driveRootName": root_name,
        "r2Bucket": bucket,
        "publicBaseUrl": public_base,
        "inventoryCount": len(inventory),
        "inventoryBytes": total_inventory_bytes,
        "selectedCount": len(selected),
        "verifiedCount": len(results),
        "copiedCount": sum(1 for r in results if r["status"] == "copied"),
        "skippedCount": sum(1 for r in results if r["status"] == "skipped"),
        "failedCount": len(failures),
        "failures": failures,
        "files": results,
    }
    report_path = repo_root / "r2-migration-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")

    if failures:
        log(f"Migration incomplete: {len(failures)} files failed. Safe to rerun; verified R2 objects will be skipped.")
        return 2

    if {file["driveId"] for file in results} != {file["id"] for file in selected} or len(results) != len(selected):
        raise MigrationError("Refusing to publish a mapping that differs from the selected Drive inventory.")
    if mode == "full":
        log("Rechecking the complete Drive inventory before publishing the canonical mapping")
        _, final_inventory = list_music(root_id, api_key)
        if inventory_revision(final_inventory) != source_revision:
            raise MigrationError("Drive library changed during migration; rerun before publishing a canonical mapping.")
        if args.incremental:
            recheck_incremental_baseline(client, bucket, baseline, results)
        report["complete"] = True
    catalog_key = publish_report(client, bucket, report, baseline=baseline)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    log(f"Migration verified. Published {catalog_key} with {len(results)} objects.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise
    except Exception as exc:
        print(f"Migration failed: {safe_error(exc)}", file=sys.stderr, flush=True)
        raise SystemExit(1)
