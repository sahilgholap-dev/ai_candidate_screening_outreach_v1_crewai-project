"use client";

// Background folder watcher. Mounted once app-wide; renders nothing unless a
// binding needs a permission re-grant (banner) or files were rejected
// (warning). All state is per-tab; the server manifest is the source of
// truth, so duplicate uploads across tabs are hash-deduped server-side.

import { useEffect, useRef, useState } from "react";

import {
  fileKey,
  getBindings,
  hashFile,
  listResumeFiles,
  removeBinding,
} from "@/lib/folder-watch";

const TICK_MS = 15_000;

type PendingGrant = { campaignId: number; folderName: string };

export function FolderWatcher() {
  const [pendingGrants, setPendingGrants] = useState<PendingGrant[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // name|size|mtime seen last tick — a file must be stable across two ticks
  const prevTick = useRef<Set<string>>(new Set());
  // keys already uploaded or already on the server
  const handled = useRef<Set<string>>(new Set());
  // keys rejected by the server (422) — never retried
  const rejected = useRef<Set<string>>(new Set());
  const busy = useRef(false);

  useEffect(() => {
    async function syncCampaign(
      campaignId: number,
      handle: FileSystemDirectoryHandle,
    ) {
      const files = await listResumeFiles(handle);
      const thisTick = new Set(files.map(fileKey));
      const candidates = files.filter((f) => {
        const key = fileKey(f);
        return (
          !handled.current.has(key) &&
          !rejected.current.has(key) &&
          prevTick.current.has(key) // stable across two ticks (not mid-download)
        );
      });
      prevTick.current = new Set([...prevTick.current, ...thisTick]);
      if (candidates.length === 0) return;

      const manifestRes = await fetch(
        `/api/backend/campaigns/${campaignId}/resume-manifest`,
      );
      if (manifestRes.status === 404) {
        await removeBinding(campaignId); // campaign deleted — stop watching
        return;
      }
      if (!manifestRes.ok) return;
      const manifest: { resumes: { content_hash: string | null }[] } =
        await manifestRes.json();
      const serverHashes = new Set(
        manifest.resumes.map((r) => r.content_hash).filter(Boolean),
      );

      const fresh: File[] = [];
      for (const f of candidates) {
        if (serverHashes.has(await hashFile(f))) {
          handled.current.add(fileKey(f)); // already uploaded earlier
        } else {
          fresh.push(f);
        }
      }
      if (fresh.length === 0) return;

      const fd = new FormData();
      fresh.forEach((f) => fd.append("resume_files", f));
      const res = await fetch(`/api/backend/campaigns/${campaignId}/resumes`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        fresh.forEach((f) => handled.current.add(fileKey(f)));
      } else if (res.status === 422) {
        // batch may mix valid/invalid; retry one-by-one so good files pass
        for (const f of fresh) {
          const single = new FormData();
          single.append("resume_files", f);
          const r = await fetch(
            `/api/backend/campaigns/${campaignId}/resumes`,
            { method: "POST", body: single },
          );
          if (r.ok) {
            handled.current.add(fileKey(f));
          } else if (r.status === 422) {
            rejected.current.add(fileKey(f));
            const detail = await r.json().catch(() => ({ detail: "" }));
            setWarnings((w) => [
              ...w.slice(-4),
              `${f.name}: ${typeof detail.detail === "string" ? detail.detail : "rejected"}`,
            ]);
          }
        }
      }
    }

    async function tick() {
      if (busy.current) return;
      busy.current = true;
      try {
        let bindings = await getBindings();
        if (bindings.length === 0) {
          setPendingGrants([]);
          return;
        }
        // Drop bindings for campaigns that no longer exist (deleted in the
        // app) — otherwise a stale binding shows a permission banner forever.
        const listRes = await fetch("/api/backend/campaigns");
        if (listRes.ok) {
          const alive = new Set(
            ((await listRes.json()) as { id: number }[]).map((c) => c.id),
          );
          for (const b of bindings.filter((b) => !alive.has(b.campaignId))) {
            await removeBinding(b.campaignId);
          }
          bindings = bindings.filter((b) => alive.has(b.campaignId));
        }
        const needsGrant: PendingGrant[] = [];
        for (const { campaignId, handle } of bindings) {
          const perm =
            (await handle.queryPermission?.({ mode: "read" })) ?? "granted";
          if (perm !== "granted") {
            needsGrant.push({ campaignId, folderName: handle.name });
            continue;
          }
          await syncCampaign(campaignId, handle);
        }
        setPendingGrants(needsGrant);
      } catch {
        // offline or transient failure — try again next tick
      } finally {
        busy.current = false;
      }
    }

    void tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  async function grant(campaignId: number) {
    const bindings = await getBindings();
    const b = bindings.find((x) => x.campaignId === campaignId);
    if (!b) return;
    await b.handle.requestPermission?.({ mode: "read" }); // needs a user gesture
    setPendingGrants((p) => p.filter((x) => x.campaignId !== campaignId));
  }

  if (pendingGrants.length === 0 && warnings.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {pendingGrants.map((p) => (
        <div
          key={p.campaignId}
          className="rounded-lg border bg-background p-3 text-sm shadow-lg"
        >
          <p className="font-medium">Folder watching paused</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Campaign #{p.campaignId} — “{p.folderName}”. Browsers require a
            click to re-allow folder access after a restart.
          </p>
          <button
            className="mt-2 text-xs font-medium underline"
            onClick={() => void grant(p.campaignId)}
          >
            Resume watching
          </button>
        </div>
      ))}
      {warnings.map((w, i) => (
        <div
          key={i}
          className="rounded-lg border bg-background p-3 text-xs text-amber-700 shadow-lg"
        >
          Skipped file — {w}
          <button
            className="ml-2 underline"
            onClick={() => setWarnings((x) => x.filter((_, j) => j !== i))}
          >
            dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
