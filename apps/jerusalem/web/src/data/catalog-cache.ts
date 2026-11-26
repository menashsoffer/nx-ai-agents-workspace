export interface CacheEntry {
  version: string;
  catalog: unknown;
}
export interface CatalogCache {
  read(userId: string): Promise<CacheEntry | null>;
  write(userId: string, value: CacheEntry): Promise<void>;
  remove(userId: string): Promise<void>;
}

const STORE = 'catalog';
const STORAGE_TIMEOUT_MS = 300;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => {
      resolve(value.result);
    };
    value.onerror = () => {
      reject(new Error('IndexedDB request failed'));
    };
  });
}

/** Time out blocked opens as well as errors: storage must never gate the network forever. */
function open(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(name, 1);
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('IndexedDB unavailable'));
    }, STORAGE_TIMEOUT_MS);
    pending.onupgradeneeded = () => {
      pending.result.createObjectStore(STORE);
    };
    pending.onerror = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB unavailable'));
    };
    pending.onsuccess = () => {
      clearTimeout(timer);
      if (expired) pending.result.close();
      else resolve(pending.result);
    };
  });
}

export class IndexedCatalogCache implements CatalogCache {
  private readonly name: string;
  private readonly factory: () => IDBFactory;

  constructor(name: string, factory: () => IDBFactory = () => indexedDB) {
    this.name = `consultants-catalog-v2:${name}`;
    this.factory = factory;
  }

  private async use<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>) {
    const db = await open(this.factory(), this.name);
    try {
      const transaction = db.transaction(STORE, mode);
      const complete = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = transaction.onabort = () => {
          reject(new Error('IndexedDB failed'));
        };
      });
      const [result] = await Promise.all([action(transaction.objectStore(STORE)), complete]);
      return result;
    } finally {
      db.close();
    }
  }

  async read(userId: string): Promise<CacheEntry | null> {
    try {
      const value: unknown = await this.use('readonly', (store) => request(store.get(userId)));
      if (!value || typeof value !== 'object') return null;
      const row = value as Record<string, unknown>;
      return typeof row.version === 'string'
        ? { version: row.version, catalog: row.catalog }
        : null;
    } catch {
      return null;
    }
  }
  async write(userId: string, value: CacheEntry): Promise<void> {
    try {
      await this.use('readwrite', (store) => request(store.put(value, userId)));
    } catch {
      /* Private browsing and storage quotas must not interrupt the catalog. */
    }
  }
  async remove(userId: string): Promise<void> {
    try {
      await this.use('readwrite', (store) => request(store.delete(userId)));
    } catch {
      /* The page also drops its in-memory copy on sign-out. */
    }
  }
}
