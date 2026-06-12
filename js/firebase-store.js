(function () {
  "use strict";

  const CONFIG_DOC = { collection: "trainModel", id: "config" };
  const urlCache = new Map();

  let app = null;
  let auth = null;
  let db = null;
  let storage = null;
  let initPromise = null;

  function isConfigured() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg?.apiKey || !cfg.projectId) return false;
    return !String(cfg.apiKey).includes("YOUR_");
  }

  function requireFirebase() {
    if (!isConfigured()) {
      throw new Error("Firebase is not configured. Edit js/firebase-config.js first.");
    }
    if (typeof firebase === "undefined") {
      throw new Error("Firebase SDK not loaded.");
    }
  }

  async function init() {
    if (!isConfigured()) return false;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      requireFirebase();
      if (!app) {
        app = firebase.initializeApp(window.FIREBASE_CONFIG);
        if (typeof firebase.auth === "function") {
          auth = firebase.auth();
        }
        db = firebase.firestore();
        storage = firebase.storage();
      }
      return true;
    })();

    return initPromise;
  }

  function getCurrentUser() {
    return auth?.currentUser || null;
  }

  async function signIn(email, password) {
    await init();
    if (!auth) {
      throw new Error("Firebase Auth SDK not loaded.");
    }
    return auth.signInWithEmailAndPassword(email, password);
  }

  async function signOut() {
    if (!auth) return;
    await auth.signOut();
  }

  function onAuthStateChanged(callback) {
    init()
      .then((ok) => {
        if (!ok || !auth) return;
        auth.onAuthStateChanged(callback);
      })
      .catch(() => {});
  }

  function normalizeEntry(entry) {
    return {
      id: entry.id,
      name: entry.name,
      file: entry.file,
      width: entry.width,
      height: entry.height,
      userCanEditDims: entry.userCanEditDims !== false,
    };
  }

  function normalizeConfig(config) {
    return {
      version: 2,
      backgrounds: (config.backgrounds || []).map(normalizeEntry),
      items: (config.items || []).map(normalizeEntry),
    };
  }

  async function getConfig() {
    const ready = await init();
    if (!ready) return null;

    const snap = await db
      .collection(CONFIG_DOC.collection)
      .doc(CONFIG_DOC.id)
      .get();

    if (!snap.exists) return null;

    return normalizeConfig(snap.data());
  }

  async function saveConfig(config) {
    await init();
    if (!getCurrentUser()) {
      throw new Error("Admin must be signed in to save to Firebase.");
    }

    const payload = normalizeConfig(config);

    await db
      .collection(CONFIG_DOC.collection)
      .doc(CONFIG_DOC.id)
      .set({
        ...payload,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
  }

  function storageRef(path) {
    return storage.ref(path);
  }

  async function uploadImage(path, fileOrBlob) {
    await init();
    if (!getCurrentUser()) {
      throw new Error("Admin must be signed in to upload images.");
    }

    const ref = storageRef(path);
    await ref.put(fileOrBlob);
    urlCache.delete(path);
    return getImageUrl(path);
  }

  async function deleteImage(path) {
    if (!path) return;
    await init();
    if (!getCurrentUser()) return;

    try {
      await storageRef(path).delete();
    } catch {
      /* file may not exist in storage */
    }
    urlCache.delete(path);
  }

  async function getImageBlob(path) {
    if (!path) return null;
    const ready = await init();
    if (!ready) return null;

    const ref = storageRef(path);

    try {
      if (typeof ref.getBlob === "function") {
        return await ref.getBlob();
      }
      if (typeof ref.getBytes === "function") {
        const bytes = await ref.getBytes();
        const type = guessImageMime(path);
        return new Blob([bytes], { type });
      }
    } catch (err) {
      console.warn("Firebase direct blob download failed:", path, err);
    }

    try {
      const url = await getImageUrl(path);
      if (!url) return null;
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }

  function guessImageMime(path) {
    const ext = String(path).split(".").pop()?.toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/jpeg";
  }

  async function getImageUrl(path) {
    if (!path) return "";
    if (urlCache.has(path)) return urlCache.get(path);

    const ready = await init();
    if (!ready) return "";

    try {
      const url = await storageRef(path).getDownloadURL();
      urlCache.set(path, url);
      return url;
    } catch {
      return "";
    }
  }

  async function loadImageUrlsForConfig(config) {
    const urls = new Map();
    const entries = [...(config.backgrounds || []), ...(config.items || [])];

    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.file) return;
        const url = await getImageUrl(entry.file);
        if (url) urls.set(entry.file, url);
      })
    );

    return urls;
  }

  async function publishConfig(config, imageResolver) {
    await init();
    if (!getCurrentUser()) {
      throw new Error("Admin must be signed in to publish.");
    }

    const paths = new Set();
    [...(config.backgrounds || []), ...(config.items || [])].forEach((entry) => {
      if (entry.file) paths.add(entry.file);
    });

    for (const path of paths) {
      try {
        await storageRef(path).getMetadata();
      } catch {
        const blob = await imageResolver(path);
        if (blob) await storageRef(path).put(blob);
        urlCache.delete(path);
      }
    }

    await saveConfig(config);
  }

  window.TrainModelFirebase = {
    isConfigured,
    init,
    getConfig,
    saveConfig,
    uploadImage,
    deleteImage,
    getImageBlob,
    getImageUrl,
    loadImageUrlsForConfig,
    publishConfig,
    signIn,
    signOut,
    onAuthStateChanged,
    getCurrentUser,
  };
})();
