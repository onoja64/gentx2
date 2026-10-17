const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".jsx",
  ".php", ".py", ".rb", ".rs", ".sql", ".svelte", ".ts", ".tsx", ".vue",
]);
const FORBIDDEN_SEGMENTS = new Set([
  ".git", ".next", "build", "coverage", "dist", "node_modules", "secrets", "vendor",
]);

export function validateSourcePath(value: string) {
  if (!value || value.length > 2048 || value.startsWith("/") || value.includes("\\") || /[\u0000-\u0020\u007f]/.test(value)) return false;
  const segments = value.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.startsWith("-") || !/^[A-Za-z0-9_.@+-]+$/.test(part) || FORBIDDEN_SEGMENTS.has(part.toLowerCase()))) return false;
  const basename = segments.at(-1)!.toLowerCase();
  if (/^(?:\.env(?:\..*)?|\.npmrc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx))$/.test(basename)) return false;
  const extension = basename.includes(".") ? `.${basename.split(".").at(-1)}` : "";
  return SOURCE_EXTENSIONS.has(extension);
}

export function validateSingleFileDiff(diff: string, filePath: string) {
  if (!validateSourcePath(filePath) || !diff || diff.length > 12_000 || diff.includes("\0")) return false;
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== `--- a/${filePath}` || lines[1] !== `+++ b/${filePath}`) return false;
  if (!lines.some((line) => /^@@ -\d/.test(line))) return false;
  if (!lines.slice(2).some((line) => line.startsWith("+") && !line.startsWith("+++"))) return false;
  if (!lines.slice(2).some((line) => line.startsWith("-") && !line.startsWith("---"))) return false;
  if (lines.slice(2).some((line) => /^(?:--- |\+\+\+ |diff --git |Index: |new file mode |deleted file mode |rename from |rename to |copy from |copy to )/.test(line))) return false;
  return true;
}
