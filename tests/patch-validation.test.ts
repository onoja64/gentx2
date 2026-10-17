import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSingleFileDiff, validateSourcePath } from "../lib/patches/validation";

test("source paths allow supported files and reject traversal or sensitive paths", () => {
  assert.equal(validateSourcePath("src/auth/session.ts"), true);
  assert.equal(validateSourcePath("../secrets.ts"), false);
  assert.equal(validateSourcePath("src/../../secrets.ts"), false);
  assert.equal(validateSourcePath("/etc/passwd.ts"), false);
  assert.equal(validateSourcePath("src\\auth.ts"), false);
  assert.equal(validateSourcePath("src/.env.local"), false);
  assert.equal(validateSourcePath("node_modules/pkg/index.ts"), false);
});

test("patches are limited to a well-formed single-file diff", () => {
  const path = "src/auth/session.ts";
  const validDiff = [
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,2 @@",
    "-const enabled = false;",
    "+const enabled = true;",
  ].join("\n");
  assert.equal(validateSingleFileDiff(validDiff, path), true);
  assert.equal(validateSingleFileDiff(validDiff, "../session.ts"), false);
  assert.equal(validateSingleFileDiff(validDiff.replace(`+++ b/${path}`, "+++ b/src/other.ts"), path), false);
  assert.equal(validateSingleFileDiff(validDiff.replace("-const enabled = false;\n", ""), path), false);
  assert.equal(validateSingleFileDiff(`${validDiff}\n--- a/src/other.ts`, path), false);
});
