(function () {
  "use strict";

  const PASSWORD_KEY = "trainModelAdminPassword";
  const SESSION_KEY = "trainModelAdminSession";
  const DEFAULT_PASSWORD = "trainadmin";

  let config = { backgrounds: [], items: [] };
  let previewUrls = new Map();
  let pendingUpload = null;

  const $ = (sel) => document.querySelector(sel);

  function toast(msg, isError = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast show${isError ? " error" : ""}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function getPassword() {
    return localStorage.getItem(PASSWORD_KEY) || DEFAULT_PASSWORD;
  }

  function checkSession() {
    return sessionStorage.getItem(SESSION_KEY) === "ok";
  }

  function unlockApp() {
    sessionStorage.setItem(SESSION_KEY, "ok");
    $("#login-overlay").classList.add("hidden");
    $("#admin-app").classList.remove("hidden");
    initAdmin();
  }

  function bindLogin() {
    $("#login-btn").addEventListener("click", () => {
      const input = $("#login-password").value;
      if (input === getPassword()) unlockApp();
      else toast("密碼錯誤", true);
    });
    $("#login-password").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#login-btn").click();
    });

    if (checkSession()) unlockApp();
  }

  async function loadBaseConfig() {
    try {
      const res = await fetch("config.json");
      if (res.ok) return res.json();
    } catch {
      /* ignore */
    }
    return { backgrounds: [], items: [] };
  }

  async function loadConfig() {
    const local = await TrainModelStore.getConfig();
    if (local?.backgrounds?.length || local?.items?.length) {
      config = local;
    } else {
      config = await loadBaseConfig();
    }
    await refreshPreviewUrls();
  }

  async function refreshPreviewUrls() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = await TrainModelStore.loadImageUrlsForConfig(config);

    const all = [...config.backgrounds, ...config.items];
    for (const entry of all) {
      if (previewUrls.has(entry.file)) continue;
      try {
        previewUrls.set(entry.file, new URL(entry.file, document.baseURI).href);
      } catch {
        /* ignore */
      }
    }
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
              <div class="meta">${folder}/${escapeHtml(entry.file.split("/").pop())}</div>
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
        await TrainModelStore.deleteImage(entry.file).catch(() => {});
        renderAll();
        toast("已刪除（請按儲存到瀏覽器）");
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

    await TrainModelStore.saveImage(path, file);
    if (entry.file !== path) {
      await TrainModelStore.deleteImage(entry.file).catch(() => {});
    }
    entry.file = path;

    pendingUpload = null;
    await refreshPreviewUrls();
    renderAll();
    toast("圖片已更新（請按儲存到瀏覽器）");
  }

  function addEntry(type) {
    const isBg = type === "background";
    const list = isBg ? config.backgrounds : config.items;
    const id = nextId(isBg ? "bg" : "item", list);
    const folder = isBg ? "background" : "items";
    list.push({
      id,
      name: isBg ? `新底板 ${list.length + 1}` : `新組件 ${list.length + 1}`,
      file: `${folder}/${id}-placeholder.jpg`,
      width: isBg ? 3200 : 500,
      height: isBg ? 2400 : 500,
    });
    renderAll();
  }

  async function saveLocal() {
    await TrainModelStore.saveConfig(config);
    toast("已儲存到瀏覽器，返回模擬器即可看到更新");
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
      let blob = await TrainModelStore.getImageBlob(path);
      if (!blob) {
        try {
          const res = await fetch(previewSrc(path));
          if (res.ok) blob = await res.blob();
        } catch {
          /* skip missing */
        }
      }
      if (blob) zip.file(path, blob);
    }

    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `列車建模-export-${Date.now()}.zip`);
    toast("ZIP 已下載，解壓後上傳到 GitHub 倉庫根目錄");
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
    const imageFiles = Object.keys(zip.files).filter(
      (name) => !zip.files[name].dir && name !== "config.json"
    );

    for (const path of imageFiles) {
      const blob = await zip.file(path).async("blob");
      await TrainModelStore.saveImage(path, blob);
    }

    await TrainModelStore.saveConfig(config);
    await refreshPreviewUrls();
    renderAll();
    toast("匯入成功");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function resetLocal() {
    if (!confirm("清除本機管理資料？模擬器將恢復使用 config.json 預設內容。")) return;
    await TrainModelStore.clearAll();
    config = await loadBaseConfig();
    await refreshPreviewUrls();
    renderAll();
    toast("本機資料已清除");
  }

  function bindEvents() {
    $("#add-bg-btn").addEventListener("click", () => addEntry("background"));
    $("#add-item-btn").addEventListener("click", () => addEntry("item"));
    $("#save-local-btn").addEventListener("click", () => saveLocal());
    $("#export-zip-btn").addEventListener("click", () => exportZip());
    $("#reset-local-btn").addEventListener("click", () => resetLocal());

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

    $("#change-password-btn").addEventListener("click", () => {
      const val = $("#new-password").value.trim();
      if (!val) {
        toast("請輸入新密碼", true);
        return;
      }
      localStorage.setItem(PASSWORD_KEY, val);
      $("#new-password").value = "";
      toast("密碼已更新");
    });
  }

  async function initAdmin() {
    await loadConfig();
    renderAll();
    bindEvents();
  }

  bindLogin();
})();
