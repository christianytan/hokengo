/**
 * Persistence layer.
 *
 * A hand-written IndexedDB wrapper (no external dependency) plus an in-memory
 * fallback with the same interface, so the app degrades gracefully in private
 * mode / when IndexedDB is blocked, and so tests can run against either.
 */

export const DB_NAME = "japanese-insurance-terminology-trainer";
export const DB_VERSION = 1;

export const STORES = {
  progress: "progress",
  userVocabulary: "userVocabulary",
  settings: "settings",
  activity: "activity",
  meta: "meta",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

const KEY_PATHS: Record<StoreName, string | null> = {
  [STORES.progress]: "termId",
  [STORES.userVocabulary]: "id",
  [STORES.settings]: "key",
  [STORES.activity]: "date",
  [STORES.meta]: "key",
};

export interface StorageBackend {
  readonly kind: "indexeddb" | "memory";
  getAll<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void>;
  putMany<T>(store: StoreName, values: T[], key?: IDBValidKey): Promise<void>;
  remove(store: StoreName, key: IDBValidKey): Promise<void>;
  clear(store: StoreName): Promise<void>;
  close(): Promise<void>;
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of Object.values(STORES) as StoreName[]) {
        if (db.objectStoreNames.contains(store)) continue;
        const keyPath = KEY_PATHS[store];
        if (keyPath) db.createObjectStore(store, { keyPath });
        else db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB open request was blocked by another connection"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export class IndexedDbBackend implements StorageBackend {
  readonly kind = "indexeddb" as const;
  private db: Promise<IDBDatabase>;

  constructor(db?: Promise<IDBDatabase>) {
    this.db = db ?? openIndexedDb();
  }

  static create(): IndexedDbBackend | null {
    return isIndexedDbAvailable() ? new IndexedDbBackend() : null;
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    const tx = (await this.db).transaction(store, "readonly");
    return requestResult(tx.objectStore(store).getAll() as IDBRequest<T[]>);
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const tx = (await this.db).transaction(store, "readonly");
    return requestResult(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
  }

  async put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
    const tx = (await this.db).transaction(store, "readwrite");
    const os = tx.objectStore(store);
    if (KEY_PATHS[store] === null) os.put(value, key);
    else os.put(value);
    await txDone(tx);
  }

  async putMany<T>(store: StoreName, values: T[], key?: IDBValidKey): Promise<void> {
    const tx = (await this.db).transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const value of values) {
      if (KEY_PATHS[store] === null) os.put(value, key);
      else os.put(value);
    }
    await txDone(tx);
  }

  async remove(store: StoreName, key: IDBValidKey): Promise<void> {
    const tx = (await this.db).transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await txDone(tx);
  }

  async clear(store: StoreName): Promise<void> {
    const tx = (await this.db).transaction(store, "readwrite");
    tx.objectStore(store).clear();
    await txDone(tx);
  }

  async close(): Promise<void> {
    const db = await this.db;
    db.close();
  }
}

/** Fallback used when IndexedDB is unavailable; data lives only for the session. */
export class MemoryBackend implements StorageBackend {
  readonly kind = "memory" as const;
  private stores = new Map<StoreName, Map<string, unknown>>();

  private store(name: StoreName): Map<string, unknown> {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
    }
    return s;
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return [...this.store(store).values()] as T[];
  }
  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.store(store).get(String(key)) as T | undefined;
  }
  async put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
    const keyPath = KEY_PATHS[store];
    let resolved = key === undefined ? undefined : String(key);
    if (resolved === undefined && keyPath && value && typeof value === "object") {
      resolved = String((value as Record<string, unknown>)[keyPath] ?? "default");
    }
    this.store(store).set(resolved ?? "default", value);
  }
  async putMany<T>(store: StoreName, values: T[]): Promise<void> {
    for (const value of values) await this.put(store, value);
  }
  async remove(store: StoreName, key: IDBValidKey): Promise<void> {
    this.store(store).delete(String(key));
  }
  async clear(store: StoreName): Promise<void> {
    this.store(store).clear();
  }
  async close(): Promise<void> {
    this.stores.clear();
  }
}

export function createBackend(preferred?: StorageBackend): StorageBackend {
  if (preferred) return preferred;
  return IndexedDbBackend.create() ?? new MemoryBackend();
}
