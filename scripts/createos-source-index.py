#!/usr/bin/env python3
import json
import os
import re

ROOT = "/workspace/target"
MAX_FILES = 40
MAX_FILE_BYTES = 20_000
ALLOWED_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java",
    ".js", ".jsx", ".php", ".py", ".rb", ".rs", ".sql", ".svelte", ".ts",
    ".tsx", ".vue",
}
SKIP_DIRS = {".git", ".next", "build", "coverage", "dist", "node_modules", "secrets", "vendor"}
SKIP_BASENAME = re.compile(r"^(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$", re.I)


def main():
    found = []
    for current, dirs, files in os.walk(ROOT, followlinks=False):
        dirs[:] = sorted(name for name in dirs if name.lower() not in SKIP_DIRS and not name.startswith("."))
        for name in sorted(files):
            if name.startswith(".") or SKIP_BASENAME.fullmatch(name):
                continue
            path = os.path.join(current, name)
            if os.path.islink(path):
                continue
            relative = os.path.relpath(path, ROOT).replace(os.sep, "/")
            extension = os.path.splitext(name)[1].lower()
            if extension not in ALLOWED_EXTENSIONS or re.search(r"[\s\x00-\x1f\x7f\\]", relative):
                continue
            try:
                size = os.stat(path, follow_symlinks=False).st_size
            except OSError:
                continue
            if 0 < size <= MAX_FILE_BYTES:
                found.append({"path": relative, "size": size})
                if len(found) >= MAX_FILES:
                    print(json.dumps(found, separators=(",", ":")))
                    return
    print(json.dumps(found, separators=(",", ":")))


if __name__ == "__main__":
    main()
