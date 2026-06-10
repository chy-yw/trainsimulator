(function () {
  "use strict";

  const DB_NAME = "TrainModelAdmin";
  const DB_VERSION = 1;
  const CONFIG_KEY = "config";

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config");
        }
        if (!db.objectStoreNames.contains("images")) {
          db.createObjectStore("images");
        }
      };
    });

    return dbPromise;
  }

  async function getConfig() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("config", "readonly");
      const req = tx.objectStore("config").get(CONFIG_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveConfig(config) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("config", "readwrite");
      tx.objectStore("config").put(config, CONFIG_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function saveImage(path, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").put(blob, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getImageBlob(path) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readonly");
      const req = tx.objectStore("images").get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllImagePaths() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readonly");
      const req = tx.objectStore("images").getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteImage(path) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["config", "images"], "readwrite");
      tx.objectStore("config").clear();
      tx.objectStore("images").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadImageUrlsForConfig(config) {
    const urls = new Map();
    const entries = [...(config.backgrounds || []), ...(config.items || [])];
    for (const entry of entries) {
      if (!entry.file) continue;
      const blob = await getImageBlob(entry.file);
      if (blob) urls.set(entry.file, URL.createObjectURL(blob));
    }
    return urls;
  }

  window.TrainModelStore = {
    getConfig,
    saveConfig,
    saveImage,
    getImageBlob,
    getAllImagePaths,
    deleteImage,
    clearAll,
    loadImageUrlsForConfig,
  };
})();
