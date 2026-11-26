// Cache local de resultados já calculados (IndexedDB). Tudo fica no dispositivo do visitante.

const DB = 'banda-eb-stems', STORE = 'results';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const idbStore = {
  async get(key) {
    try {
      const db = await open();
      return await new Promise((res, rej) => {
        const q = db.transaction(STORE).objectStore(STORE).get(key);
        q.onsuccess = () => {
          const v = q.result;
          res(v ? v.map(([a, b]) => [new Float32Array(a), new Float32Array(b)]) : null);
        };
        q.onerror = () => rej(q.error);
      });
    } catch { return null; }
  },
  async set(key, stems) {
    try {
      const db = await open();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(stems.map(([a, b]) => [a.buffer.slice(0), b.buffer.slice(0)]), key);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
    } catch { /* quota cheia: continua sem cache */ }
  },
  async clear() {
    const db = await open();
    await new Promise(res => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = res; });
  },
};

export function memoryStore() {
  const m = new Map();
  return { get: async k => m.get(k) || null, set: async (k, v) => { m.set(k, v); } };
}
