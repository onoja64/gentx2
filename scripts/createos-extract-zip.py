#!/usr/bin/env python3
import os
import pathlib
import stat
import sys
import zipfile

MAX_FILES = 10_000
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024


def fail(message):
    print(message[:240], file=sys.stderr)
    raise SystemExit(2)


def safe_path(name):
    if "\x00" in name or "\\" in name or name.startswith("/"):
        fail("unsafe archive path")
    path = pathlib.PurePosixPath(name)
    if any(part in ("", ".", "..") for part in path.parts):
        fail("unsafe archive path component")
    return path


def main():
    if len(sys.argv) != 3:
        fail("usage: extract-zip ARCHIVE DESTINATION")
    archive = pathlib.Path(sys.argv[1])
    root = pathlib.Path(sys.argv[2]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if not str(root).startswith("/workspace/"):
        fail("destination outside workspace")
    try:
        zf = zipfile.ZipFile(archive, "r")
    except Exception:
        fail("invalid or unreadable ZIP")
    entries = zf.infolist()
    if len(entries) > MAX_FILES:
        fail("archive file-count limit exceeded")
    total = 0
    seen = set()
    extracted = 0
    for item in entries:
        relative = safe_path(item.filename.rstrip("/")) if not item.is_dir() else safe_path(item.filename.rstrip("/"))
        path_key = relative.as_posix()
        if path_key in seen:
            fail("duplicate archive path")
        seen.add(path_key)
        if item.flag_bits & 0x1:
            fail("encrypted ZIP entries are not accepted")
        mode = (item.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(mode) or (mode and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
            fail("links and special files are not accepted")
        if item.file_size > MAX_FILE_BYTES:
            fail("single file size limit exceeded")
        total += item.file_size
        if total > MAX_TOTAL_BYTES:
            fail("archive expansion limit exceeded")
        target = (root / pathlib.Path(*relative.parts)).resolve()
        if not str(target).startswith(str(root) + os.sep):
            fail("archive path escapes destination")
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with zf.open(item, "r") as source, open(target, "xb") as output:
            while True:
                chunk = source.read(CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > item.file_size or written > MAX_FILE_BYTES:
                    fail("archive entry exceeded declared size")
                output.write(chunk)
        if written != item.file_size:
            fail("archive entry size mismatch")
        extracted += 1
    zf.close()
    print(f"EXTRACT_OK files={extracted} bytes={total}")


if __name__ == "__main__":
    main()
