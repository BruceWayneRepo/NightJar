/**
 * Nightjar local file store (improved).
 *
 * Changes from the original (same three functions, plus additions):
 * 1. One shared database connection instead of opening and closing it on every
 *    call, which is much faster when importing a whole album.
 * 2. Handles another tab upgrading the database (closes and reopens cleanly).
 * 3. requestPersistentStorage(): asks the browser not to clear the library when
 *    the phone is low on space. Without it, Android can silently delete
 *    imported music.
 * 4. storageUsage(): how much space the library uses and how much is left.
 * 5. idbKeys() and idbPutMany() for listing and bulk imports.
 */

const DB_NAME = "nightjar";
const STORE = "files";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab wants a newer version: let it, and reopen on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error("Nightjar is open in another tab with an older version. Close it and try again."));
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(key: string, value: Blob) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(value, key);
  await done(tx);
}

/** Store many files in one transaction (much faster for album imports). */
export async function idbPutMany(entries: { key: string; value: Blob }[]) {
  if (entries.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const { key, value } of entries) store.put(value, key);
  await done(tx);
}

export async function idbGet(key: string) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  return (await request(tx.objectStore(STORE).get(key))) as Blob | undefined;
}

export async function idbDel(key: string) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(key);
  await done(tx);
}

export async function idbKeys() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const keys = await request(tx.objectStore(STORE).getAllKeys());
  return keys.map(String);
}

/**
 * Ask the browser to keep the library even when storage runs low.
 * Returns true if storage is (now) persistent. Call it after the first import,
 * from a user action, so the browser is more likely to say yes.
 */
export async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Bytes used and available for this site, or null if the browser won't say. */
export async function storageUsage() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, free: Math.max(0, quota - usage) };
  } catch {
    return null;
  }
}
