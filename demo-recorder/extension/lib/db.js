// Tiny IndexedDB wrapper shared by the background worker and extension pages.
const DB_NAME = 'demo-recorder';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('sessions', { keyPath: 'id' });
        d.createObjectStore('screens', { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
        d.createObjectStore('steps', { keyPath: 'seq', autoIncrement: true }).createIndex('sessionId', 'sessionId');
        d.createObjectStore('css');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return open().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function deleteByIndex(storeName, sessionId) {
  return tx(storeName, 'readwrite', (store) => {
    const req = store.index('sessionId').openKeyCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { store.delete(cur.primaryKey); cur.continue(); }
    };
  });
}

export const db = {
  putSession: (s) => tx('sessions', 'readwrite', (st) => st.put(s)),
  getSession: (id) => tx('sessions', 'readonly', (st) => st.get(id)),
  listSessions: () => tx('sessions', 'readonly', (st) => st.getAll()),
  putScreen: (s) => tx('screens', 'readwrite', (st) => st.put(s)),
  getScreens: (sessionId) => tx('screens', 'readonly', (st) => st.index('sessionId').getAll(sessionId)),
  addStep: (s) => tx('steps', 'readwrite', (st) => st.add(s)),
  putStep: (s) => tx('steps', 'readwrite', (st) => st.put(s)),
  deleteStep: (seq) => tx('steps', 'readwrite', (st) => st.delete(seq)),
  getSteps: (sessionId) => tx('steps', 'readonly', (st) => st.index('sessionId').getAll(sessionId)),
  countSteps: (sessionId) => tx('steps', 'readonly', (st) => st.index('sessionId').count(sessionId)),
  putCss: (key, text) => tx('css', 'readwrite', (st) => st.put(text, key)),
  getCss: (key) => tx('css', 'readonly', (st) => st.get(key)),
  hasCss: (key) => tx('css', 'readonly', (st) => st.count(key)).then((n) => n > 0),
  async deleteSession(id) {
    await deleteByIndex('steps', id);
    await deleteByIndex('screens', id);
    await tx('sessions', 'readwrite', (st) => st.delete(id));
  },
};
