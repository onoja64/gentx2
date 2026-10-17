const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|secret)\s*[=:]\s*)(["']?)[^\s"'`,;]{6,}\2/gi,
  /(["'](?:apiKey|accessToken|clientSecret|password|secret)["']\s*:\s*["'])[^"']{6,}(["'])/gi,
];

export function redactEvidenceText(value: string, maximumCharacters = 16_384) {
  let output = value.replace(/\r\n?/g, "\n");
  output = output.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const suffix = candidate.match(/[),.;]+$/)?.[0] ?? "";
      const url = new URL(suffix ? candidate.slice(0, -suffix.length) : candidate);
      url.search = url.search ? "?[REDACTED]" : "";
      url.hash = "";
      return `${url.toString()}${suffix}`;
    } catch { return candidate; }
  });
  for (const pattern of SECRET_PATTERNS.slice(0, 4)) output = output.replace(pattern, "[REDACTED SECRET]");
  output = output.replace(SECRET_PATTERNS[4], (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
  output = output.replace(SECRET_PATTERNS[5], (_match, prefix: string, quote: string) => `${prefix}[REDACTED]${quote}`);
  output = output.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  if (output.length > maximumCharacters) output = `${output.slice(0, maximumCharacters)}\n[TRUNCATED]`;
  return output;
}

export function redactPayload<T>(input: T): T {
  if (typeof input === "string") return redactEvidenceText(input) as T;
  if (Array.isArray(input)) return input.map((entry) => redactPayload(entry)) as T;
  if (input && typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (/^(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|secret)$/i.test(key)) output[key] = "[REDACTED]";
      else output[key] = redactPayload(value);
    }
    return output as T;
  }
  return input;
}
