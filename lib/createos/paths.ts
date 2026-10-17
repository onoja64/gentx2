export function isWorkspaceDirectory(path: string) {
  return (path === "/workspace" || path.startsWith("/workspace/")) && !path.split("/").includes("..");
}
