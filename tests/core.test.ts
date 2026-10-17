import assert from "node:assert/strict";
import { test } from "node:test";
import { BlackHatOutputSchema } from "../lib/agents/contracts";
import { isCleanRound, nextCleanStreak, canTransition, nextRound, shouldStopAfterRound } from "../lib/state-machine/engine";
import { isPathInScope, isPublicUnicastAddress, parseAuthorizedOrigin, validateRedirect } from "../lib/security/target-scope";
import { redactEvidenceText, redactPayload } from "../lib/security/redaction";
import { nucleiTargetForScope } from "../lib/scanners/scope";

const clean = {
  noNewVerifiedFindings: "pass" as const,
  regression: "pass" as const,
  previousExploitReplay: "pass" as const,
  independentVerification: "pass" as const,
  inconclusive: false,
};

test("state machine only accepts trusted workflow transitions", () => {
  assert.equal(canTransition("INTAKE", "BASELINE"), true);
  assert.equal(canTransition("INTAKE", "PATCH"), false);
  assert.equal(isCleanRound(clean), true);
  assert.equal(nextCleanStreak(2, clean), 3);
  assert.equal(nextCleanStreak(3, { ...clean, inconclusive: true }), 0);
  assert.equal(nextRound(9, 10), 10);
  assert.equal(nextRound(10, 10), null);
  assert.equal(shouldStopAfterRound(3), true);
  assert.equal(shouldStopAfterRound(2), false);
});

test("target scope rejects unsafe origins and enforces path prefixes", () => {
  assert.throws(() => parseAuthorizedOrigin("http://example.com"), /HTTPS/);
  assert.throws(() => parseAuthorizedOrigin("https://localhost"), /Localhost/);
  assert.throws(() => parseAuthorizedOrigin("https://user:pass@example.com"), /Credentials/);
  assert.throws(() => parseAuthorizedOrigin("https://example.com/#fragment"), /fragments/);
  assert.equal(isPathInScope("/api/v1/users", ["/api/v1"]), true);
  assert.equal(isPathInScope("/administrator", ["/admin"]), false);
  assert.equal(isPathInScope("/api/v2/users", ["/api/v1"]), false);
  assert.throws(() => isPathInScope("/api/v1/../admin", ["/api/v1"]), /Path traversal/);
  assert.throws(() => isPathInScope("/%2e%2e/admin", ["/"]), /Path traversal/);
});

test("network scope admits only public unicast addresses and rejects cross-origin redirects", async () => {
  assert.equal(isPublicUnicastAddress("8.8.8.8"), true);
  assert.equal(isPublicUnicastAddress("127.0.0.1"), false);
  assert.equal(isPublicUnicastAddress("10.0.0.1"), false);
  assert.equal(isPublicUnicastAddress("169.254.169.254"), false);
  assert.equal(isPublicUnicastAddress("::1"), false);
  await assert.rejects(validateRedirect("https://target.test/app", "https://other.test/app", ["/"]), /Cross-origin/);
});

test("Nuclei runs only when the complete origin is explicitly in scope", () => {
  assert.equal(nucleiTargetForScope("https://target.test/api?token=secret", ["/api"]), null);
  assert.equal(nucleiTargetForScope("https://target.test/api?token=secret", ["/"]), "https://target.test/");
});

test("evidence redaction removes URL queries, secret fields, and oversized output", () => {
  const redacted = redactEvidenceText('GET https://target.test/path?token=private&mode=1 Authorization: Bearer abcdefghijklmnop');
  assert.equal(redacted.includes("private"), false);
  assert.equal(redacted.includes("abcdefghijklmnop"), false);
  assert.equal(redacted.includes("?[REDACTED]"), true);
  assert.deepEqual(redactPayload({ nested: { apiKey: "hidden", message: "https://target.test/?key=hidden" } }), {
    nested: { apiKey: "[REDACTED]", message: "https://target.test/?[REDACTED]" },
  });
  assert.equal(redactEvidenceText("abcdefghij", 4), "abcd\n[TRUNCATED]");
});

test("agent output contracts reject fabricated or malformed findings", () => {
  const result = BlackHatOutputSchema.safeParse({ observations: [], safeChecks: [], inconclusive: true });
  assert.equal(result.success, true);
  assert.equal(BlackHatOutputSchema.safeParse({ observations: [{ title: "x" }] }).success, false);
});

