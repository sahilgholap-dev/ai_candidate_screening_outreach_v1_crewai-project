// Folder-watch support: directory-handle persistence (IndexedDB), folder
// scanning, and content hashing. All watching state lives client-side;
// the server only ever sees uploaded files.

export const RESUME_EXTENSIONS = [".pdf", ".docx", ".txt"];

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    queryPermission?: (d: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
    requestPermission?: (d: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
  }
}

export function isFolderPickSupported(): boolean {
  return typeof window !== "undefined" && !!window.showDirectoryPicker;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("Folder access requires Chrome or Edge");
  }
  return window.showDirectoryPicker({ mode: "read" });
}

// ---- IndexedDB persistence (handles are structured-cloneable) ----

const DB_NAME = "folder-watch";
const STORE = "bindings"; // key: campaignId (number), value: handle

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function saveBinding(
  campaignId: number,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await tx("readwrite", (s) => s.put(handle, campaignId));
}

export async function removeBinding(campaignId: number): Promise<void> {
  await tx("readwrite", (s) => s.delete(campaignId));
}

export async function getBindings(): Promise<
  { campaignId: number; handle: FileSystemDirectoryHandle }[]
> {
  const keys = await tx("readonly", (s) => s.getAllKeys());
  const values = await tx("readonly", (s) => s.getAll());
  return keys.map((k, i) => ({
    campaignId: Number(k),
    handle: values[i] as FileSystemDirectoryHandle,
  }));
}

export async function moveBinding(
  fromCampaignId: number,
  toCampaignId: number,
): Promise<void> {
  const bindings = await getBindings();
  const from = bindings.find((b) => b.campaignId === fromCampaignId);
  if (!from) return;
  await saveBinding(toCampaignId, from.handle);
  await removeBinding(fromCampaignId);
}

export async function isFolderAlreadyBound(
  handle: FileSystemDirectoryHandle,
): Promise<number | null> {
  for (const b of await getBindings()) {
    if (await b.handle.isSameEntry(handle)) return b.campaignId;
  }
  return null;
}

// ---- Scanning & hashing ----

export async function listResumeFiles(
  handle: FileSystemDirectoryHandle,
): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== "file") continue;
    const lower = entry.name.toLowerCase();
    if (!RESUME_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    files.push(await (entry as FileSystemFileHandle).getFile());
  }
  return files;
}

export function fileKey(f: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

export async function hashFile(f: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
