"use client";

import { useRef, useState } from "react";
import { zipSync } from "fflate";
import { AlertTriangle, ArrowUpRight, Check, FileArchive, FolderUp, GitBranch, Globe2, LoaderCircle, LockKeyhole, ShieldCheck, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const AUTHORIZATION_PHRASE = "I AM AUTHORIZED";
export type IntakeMode = "archive" | "github" | "url";
export interface TargetSummary {
  id: string;
  kind: IntakeMode;
  label: string;
  origin?: string;
  accessMode: "source" | "url-only";
  sourceHash?: string;
  createdAt: string;
}

function safeRelativePath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === ".") || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("The selected folder contains a path that cannot be safely archived.");
  }
  return normalized;
}

export function TargetIntake({ projectId, onCreated }: { projectId: string; onCreated: (target: TargetSummary, transientArchive: File | null) => void }) {
  const [mode, setMode] = useState<IntakeMode>("archive");
  const [url, setUrl] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [archiveLabel, setArchiveLabel] = useState("");
  const [scopeText, setScopeText] = useState("/");
  const [authorized, setAuthorized] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TargetSummary | null>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  async function packageFiles(fileList: FileList | null) {
    setError(null);
    setArchive(null);
    setArchiveLabel("");
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_ARCHIVE_BYTES) { setError("Source folders are capped at 20 MiB before compression."); return; }
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const file of files) {
        const path = safeRelativePath(file.webkitRelativePath || file.name);
        if (Object.hasOwn(entries, path)) throw new Error("Duplicate source paths are not allowed.");
        entries[path] = new Uint8Array(await file.arrayBuffer());
      }
      const zipped = zipSync(entries, { level: 1 });
      if (zipped.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The compressed source is over the 20 MiB upload limit.");
      const isFolder = files.some((file) => Boolean(file.webkitRelativePath));
      const label = isFolder ? files[0]?.webkitRelativePath.split("/")[0] || "source-folder" : files[0]?.name.replace(/\.zip$/i, "") || "source-archive";
      setArchive(new File([zipped], `${label || "source"}.zip`, { type: "application/zip" }));
      setArchiveLabel(`${files.length} file${files.length === 1 ? "" : "s"} · ${(zipped.byteLength / 1024).toFixed(0)} KiB compressed`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to package the selected source files.");
    }
  }

  async function createTarget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!authorized || phrase.trim() !== AUTHORIZATION_PHRASE) {
      setError(`Confirm authorization and type “${AUTHORIZATION_PHRASE}” to continue.`);
      return;
    }
    const scopePaths = scopeText.split("\n").map((entry) => entry.trim()).filter(Boolean);
    if (scopePaths.length === 0) { setError("Declare at least one authorized path."); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("kind", mode);
      form.set("authorizationConfirmed", "true");
      form.set("authorizationPhrase", AUTHORIZATION_PHRASE);
      form.set("scopePaths", JSON.stringify(scopePaths));
      if (mode === "archive") {
        if (!archive) throw new Error("Choose a ZIP archive or a folder first.");
        form.set("file", archive, archive.name);
      } else if (mode === "github") {
        form.set("repoUrl", repoUrl);
      } else {
        form.set("url", url);
      }
      const response = await fetch("/api/targets", { method: "POST", body: form });
      const body = await response.json() as { target?: TargetSummary; error?: string };
      if (!response.ok || !body.target) throw new Error(body.error || "Target intake failed.");
      setCreated(body.target);
      onCreated(body.target, mode === "archive" ? archive : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Target intake failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="intake" className="scroll-mt-20 overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div><div className="flex items-center gap-2"><LockKeyhole className="size-3.5 text-primary" /><h2 className="text-[12px] font-semibold">Target intake</h2><Badge variant="outline">AUTHORIZATION REQUIRED</Badge></div><p className="mt-1.5 text-[10px] text-muted-foreground">Normalize the target first. Nothing runs until the scope is explicit.</p></div>
        <div className="hidden items-center gap-1.5 rounded-md border border-border/70 bg-background/40 px-2 py-1.5 mono text-[9px] text-muted-foreground sm:flex"><span className="text-primary">Target</span> → scope</div>
      </div>
      <form onSubmit={createTarget} className="p-4 sm:p-5">
        <Tabs value={mode} onValueChange={(value) => { setMode(value as IntakeMode); setError(null); }}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="archive"><FolderUp className="size-3.5" />Folder / ZIP</TabsTrigger>
            <TabsTrigger value="github"><GitBranch className="size-3.5" />GitHub repo</TabsTrigger>
            <TabsTrigger value="url"><Globe2 className="size-3.5" />Website URL</TabsTrigger>
          </TabsList>
          <TabsContent value="archive">
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => archiveInput.current?.click()} className="flex min-h-[76px] items-center gap-3 rounded-lg border border-dashed border-border bg-background/35 px-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.025]">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-white/[0.025] text-muted-foreground"><FileArchive className="size-4" /></span><span><span className="block text-[10px] font-medium">Choose ZIP archive</span><span className="mt-1 block text-[9px] text-muted-foreground">Up to 20 MiB · source is handled in CreateOS</span></span><UploadCloud className="ml-auto size-3.5 text-muted-foreground" />
              </button>
              <button type="button" onClick={() => folderInput.current?.click()} className="flex min-h-[76px] items-center gap-3 rounded-lg border border-dashed border-border bg-background/35 px-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.025]">
                <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-white/[0.025] text-muted-foreground"><FolderUp className="size-4" /></span><span><span className="block text-[10px] font-medium">Choose source folder</span><span className="mt-1 block text-[9px] text-muted-foreground">Packaged locally as a ZIP · 20 MiB cap</span></span><ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" />
              </button>
              <input ref={archiveInput} className="sr-only" type="file" accept=".zip,application/zip" onChange={(event) => void packageFiles(event.target.files)} />
              <input ref={folderInput} className="sr-only" type="file" multiple {...({ webkitdirectory: "" } as Record<string, string>)} onChange={(event) => void packageFiles(event.target.files)} />
            </div>
            <div className="mt-2 flex min-h-5 items-center gap-2 text-[9px] text-muted-foreground">{archive ? <><Check className="size-3 text-primary" /><span className="font-medium text-foreground/80">{archive.name}</span><span>·</span><span>{archiveLabel}</span></> : <><span className="size-1.5 rounded-full bg-muted-foreground/50" />No source selected</>}</div>
          </TabsContent>
          <TabsContent value="github">
            <label className="eyebrow mb-2 block text-muted-foreground" htmlFor="repo-url">Public GitHub repository</label>
            <input id="repo-url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-[11px] outline-none placeholder:text-muted-foreground/55 focus:border-primary/45 focus:ring-2 focus:ring-primary/10" />
            <p className="mt-2 text-[9px] text-muted-foreground">Public repositories only in this version. No GitHub token is passed to a sandbox.</p>
          </TabsContent>
          <TabsContent value="url">
            <label className="eyebrow mb-2 block text-muted-foreground" htmlFor="target-url">Deployed website origin</label>
            <input id="target-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://app.example.com" inputMode="url" className="h-10 w-full rounded-md border border-input bg-background/60 px-3 text-[11px] outline-none placeholder:text-muted-foreground/55 focus:border-primary/45 focus:ring-2 focus:ring-primary/10" />
            <p className="mt-2 text-[9px] text-muted-foreground">URL-only targets are scan-and-guidance only; no source patch or deployment write is implied.</p>
          </TabsContent>
        </Tabs>

        <div className="mt-5 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-[1fr_1fr]">
          <div>
            <label className="eyebrow mb-2 block text-muted-foreground" htmlFor="scope-paths">Authorized path scope</label>
            <textarea id="scope-paths" rows={2} value={scopeText} onChange={(event) => setScopeText(event.target.value)} placeholder="/\n/api/v1" className="w-full resize-y rounded-md border border-input bg-background/60 px-3 py-2 mono text-[10px] leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:border-primary/45 focus:ring-2 focus:ring-primary/10" />
            <p className="mt-1 text-[9px] text-muted-foreground">One path prefix per line. Requests stay within the declared origin and paths.</p>
          </div>
          <div className="rounded-lg border border-border/75 bg-background/30 p-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} className="mt-0.5 size-3.5 accent-[#5ce1d3]" />
              <span><span className="block text-[10px] font-medium leading-relaxed text-foreground/90">I have written authorization to assess this target.</span><span className="mt-1 block text-[9px] leading-relaxed text-muted-foreground">I am responsible for the declared host and path scope.</span></span>
            </label>
            <input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder={AUTHORIZATION_PHRASE} aria-label="Type I AM AUTHORIZED" className="mt-3 h-8 w-full rounded-md border border-input bg-background/60 px-2.5 mono text-[9px] tracking-wide outline-none placeholder:text-muted-foreground/50 focus:border-primary/45 focus:ring-2 focus:ring-primary/10" />
          </div>
        </div>

        {created && <div className="mt-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/[0.06] px-3 py-2 text-[10px] text-primary"><ShieldCheck className="size-3.5" />Target normalized and recorded · <span className="mono">{created.id.slice(0, 10)}</span><span className="ml-auto text-primary/75">{created.accessMode === "source" ? "SOURCE AVAILABLE" : "URL-ONLY"}</span></div>}
        {error && <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-rose-300/20 bg-rose-400/[0.06] px-3 py-2.5 text-[10px] leading-relaxed text-rose-100"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{error}</div>}
        <div className="mt-4 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground"><LockKeyhole className="size-3" />Source and scanner execution are confined to CreateOS.</div>
          <Button type="submit" size="sm" disabled={busy || !authorized || phrase.trim() !== AUTHORIZATION_PHRASE} className={cn("min-w-[138px]", busy && "cursor-wait")}>
            {busy ? <><LoaderCircle className="size-3.5 animate-spin" />Validating scope</> : <>Normalize target <ArrowUpRight className="size-3.5" /></>}
          </Button>
        </div>
      </form>
    </Card>
  );
}
