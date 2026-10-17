import { resolvePublicTarget } from "@/lib/security/target-scope";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export function normalizePublicGitHubRepo(input: string) {
  if (input.length > 2048) throw new Error("Repository URL is too long");
  const url = new URL(input);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error("Only public HTTPS github.com repository URLs are accepted");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("Use a repository URL in the form github.com/owner/repository");
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository) || owner === "." || owner === ".." || repository === "." || repository === "..") {
    throw new Error("Repository owner or name contains invalid characters");
  }
  return { owner, repository, url: `https://github.com/${owner}/${repository}` };
}

export async function downloadPublicGitHubArchive(input: string, signal?: AbortSignal) {
  const repo = normalizePublicGitHubRepo(input);
  let current = `https://codeload.github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repository)}/zip/HEAD`;
  let response: Response | null = null;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "codeload.github.com" || parsed.username || parsed.password || parsed.port) {
      throw new Error("GitHub source redirect left the approved codeload host");
    }
    await resolvePublicTarget(current);
    response = await fetch(current, { redirect: "manual", signal: signal ?? AbortSignal.timeout(20_000), headers: { accept: "application/zip, application/octet-stream" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error("GitHub source redirect limit exceeded");
      current = new URL(location, current).toString();
      continue;
    }
    break;
  }

  if (!response || !response.ok || !response.body) throw new Error("Public GitHub source could not be downloaded");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_ARCHIVE_BYTES) throw new Error("Public GitHub archive exceeds the 20 MiB limit");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel("archive too large");
        throw new Error("Public GitHub archive exceeds the 20 MiB limit");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.byteLength; }
  return { archive, reference: repo.url, sourceHash: await sha256(archive) };
}

export async function sha256(value: Uint8Array | string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}
