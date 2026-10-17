/** Nuclei templates can request arbitrary paths on the supplied origin. Only run it for an explicit whole-origin scope. */
export function nucleiTargetForScope(targetUrl: string, scopePaths: string[]) {
  if (!scopePaths.includes("/")) return null;
  const target = new URL(targetUrl);
  target.pathname = "/";
  target.search = "";
  target.hash = "";
  return target.toString();
}
