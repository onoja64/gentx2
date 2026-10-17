#!/usr/bin/env python3
import os
import re
import subprocess
import sys

ROOT = "/workspace/target"
PATCH_FILE = "/workspace/tmp/whitehat.patch"
ALLOWED_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java",
    ".js", ".jsx", ".php", ".py", ".rb", ".rs", ".sql", ".svelte", ".ts",
    ".tsx", ".vue",
}
FORBIDDEN = {".git", ".next", "build", "coverage", "dist", "node_modules", "secrets", "vendor"}
SKIP_BASENAME = re.compile(r"^(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$", re.I)


def fail(message):
    print(message[:300], file=sys.stderr)
    return 2


def main():
    try:
        with open(PATCH_FILE, "r", encoding="utf-8", errors="strict") as stream:
            diff = stream.read(12_001)
        if not diff or len(diff) > 12_000 or "\x00" in diff:
            return fail("Patch is empty or oversized")
        lines = diff.replace("\r\n", "\n").split("\n")
        if len(lines) < 4 or not lines[0].startswith("--- a/") or not lines[1].startswith("+++ b/"):
            return fail("Patch headers are invalid")
        relative = lines[0][6:]
        if lines[1][6:] != relative or not relative or relative.startswith("/") or "\\" in relative:
            return fail("Patch must target one relative file")
        pieces = relative.split("/")
        basename = pieces[-1].lower()
        extension = os.path.splitext(basename)[1]
        if any(piece in ("", ".", "..") or piece.startswith("-") or not re.fullmatch(r"[A-Za-z0-9_.@+-]+", piece) or piece.lower() in FORBIDDEN for piece in pieces):
            return fail("Patch path contains a forbidden segment")
        if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in relative):
            return fail("Patch path contains unsupported characters")
        if SKIP_BASENAME.fullmatch(basename) or extension not in ALLOWED_EXTENSIONS:
            return fail("Patch target is not an allowed source file")
        if any(re.match(r"^(?:--- |\+\+\+ |diff --git |Index: |new file mode |deleted file mode |rename from |rename to |copy from |copy to )", line) for line in lines[2:]):
            return fail("Patch contains multiple-file or metadata headers")
        if not any(re.match(r"^@@ -\d", line) for line in lines[2:]):
            return fail("Patch has no valid hunk")
        target = os.path.join(ROOT, *pieces)
        if os.path.commonpath((ROOT, os.path.realpath(target))) != ROOT or os.path.islink(target) or not os.path.isfile(target):
            return fail("Patch target is missing or unsafe")
        for dry_run in (True, False):
            command = ["patch", "--batch", "--forward", "--fuzz=0", "-p1"]
            if dry_run:
                command.append("--dry-run")
            command.extend(("-i", PATCH_FILE))
            result = subprocess.run(command, cwd=ROOT, env={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/workspace/home", "LANG": "C.UTF-8"}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20, check=False)
            if result.returncode != 0:
                message = result.stdout.decode("utf-8", "replace")[:300]
                return fail("Patch dry-run failed: " + message if dry_run else "Patch application failed: " + message)
        print("Single-file patch applied to the disposable source copy")
        return 0
    except subprocess.TimeoutExpired:
        return fail("Patch application timed out")
    except Exception as error:
        return fail("Patch application failed: " + type(error).__name__)


if __name__ == "__main__":
    sys.exit(main())
