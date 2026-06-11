(function () {
  "use strict";

  let config = { backgrounds: [], items: [] };
  let previewUrls = new Map();
  let pendingImageBlobs = new Map();
  let pendingUpload = null;
  let useFirebase = false;

  const $ = (sel) => document.querySelector(sel);

  function toast(msg, isError = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast show${isError ? " error" : ""}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function firebaseReady() {
    return useFirebase && window.TrainModelFirebase?.isConfigured();
  }

  async function unlockApp() {
    $("#login-overlay").classList.add("hidden");
    $("#admin-app").classList.remove("hidden");
    await loadConfig();
    renderAll();
    if (!adminInitialized) {
      bindEvents();
      adminInitialized = true;
    }
  }

  function lockApp() {
    $("#admin-app").classList.add("hidden");
    $("#login-overlay").classList.remove("hidden");
  }

  async function bindLogin() {
    useFirebase = window.TrainModelFirebase?.isConfigured() || false;

    if (!useFirebase) {
      $("#login-hint").textContent =
        "Firebase 尚未設定。請編輯 js/firebase-config.js 後重新整理此頁。";
      $("#login-btn").disabled = true;
      return;
    }

    $("#login-btn").disabled = false;
    $("#firebase-setup-hint").classList.add("hidden");

    $("#login-btn").addEventListener("click", async () => {
      const email = $("#login-email").value.trim();
      const password = $("#login-password").value;
      if (!email || !password) {
        toast("請輸入 Email 與密碼", true);
        return;
      }

      try {
        await TrainModelFirebase.signIn(email, password);
        toast("登入成功");
      } catch (err) {
        toast(err.message || "登入失敗", true);
      }
    });

    $("#login-password").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#login-btn").click();
    });

    $("#logout-btn").addEventListener("click", async () => {
      await TrainModelFirebase.signOut();
      lockApp();
      toast("已登出");
    });

    TrainModelFirebase.onAuthStateChanged((user) => {
      if (user) unlockApp();
      else lockApp();
    });
  }

  async function loadConfig() {
    if (!firebaseReady()) {
      config = { backgrounds: [], items: [] };
      return;
    }

    try {
      const cloud = await TrainModelFirebase.getConfig();
      if (cloud?.backgrounds?.length || cloud?.items?.length) {
        config = cloud;
        normalizeConfigEntries(config);
        pendingImageBlobs.clear();
        await refreshPreviewUrls();
        return;
      }
    } catch {
      /* fall through */
    }

    config = { backgrounds: [], items: [] };
    toast("無法載入雲端資料", true);
  }

  async function resolveImageBlob(path) {
    if (pendingImageBlobs.has(path)) {
      return pendingImageBlobs.get(path);
    }

    try {
      const res = await fetch(previewSrc(path));
      if (res.ok) return res.blob();
    } catch {
      /* ignore */
    }
    return null;
  }

  async function refreshPreviewUrls() {
    previewUrls.forEach((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
    previewUrls = new Map();

    if (firebaseReady()) {
      const cloudUrls = await TrainModelFirebase.loadImageUrlsForConfig(config);
      cloudUrls.forEach((url, path) => previewUrls.set(path, url));
    }

    pendingImageBlobs.forEach((blob, path) => {
      previewUrls.set(path, URL.createObjectURL(blob));
    });
  }

  function previewSrc(file) {
    return previewUrls.get(file) || file;
  }

  function nextId(prefix, list) {
    let n = list.length + 1;
    while (list.some((e) => e.id === `${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  }

  function normalizeConfigEntries(cfg) {
    [...(cfg.backgrounds || []), ...(cfg.items || [])].forEach((entry) => {
      entry.userCanEditDims = entry.userCanEditDims !== false;
    });
    return cfg;
  }

  function renderList(type) {
    const isBg = type === "background";
    const list = isBg ? config.backgrounds : config.items;
    const container = $(isBg ? "#bg-list" : "#item-list");

    container.innerHTML = list
      .map((entry) => {
        const folder = isBg ? "background" : "items";
        return `
          <article class="admin-card" data-type="${type}" data-id="${entry.id}">
            <img class="thumb" src="${previewSrc(entry.file)}" alt="">
            <div class="fields">
              <div class="field-row">
                <div>
                  <label>名稱</label>
                  <input type="text" data-field="name" value="${escapeHtml(entry.name)}">
                </div>
                <div>
                  <label>寬度 (mm)</label>
                  <input type="number" min="1" data-field="width" value="${entry.width}">
                </div>
                <div>
                  <label>高度 (mm)</label>
                  <input type="number" min="1" data-field="height" value="${entry.height}">
                </div>
              </div>
              <div class="field-footer">
                <span class="meta">${folder}/${escapeHtml(entry.file.split("/").pop())}</span>
                <label class="admin-toggle">
                  <input type="checkbox" data-field="userCanEditDims" ${
                    entry.userCanEditDims !== false ? "checked" : ""
                  }>
                  <span class="admin-toggle-box" aria-hidden="true"></span>
                  <span class="admin-toggle-text">允許使用者調整寬高</span>
                </label>
              </div>
            </div>
            <div class="card-actions">
              <button class="btn btn-ghost" type="button" data-action="upload">更換圖片</button>
              <button class="btn btn-danger" type="button" data-action="delete">刪除</button>
            </div>
          </article>
        `;
      })
      .join("");

    container.querySelectorAll(".admin-card").forEach((card) => {
      const typeName = card.dataset.type;
      const id = card.dataset.id;
      const listRef = typeName === "background" ? config.backgrounds : config.items;
      const entry = listRef.find((e) => e.id === id);

      card.querySelectorAll("[data-field]").forEach((input) => {
        input.addEventListener("change", () => {
          const field = input.dataset.field;
          if (field === "name") entry.name = input.value.trim() || entry.name;
          if (field === "width") entry.width = Math.max(1, parseInt(input.value, 10) || entry.width);
          if (field === "height") entry.height = Math.max(1, parseInt(input.value, 10) || entry.height);
          if (field === "userCanEditDims") entry.userCanEditDims = input.checked;
        });
      });

      card.querySelector('[data-action="upload"]').addEventListener("click", () => {
        pendingUpload = { type: typeName, id };
        $("#upload-image-input").click();
      });

      card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        if (!confirm(`確定刪除「${entry.name}」？`)) return;
        const idx = listRef.findIndex((e) => e.id === id);
        if (idx >= 0) listRef.splice(idx, 1);
        pendingImageBlobs.delete(entry.file);
        if (firebaseReady() && TrainModelFirebase.getCurrentUser()) {
          await TrainModelFirebase.deleteImage(entry.file).catch(() => {});
        }
        renderAll();
        toast("已刪除（請按儲存到雲端）");
      });
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAll() {
    renderList("background");
    renderList("item");
  }

  async function handleImageUpload(file) {
    if (!pendingUpload || !file) return;

    const isBg = pendingUpload.type === "background";
    const list = isBg ? config.backgrounds : config.items;
    const entry = list.find((e) => e.id === pendingUpload.id);
    if (!entry) return;

    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".jpg";
    const folder = isBg ? "background" : "items";
    const filename = sanitizeFilename(`${entry.id}-${Date.now()}${ext}`);
    const path = `${folder}/${filename}`;
    const oldPath = entry.file;

    pendingImageBlobs.delete(oldPath);
    pendingImageBlobs.set(path, file);
    entry.file = path;

    if (firebaseReady() && TrainModelFirebase.getCurrentUser()) {
      try {
        await TrainModelFirebase.uploadImage(path, file);
        if (oldPath !== path) {
          await TrainModelFirebase.deleteImage(oldPath).catch(() => {});
          pendingImageBlobs.delete(path);
        }
      } catch (err) {
        toast(`圖片已選取，雲端上傳失敗：${err.message}`, true);
      }
    }

    pendingUpload = null;
    await refreshPreviewUrls();
    renderAll();
    toast("圖片已更新（請按儲存到雲端同步設定）");
  }

  function addEntry(type) {
    const isBg = type === "background";
    const list = isBg ? config.backgrounds : config.items;
    const id = nextId(isBg ? "bg" : "item", list);
    const folder = isBg ? "background" : "items";
    list.push({
      id,
      name: isBg ? `新背景 ${list.length + 1}` : `新組件 ${list.length + 1}`,
      file: `${folder}/${id}-placeholder.jpg`,
      width: isBg ? 3200 : 500,
      height: isBg ? 2400 : 500,
      userCanEditDims: true,
    });
    renderAll();
  }

  async function saveCloud() {
    if (!firebaseReady()) {
      toast("請先設定 Firebase（js/firebase-config.js）", true);
      return;
    }
    if (!TrainModelFirebase.getCurrentUser()) {
      toast("請先登入管理員帳號", true);
      return;
    }

    const btn = $("#save-cloud-btn");
    btn.disabled = true;

    try {
      normalizeConfigEntries(config);
      await TrainModelFirebase.publishConfig(config, resolveImageBlob);
      pendingImageBlobs.clear();
      await refreshPreviewUrls();
      toast("已儲存到雲端，所有使用者將看到更新");
    } catch (err) {
      toast(err.message || "雲端儲存失敗", true);
    } finally {
      btn.disabled = false;
    }
  }

  async function exportZip() {
    if (typeof JSZip === "undefined") {
      toast("ZIP 套件載入失敗", true);
      return;
    }

    const zip = new JSZip();
    zip.file("config.json", JSON.stringify(config, null, 2));

    const paths = new Set();
    [...config.backgrounds, ...config.items].forEach((e) => paths.add(e.file));

    for (const path of paths) {
      const blob = await resolveImageBlob(path);
      if (blob) zip.file(path, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `列車建模-export-${Date.now()}.zip`);
    toast("ZIP 已下載");
  }

  async function importZip(file) {
    if (!file || typeof JSZip === "undefined") return;

    const zip = await JSZip.loadAsync(file);
    const configFile = zip.file("config.json");
    if (!configFile) {
      toast("ZIP 內缺少 config.json", true);
      return;
    }

    const imported = JSON.parse(await configFile.async("string"));
    if (!imported.backgrounds || !imported.items) {
      toast("config.json 格式不正確", true);
      return;
    }

    config = imported;
    normalizeConfigEntries(config);
    pendingImageBlobs.clear();

    const imageFiles = Object.keys(zip.files).filter(
      (name) => !zip.files[name].dir && name !== "config.json"
    );

    for (const path of imageFiles) {
      const blob = await zip.file(path).async("blob");
      pendingImageBlobs.set(path, blob);
    }

    await refreshPreviewUrls();
    renderAll();
    toast("匯入成功（請按儲存到雲端發布）");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    $("#add-bg-btn").addEventListener("click", () => addEntry("background"));
    $("#add-item-btn").addEventListener("click", () => addEntry("item"));
    $("#save-cloud-btn").addEventListener("click", () => saveCloud());
    $("#export-zip-btn").addEventListener("click", () => exportZip());

    $("#upload-image-input").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      handleImageUpload(file);
    });

    $("#import-zip-btn").addEventListener("click", () => $("#import-zip-input").click());
    $("#import-zip-input").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) importZip(file);
    });
  }

  let adminInitialized = false;

  bindLogin();
})();
