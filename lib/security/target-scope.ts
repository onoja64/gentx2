import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const MAX_URL_LENGTH = 2048;

export interface ResolvedTarget {
  origin: string;
  hostname: string;
  port: number;
  addresses: string[];
  egressRules: string[];
}

function parseIp(value: string) {
  try { return ipaddr.process(value); } catch { return null; }
}

export function isPublicUnicastAddress(value: string) {
  const address = parseIp(value);
  return Boolean(address && address.range() === "unicast");
}

function validatePathname(pathname: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { throw new Error("Malformed encoded path"); }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Path traversal or control characters are not allowed");
  }
  return decoded;
}

export function parseAuthorizedOrigin(input: string) {
  if (input.length === 0 || input.length > MAX_URL_LENGTH) throw new Error("Target URL is empty or too long");
  const parsed = new URL(input);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS targets are accepted");
  if (parsed.username || parsed.password) throw new Error("Credentials in target URLs are not allowed");
  if (parsed.hash) throw new Error("URL fragments are not accepted as scope");
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.endsWith(".localhost") || hostname === "localhost") throw new Error("Localhost targets are not allowed");
  if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) throw new Error("Invalid target port");
  validatePathname(parsed.pathname);
  const port = Number(parsed.port || 443);
  return { url: parsed, hostname, port, origin: `${parsed.protocol}//${parsed.host.toLowerCase()}` };
}

export async function resolvePublicTarget(input: string): Promise<ResolvedTarget> {
  const parsed = parseAuthorizedOrigin(input);
  let addresses: string[];
  if (isIP(parsed.hostname)) addresses = [parsed.hostname];
  else {
    const rows = await lookup(parsed.hostname, { all: true, verbatim: true });
    addresses = [...new Set(rows.map((row) => row.address))];
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicUnicastAddress(address))) {
    throw new Error("Target DNS resolved to a non-public or mixed public/private address set");
  }
  const egressRules = addresses.map((address) => {
    const host = isIP(address) === 6 ? `[${address}]` : address;
    return `${host}:${parsed.port}`;
  }).sort();
  return { origin: parsed.origin, hostname: parsed.hostname, port: parsed.port, addresses, egressRules };
}

export function isPathInScope(pathname: string, prefixes: string[]) {
  const normalized = validatePathname(pathname);
  return prefixes.some((prefix) => {
    if (!prefix.startsWith("/") || prefix.startsWith("//")) return false;
    const base = prefix.endsWith("/") && prefix.length > 1 ? prefix.slice(0, -1) : prefix;
    return normalized === base || normalized.startsWith(`${base === "/" ? "" : base}/`) || base === "/";
  });
}

export async function validateRedirect(initialUrl: string, redirectUrl: string, scopePaths: string[]) {
  const initial = parseAuthorizedOrigin(initialUrl);
  const next = new URL(redirectUrl, initial.url);
  const parsed = parseAuthorizedOrigin(next.toString());
  if (parsed.origin !== initial.origin) throw new Error("Cross-origin redirects are outside the authorized target scope");
  if (!isPathInScope(parsed.url.pathname, scopePaths)) throw new Error("Redirect path is outside the authorized path scope");
  const resolved = await resolvePublicTarget(parsed.url.toString());
  return { url: parsed.url, resolved };
}

export function redactUrl(input: string) {
  try {
    const value = new URL(input);
    value.username = "";
    value.password = "";
    value.search = value.search ? "?[REDACTED]" : "";
    value.hash = "";
    return value.toString();
  } catch { return "[INVALID URL]"; }
}
