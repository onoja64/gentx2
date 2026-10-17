#!/usr/bin/env python3
import argparse
import json
import os
import resource
import selectors
import signal
import subprocess
import sys
import time

MAX_TIMEOUT_SECONDS = 180
MAX_OUTPUT_BYTES = 8 * 1024
MAX_ARG_BYTES = 16 * 1024
WORK_ROOT = "/workspace"


def stop_group(process, grace=1.0):
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def limit_child():
    os.setgid(65534)
    os.setuid(65534)
    os.umask(0o077)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))


def emit(payload, status):
    sys.stdout.write(json.dumps({"status": status, **payload}, ensure_ascii=True, separators=(",", ":")))
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--timeout", type=int, required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--detach", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not 1 <= args.timeout <= MAX_TIMEOUT_SECONDS or not command:
        emit({"stdout": "", "stderr": "invalid bounded-runner arguments", "exitCode": 125, "elapsedMs": 0}, "rejected")
        return 125
    total_arg_bytes = sum(len(item.encode("utf-8", "replace")) for item in command)
    if len(command) > 256 or total_arg_bytes > MAX_ARG_BYTES or any("\x00" in item for item in command):
        emit({"stdout": "", "stderr": "argument budget exceeded", "exitCode": 125, "elapsedMs": 0}, "rejected")
        return 125
    cwd = os.path.realpath(args.cwd)
    if cwd != WORK_ROOT and not cwd.startswith(WORK_ROOT + "/"):
        emit({"stdout": "", "stderr": "working directory outside workspace", "exitCode": 125, "elapsedMs": 0}, "rejected")
        return 125
    if args.detach:
        log_path = os.path.join(cwd, ".gentx2-target.log")
        log_fd = os.open(log_path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
        os.fchown(log_fd, 65534, 65534)
        started = time.monotonic()
        try:
            with os.fdopen(log_fd, "ab", buffering=0) as log_file:
                process = subprocess.Popen(command, cwd=cwd, env={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/workspace/home", "TMPDIR": "/workspace/tmp", "LANG": "C.UTF-8", "CI": "1"}, stdin=subprocess.DEVNULL, stdout=log_file, stderr=log_file, close_fds=True, start_new_session=True, preexec_fn=limit_child)
            payload = {"stdout": "", "stderr": "", "exitCode": 0, "elapsedMs": int((time.monotonic() - started) * 1000), "pid": process.pid}
            emit(payload, "spawned")
            return 0
        except Exception as error:
            try: os.close(log_fd)
            except OSError: pass
            emit({"stdout": "", "stderr": type(error).__name__, "exitCode": 127, "elapsedMs": int((time.monotonic() - started) * 1000)}, "start-failed")
            return 127
    env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/workspace/home", "TMPDIR": "/workspace/tmp", "LANG": "C.UTF-8", "CI": "1"}
    os.makedirs(env["HOME"], mode=0o700, exist_ok=True)
    os.makedirs(env["TMPDIR"], mode=0o700, exist_ok=True)
    os.chown(env["HOME"], 65534, 65534)
    os.chown(env["TMPDIR"], 65534, 65534)
    started = time.monotonic()
    try:
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True, start_new_session=True, preexec_fn=limit_child)
    except Exception as error:
        emit({"stdout": "", "stderr": type(error).__name__, "exitCode": 127, "elapsedMs": int((time.monotonic() - started) * 1000)}, "start-failed")
        return 127

    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    captured = {"stdout": bytearray(), "stderr": bytearray()}
    deadline = started + args.timeout
    status = "complete"
    while selector.get_map():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            status = "timeout"
            stop_group(process)
            break
        for key, _ in selector.select(min(0.2, remaining)):
            try:
                chunk = os.read(key.fileobj.fileno(), 4096)
            except OSError:
                chunk = b""
            if not chunk:
                selector.unregister(key.fileobj)
                continue
            available = MAX_OUTPUT_BYTES - len(captured["stdout"]) - len(captured["stderr"])
            if len(chunk) > available:
                if available > 0:
                    captured[key.data].extend(chunk[:available])
                status = "output-limit"
                stop_group(process)
                break
            captured[key.data].extend(chunk)
        if status != "complete":
            break
        if process.poll() is not None and not selector.get_map():
            break
    if process.poll() is None:
        stop_group(process)
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        stop_group(process, 0)
    elapsed = int((time.monotonic() - started) * 1000)
    out = bytes(captured["stdout"]).decode("utf-8", "replace")
    err = bytes(captured["stderr"]).decode("utf-8", "replace")
    exit_code = process.returncode if process.returncode is not None else 124
    payload = {"stdout": out, "stderr": err, "exitCode": exit_code, "elapsedMs": elapsed}
    emit(payload, status)
    return exit_code if status == "complete" else 124


if __name__ == "__main__":
    sys.exit(main())
