/**
 * IndexedDB storage layer for Thresh.
 *
 * Stores: collections (posts + metadata), settings.
 * Falls back to localStorage if IndexedDB is unavailable.
 */
'use strict';

window.Thresh = window.Thresh || {};

Thresh.Storage = (function () {
  const DB_NAME = 'thresh';
  const DB_VERSION = 1;
  const STORE_COLLECTIONS = 'collections';
  let db = null;

  /** Open (or create) the database. */
  function init() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        console.warn('IndexedDB not available — using localStorage fallback.');
        resolve(false);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (e) {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_COLLECTIONS)) {
          const store = d.createObjectStore(STORE_COLLECTIONS, { keyPath: 'id', autoIncrement: true });
          store.createIndex('subreddit', 'subreddit', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = function (e) {
        db = e.target.result;
        resolve(true);
      };

      request.onerror = function () {
        console.warn('IndexedDB open failed — using localStorage fallback.');
        resolve(false);
      };
    });
  }

  /* ---------- IndexedDB helpers ---------- */
  function txStore(mode) {
    const tx = db.transaction(STORE_COLLECTIONS, mode);
    return tx.objectStore(STORE_COLLECTIONS);
  }

  function promisify(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /* ---------- localStorage fallback ---------- */
  const LS_KEY = 'thresh_collections';

  function lsGetAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch (_e) {
      return [];
    }
  }

  function lsSaveAll(arr) {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  }

  /* ---------- Public API ---------- */

  /**
   * Save a collection.
   *
   * A collection object looks like:
   * {
   *   subreddit: string,
   *   query: string | null,
   *   sort: string,
   *   timeFilter: string | null,
   *   limit: number,
   *   posts: PostData[],
   *   comments: { [postId]: CommentData[] } | null,
   *   postCount: number,
   *   commentCount: number,
   *   createdAt: string (ISO),
   *   status: 'completed' | 'failed',
   * }
   *
   * Returns the saved object with its auto-generated id.
   */
  async function saveCollection(collection) {
    collection.createdAt = collection.createdAt || new Date().toISOString();

    if (db) {
      const store = txStore('readwrite');
      const id = await promisify(store.add(collection));
      collection.id = id;
      return collection;
    }

    // localStorage fallback
    const all = lsGetAll();
    collection.id = (all.length ? Math.max.apply(null, all.map(function (c) { return c.id; })) : 0) + 1;
    all.push(collection);
    lsSaveAll(all);
    return collection;
  }

  /** Get all collections (newest first). */
  async function getCollections() {
    if (db) {
      const store = txStore('readonly');
      const all = await promisify(store.getAll());
      all.sort(function (a, b) { return (b.id || 0) - (a.id || 0); });
      return all;
    }
    const all = lsGetAll();
    all.sort(function (a, b) { return (b.id || 0) - (a.id || 0); });
    return all;
  }

  /** Get a single collection by id. */
  async function getCollection(id) {
    id = Number(id);
    if (db) {
      const store = txStore('readonly');
      return promisify(store.get(id));
    }
    return lsGetAll().find(function (c) { return c.id === id; }) || null;
  }

  /** Delete a collection by id. */
  async function deleteCollection(id) {
    id = Number(id);
    if (db) {
      const store = txStore('readwrite');
      await promisify(store.delete(id));
      return;
    }
    const all = lsGetAll().filter(function (c) { return c.id !== id; });
    lsSaveAll(all);
  }

  /** Get aggregate stats across all collections. */
  async function getStats() {
    const colls = await getCollections();
    let totalPosts = 0;
    let totalComments = 0;
    for (const c of colls) {
      totalPosts += c.postCount || 0;
      totalComments += c.commentCount || 0;
    }
    return {
      collections: colls.length,
      posts: totalPosts,
      comments: totalComments,
      exports: parseInt(localStorage.getItem('thresh_export_count') || '0', 10),
    };
  }

  /** Increment export counter. */
  function recordExport() {
    const count = parseInt(localStorage.getItem('thresh_export_count') || '0', 10);
    localStorage.setItem('thresh_export_count', String(count + 1));
  }

  return {
    init: init,
    saveCollection: saveCollection,
    getCollections: getCollections,
    getCollection: getCollection,
    deleteCollection: deleteCollection,
    getStats: getStats,
    recordExport: recordExport,
  };
})();
