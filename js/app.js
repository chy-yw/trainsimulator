(function () {
  "use strict";

  const STORAGE_KEY = "trainModelConfig";

  let config = { backgrounds: [], items: [] };
  let currentBgId = null;
  let placedItems = [];
  let selectedPlacedId = null;
  let dragState = null;
  let scale = 1;
  let exportInProgress = false;
  const imageCache = new Map();
  const adminImageUrls = new Map();

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function assetUrl(path) {
    if (!path) return "";
    if (adminImageUrls.has(path)) return adminImageUrls.get(path);
    try {
      return new URL(path, document.baseURI).href;
    } catch {
      return path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
    }
  }

  const board = $("#board");
  const boardWrapper = $("#board-wrapper");
  const boardBg = $("#board-bg");
  const palette = $("#palette");
  const bgSelect = $("#bg-select");
  const bgConfig = $("#bg-config");
  const itemsConfig = $("#items-config");
  const placedList = $("#placed-list");
  const statusCard = $("#status-card");
  const toast = $("#toast");

  async function init() {
    await loadConfig();
    buildBgSelect();
    buildBgConfig();
    buildItemsConfig();
    selectBackground(config.backgrounds[0]?.id);
    buildPalette();
    bindEvents();
    bindPointerDrag();
  }

  async function loadFirebaseConfig() {
    if (!window.TrainModelFirebase?.isConfigured()) return false;
    try {
      const cloudConfig = await TrainModelFirebase.getConfig();
      if (!cloudConfig?.backgrounds?.length && !cloudConfig?.items?.length) return false;

      config = cloudConfig;
      const urls = await TrainModelFirebase.loadImageUrlsForConfig(config);
      urls.forEach((url, path) => adminImageUrls.set(path, url));
      return true;
    } catch {
      return false;
    }
  }

  async function loadAdminConfig() {
    if (!window.TrainModelStore) return;
    try {
      const adminConfig = await TrainModelStore.getConfig();
      if (!adminConfig?.backgrounds?.length && !adminConfig?.items?.length) return;

      config = adminConfig;
      const urls = await TrainModelStore.loadImageUrlsForConfig(config);
      urls.forEach((url, path) => adminImageUrls.set(path, url));
    } catch {
      /* IndexedDB unavailable */
    }
  }

  async function loadConfig() {
    const loadedFromFirebase = await loadFirebaseConfig();

    if (!loadedFromFirebase) {
      try {
        const res = await fetch("config.json");
        if (res.ok) {
          config = await res.json();
        }
      } catch {
        /* file:// fallback */
      }

      await loadAdminConfig();
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.version === 2) {
          mergeConfig(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        /* ignore */
      }
    }

    if (!config.backgrounds?.length) {
      config = getEmbeddedConfig();
    }
  }

  function getEmbeddedConfig() {
    return {
      backgrounds: [
        { id: "bg1", name: "車廂 A（車門區）", file: "background/bg-1.jpeg", width: 3200, height: 2400 },
        { id: "bg2", name: "車廂 B（窗戶區）", file: "background/bg-2.jpeg", width: 3200, height: 2400 },
        { id: "bg3", name: "車廂 C", file: "background/bg-3.jpeg", width: 3200, height: 2400 },
        { id: "bg4", name: "車廂 D", file: "background/bg-4.jpeg", width: 3200, height: 2400 },
      ],
      items: [
        { id: "item1", name: "組件 1", file: "items/item-1.jpg", width: 800, height: 600 },
        { id: "item2", name: "組件 2", file: "items/item-2.jpg", width: 600, height: 600 },
        { id: "item3", name: "組件 3", file: "items/item-3.jpg", width: 700, height: 500 },
        { id: "item4", name: "組件 4", file: "items/item-4.jpg", width: 500, height: 400 },
        { id: "item5", name: "組件 5", file: "items/item-5.jpg", width: 450, height: 450 },
        { id: "item6", name: "組件 6", file: "items/Picture8.jpg", width: 900, height: 350 },
        { id: "item7", name: "組件 7", file: "items/Picture9.jpg", width: 500, height: 500 },
        { id: "item8", name: "組件 8", file: "items/Picture10.jpg", width: 450, height: 450 },
        { id: "item9", name: "組件 9", file: "items/Picture11.jpg", width: 600, height: 500 },
      ],
    };
  }

  function mergeConfig(saved) {
    if (saved.backgrounds) {
      saved.backgrounds.forEach((sb) => {
        const bg = config.backgrounds.find((b) => b.id === sb.id);
        if (bg) {
          bg.width = sb.width;
          bg.height = sb.height;
          if (sb.name) bg.name = sb.name;
        }
      });
    }
    if (saved.items) {
      saved.items.forEach((si) => {
        const item = config.items.find((i) => i.id === si.id);
        if (item) {
          item.width = si.width;
          item.height = si.height;
          if (si.name) item.name = si.name;
        }
      });
    }
  }

  function saveConfig() {
    const payload = {
      version: 2,
      backgrounds: config.backgrounds.map(({ id, name, width, height }) => ({
        id,
        name,
        width,
        height,
      })),
      items: config.items.map(({ id, name, width, height }) => ({
        id,
        name,
        width,
        height,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    showToast("尺寸設定已儲存");
  }

  function getCurrentBg() {
    return config.backgrounds.find((b) => b.id === currentBgId);
  }

  function getItemDef(itemId) {
    return config.items.find((i) => i.id === itemId);
  }

  function buildBgSelect() {
    bgSelect.innerHTML = config.backgrounds
      .map((bg) => `<option value="${bg.id}">${bg.name}</option>`)
      .join("");
  }

  function buildBgConfig() {
    bgConfig.innerHTML = "";
    config.backgrounds.forEach((bg) => {
      const card = document.createElement("div");
      card.className = "config-card";
      card.dataset.bgId = bg.id;
      card.innerHTML = `
        <div class="card-title">
          <img src="${assetUrl(bg.file)}" alt="">
          <span>${bg.name}</span>
        </div>
        <div class="dim-row">
          <div class="field">
            <label>寬度 (mm)</label>
            <input type="number" min="1" data-bg-width="${bg.id}" value="${bg.width}">
          </div>
          <div class="field">
            <label>高度 (mm)</label>
            <input type="number" min="1" data-bg-height="${bg.id}" value="${bg.height}">
          </div>
        </div>
      `;
      bgConfig.appendChild(card);
    });
  }

  function buildItemsConfig() {
    itemsConfig.innerHTML = "";
    config.items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "config-card";
      card.innerHTML = `
        <div class="card-title">
          <img src="${assetUrl(item.file)}" alt="">
          <span>${item.name}</span>
        </div>
        <div class="dim-row">
          <div class="field">
            <label>寬度 (mm)</label>
            <input type="number" min="1" data-item-width="${item.id}" value="${item.width}">
          </div>
          <div class="field">
            <label>高度 (mm)</label>
            <input type="number" min="1" data-item-height="${item.id}" value="${item.height}">
          </div>
        </div>
      `;
      itemsConfig.appendChild(card);
    });
  }

  function buildPalette() {
    palette.innerHTML = "";
    config.items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "palette-item";
      el.draggable = true;
      el.dataset.itemId = item.id;
      el.innerHTML = `
        <img src="${assetUrl(item.file)}" alt="${item.name}" draggable="false">
        <div class="info">
          <div class="name">${item.name}</div>
          <div class="dims">${item.width} × ${item.height} mm</div>
        </div>
      `;
      el.addEventListener("dragstart", onPaletteDragStart);
      el.addEventListener("dragend", onDragEnd);
      el.addEventListener("mousedown", onPalettePointerDown);
      palette.appendChild(el);
    });
    updatePaletteState();
  }

  function selectBackground(bgId) {
    const bg = config.backgrounds.find((b) => b.id === bgId);
    if (!bg) return;

    currentBgId = bgId;
    bgSelect.value = bgId;
    placedItems = [];
    selectedPlacedId = null;

    const url = assetUrl(bg.file);
    boardBg.src = url;
    boardBg.alt = bg.name;
    boardBg.onerror = () => {
      boardBg.onerror = null;
      boardBg.src = bg.file.split("/").map(encodeURIComponent).join("/");
    };

    resizeBoard();
    renderPlacedItems();
    updateStatus();
    updatePaletteState();
    $("#board-label").textContent = `${bg.name} — ${bg.width} × ${bg.height} mm`;
  }

  function resizeBoard() {
    const bg = getCurrentBg();
    if (!bg) return;

    const maxW = Math.min(window.innerWidth - 640, 900);
    scale = maxW / bg.width;
    const displayW = bg.width * scale;
    const displayH = bg.height * scale;

    board.style.width = `${displayW}px`;
    board.style.height = `${displayH}px`;
    updateBoardGridVisual();
  }

  function modelToDisplay(modelVal) {
    return modelVal * scale;
  }

  function displayToModel(displayVal) {
    return displayVal / scale;
  }

  function getPlacedRects(excludePlacedId = null) {
    return placedItems
      .filter((p) => p.instanceId !== excludePlacedId)
      .map((p) => {
        const def = getItemDef(p.itemId);
        return { x: p.x, y: p.y, width: def.width, height: def.height };
      });
  }

  function getGridCell() {
    const bg = getCurrentBg();
    if (!bg) return 100;
    return Math.max(50, Math.round(Math.min(bg.width, bg.height) / 24));
  }

  function snapToGrid(x, y, w, h) {
    const bg = getCurrentBg();
    const cell = getGridCell();
    const maxX = Math.max(0, bg.width - w);
    const maxY = Math.max(0, bg.height - h);
    return {
      x: Math.max(0, Math.min(Math.round(x / cell) * cell, maxX)),
      y: Math.max(0, Math.min(Math.round(y / cell) * cell, maxY)),
    };
  }

  function groupIntoGridRows(rects, cell) {
    if (!rects.length) return [];

    const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];

    for (const rect of sorted) {
      let row = rows.find((r) => Math.abs(rect.y - r.y) <= cell / 2);
      if (!row) {
        row = { y: rect.y, items: [] };
        rows.push(row);
      }
      row.items.push(rect);
    }

    return rows.map((row) => {
      const left = Math.min(...row.items.map((i) => i.x));
      const right = Math.max(...row.items.map((i) => i.x + i.width));
      return {
        y: row.y,
        width: right - left,
        height: Math.max(...row.items.map((i) => i.height)),
        items: row.items,
      };
    });
  }

  function getGridFootprint(excludePlacedId = null, extraRect = null) {
    const rects = getPlacedRects(excludePlacedId);
    if (extraRect) rects.push(extraRect);

    if (!rects.length) {
      return { occupiedWidth: 0, occupiedHeight: 0, rowCount: 0, count: 0 };
    }

    const rows = groupIntoGridRows(rects, getGridCell());
    return {
      occupiedWidth: Math.max(...rows.map((r) => r.width)),
      occupiedHeight: rows.reduce((sum, r) => sum + r.height, 0),
      rowCount: rows.length,
      count: rects.length,
    };
  }

  function footprintExceedsBoard(footprint) {
    const bg = getCurrentBg();
    if (!bg) return false;
    return footprint.occupiedWidth > bg.width || footprint.occupiedHeight > bg.height;
  }

  function findNextGridSlot(itemDef, excludePlacedId = null) {
    const bg = getCurrentBg();
    if (!bg) return null;

    const cell = getGridCell();
    const maxY = bg.height - itemDef.height;
    const maxX = bg.width - itemDef.width;

    for (let y = 0; y <= maxY; y += cell) {
      for (let x = 0; x <= maxX; x += cell) {
        const check = canPlaceAt(x, y, itemDef, excludePlacedId, { skipFootprint: true });
        if (!check.ok) continue;

        const footprint = getGridFootprint(excludePlacedId, {
          x,
          y,
          width: itemDef.width,
          height: itemDef.height,
        });
        if (!footprintExceedsBoard(footprint)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  function updateBoardGridVisual() {
    const gridEl = board.querySelector(".board-grid");
    if (!gridEl) return;
    const px = Math.max(8, modelToDisplay(getGridCell()));
    gridEl.style.backgroundSize = `${px}px ${px}px`;
  }

  function rectanglesOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  function overlapsAnyPlaced(x, y, itemDef, excludePlacedId = null) {
    const w = itemDef.width;
    const h = itemDef.height;
    return placedItems.some((placed) => {
      if (placed.instanceId === excludePlacedId) return false;
      const other = getItemDef(placed.itemId);
      if (!other) return false;
      return rectanglesOverlap(x, y, w, h, placed.x, placed.y, other.width, other.height);
    });
  }

  function canPlaceAt(x, y, itemDef, excludePlacedId = null, options = {}) {
    const bg = getCurrentBg();
    const w = itemDef.width;
    const h = itemDef.height;

    if (x < 0 || y < 0 || x + w > bg.width || y + h > bg.height) {
      return {
        ok: false,
        reason: "組件超出底板邊界，無法貼上",
      };
    }

    if (overlapsAnyPlaced(x, y, itemDef, excludePlacedId)) {
      return {
        ok: false,
        reason: "組件不能重疊在其他組件上",
      };
    }

    if (!options.skipFootprint) {
      const footprint = getGridFootprint(excludePlacedId, {
        x,
        y,
        width: w,
        height: h,
      });
      if (footprintExceedsBoard(footprint)) {
        return {
          ok: false,
          reason: `網格佔用尺寸 (${footprint.occupiedWidth}×${footprint.occupiedHeight} mm) 超過底板限制`,
        };
      }
    }

    return { ok: true };
  }

  function wouldExceedIfAdded(itemDef) {
    if (!itemDef) return false;
    return findNextGridSlot(itemDef) === null;
  }

  function clampPosition(x, y, itemDef) {
    const bg = getCurrentBg();
    const maxX = Math.max(0, bg.width - itemDef.width);
    const maxY = Math.max(0, bg.height - itemDef.height);
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    };
  }

  function placeItemAt(itemId, modelX, modelY) {
    const itemDef = getItemDef(itemId);
    if (!itemDef) return false;

    if (wouldExceedIfAdded(itemDef)) {
      showToast("無法添加：底板網格已無可用空間", true);
      return false;
    }

    let pos = clampPosition(
      modelX - itemDef.width / 2,
      modelY - itemDef.height / 2,
      itemDef
    );
    pos = snapToGrid(pos.x, pos.y, itemDef.width, itemDef.height);

    let check = canPlaceAt(pos.x, pos.y, itemDef);
    if (!check.ok) {
      const slot = findNextGridSlot(itemDef);
      if (!slot) {
        showToast(check.reason, true);
        return false;
      }
      pos = slot;
    }

    placedItems.push({
      instanceId: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      itemId,
      x: pos.x,
      y: pos.y,
    });
    renderPlacedItems();
    updateStatus();
    updatePaletteState();
    showToast(`${itemDef.name} 已貼上`);
    return true;
  }

  function loadImageElement(src, useCors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }

  async function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);

    const promise = (async () => {
      try {
        return await loadImageElement(src, true);
      } catch {
        return loadImageElement(src, false);
      }
    })();

    imageCache.set(src, promise);
    return promise;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function buildExportFilename() {
    const bg = getCurrentBg();
    const safeName = (bg?.name || "board").replace(/[<>:"/\\|?*]/g, "-");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `列車建模-${safeName}-${placedItems.length}項-${stamp}.png`;
  }

  async function exportBoardImage(options = {}) {
    const { auto = false, silent = false } = options;
    const bg = getCurrentBg();

    if (!bg) return false;
    if (!placedItems.length) {
      if (!auto && !silent) showToast("請先貼上至少一個組件", true);
      return false;
    }
    if (exportInProgress) return false;

    exportInProgress = true;
    const saveBtn = $("#save-image");
    if (saveBtn) saveBtn.disabled = true;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = bg.width;
      canvas.height = bg.height;
      const ctx = canvas.getContext("2d");

      const bgImg = await loadImage(assetUrl(bg.file));
      ctx.drawImage(bgImg, 0, 0, bg.width, bg.height);

      for (const placed of placedItems) {
        const def = getItemDef(placed.itemId);
        const itemImg = await loadImage(assetUrl(def.file));
        ctx.drawImage(itemImg, placed.x, placed.y, def.width, def.height);
      }

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error("Canvas export failed"));
        }, "image/png");
      });

      downloadBlob(blob, buildExportFilename());

      if (!silent) {
        showToast(auto ? "已自動儲存合成圖片" : "圖片已儲存");
      }
      return true;
    } catch {
      if (!silent) {
        showToast("無法儲存圖片，請用 Live Server 或 GitHub Pages 開啟", true);
      }
      return false;
    } finally {
      exportInProgress = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function onPaletteDragStart(e) {
    const itemId = e.currentTarget.dataset.itemId;
    const itemDef = getItemDef(itemId);

    if (wouldExceedIfAdded(itemDef)) {
      e.preventDefault();
      showToast(
        `無法添加：底板網格已無可用空間`,
        true
      );
      return;
    }

    dragState = { type: "palette", itemId };
    e.dataTransfer.setData("text/plain", itemId);
    e.dataTransfer.effectAllowed = "copy";
  }

  function onDragEnd() {
    dragState = null;
    board.classList.remove("drag-over", "drag-invalid");
  }

  function onBoardDragOver(e) {
    e.preventDefault();
    if (!dragState) return;

    const rect = board.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    const modelX = displayToModel(displayX);
    const modelY = displayToModel(displayY);

    let check;
    if (dragState.type === "palette") {
      const itemDef = getItemDef(dragState.itemId);
      check = canPlaceAt(modelX, modelY, itemDef);
    } else if (dragState.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === dragState.instanceId);
      const itemDef = getItemDef(placed.itemId);
      check = canPlaceAt(modelX, modelY, itemDef, dragState.instanceId);
    }

    board.classList.add("drag-over");
    board.classList.toggle("drag-invalid", check && !check.ok);
    e.dataTransfer.dropEffect = check?.ok ? "copy" : "none";
  }

  function onBoardDragLeave(e) {
    if (!board.contains(e.relatedTarget)) {
      board.classList.remove("drag-over", "drag-invalid");
    }
  }

  function onBoardDrop(e) {
    e.preventDefault();
    board.classList.remove("drag-over", "drag-invalid");

    const rect = board.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;
    const modelX = Math.round(displayToModel(displayX));
    const modelY = Math.round(displayToModel(displayY));

    if (dragState?.type === "palette") {
      placeItemAt(dragState.itemId, modelX, modelY);
    } else if (dragState?.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === dragState.instanceId);
      const itemDef = getItemDef(placed.itemId);
      let pos = clampPosition(
        modelX - itemDef.width / 2,
        modelY - itemDef.height / 2,
        itemDef
      );
      pos = snapToGrid(pos.x, pos.y, itemDef.width, itemDef.height);
      const check = canPlaceAt(pos.x, pos.y, itemDef, dragState.instanceId);
      if (!check.ok) {
        showToast(check.reason, true);
        return;
      }
      placed.x = pos.x;
      placed.y = pos.y;
      renderPlacedItems();
      updateStatus();
    }

    dragState = null;
  }

  function renderPlacedItems() {
    board.querySelectorAll(".placed-item").forEach((el) => el.remove());

    placedItems.forEach((placed) => {
      const itemDef = getItemDef(placed.itemId);
      const el = document.createElement("div");
      el.className = "placed-item";
      if (placed.instanceId === selectedPlacedId) el.classList.add("selected");
      el.dataset.instanceId = placed.instanceId;
      el.style.left = `${modelToDisplay(placed.x)}px`;
      el.style.top = `${modelToDisplay(placed.y)}px`;
      el.style.width = `${modelToDisplay(itemDef.width)}px`;
      el.style.height = `${modelToDisplay(itemDef.height)}px`;

      el.innerHTML = `
        <img src="${assetUrl(itemDef.file)}" alt="${itemDef.name}" draggable="false">
        <span class="dim-label">${itemDef.width}×${itemDef.height}</span>
        <button class="remove-btn" title="移除">×</button>
      `;

      el.addEventListener("mousedown", (e) => onPlacedPointerDown(e, placed.instanceId));
      el.addEventListener("click", (e) => {
        if (e.target.classList.contains("remove-btn")) return;
        if (el.dataset.dragMoved === "1") {
          el.dataset.dragMoved = "0";
          return;
        }
        selectedPlacedId = placed.instanceId;
        renderPlacedItems();
      });
      el.querySelector(".remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        removePlaced(placed.instanceId);
      });

      board.appendChild(el);
    });

    renderPlacedList();
  }

  function removePlaced(instanceId) {
    placedItems = placedItems.filter((p) => p.instanceId !== instanceId);
    if (selectedPlacedId === instanceId) selectedPlacedId = null;
    renderPlacedItems();
    updateStatus();
    updatePaletteState();
  }

  function renderPlacedList() {
    if (!placedItems.length) {
      placedList.innerHTML = '<li style="color:var(--text-muted)">尚未貼上任何組件</li>';
      return;
    }

    placedList.innerHTML = placedItems
      .map((p) => {
        const def = getItemDef(p.itemId);
        return `<li>
          <span>${def.name}</span>
          <span>${def.width}×${def.height}</span>
        </li>`;
      })
      .join("");
  }

  function updateStatus() {
    const bg = getCurrentBg();
    if (!bg) return;
    const footprint = getGridFootprint();
    const widthPct = Math.min(100, (footprint.occupiedWidth / bg.width) * 100);
    const heightPct = Math.min(100, (footprint.occupiedHeight / bg.height) * 100);
    const widthOk = footprint.occupiedWidth <= bg.width;
    const heightOk = footprint.occupiedHeight <= bg.height;
    const allOk = widthOk && heightOk;

    statusCard.className = `status-card ${allOk ? "ok" : "error"}`;

    statusCard.innerHTML = `
      <div class="status-title">${allOk ? "✓ 網格佔用在限制內" : "✗ 網格佔用超出底板"}</div>
      <div class="meter">
        <div class="meter-label">
          <span>佔用寬度</span>
          <span>${footprint.occupiedWidth} / ${bg.width} mm</span>
        </div>
        <div class="meter-bar">
          <div class="meter-fill ${widthOk ? (widthPct > 80 ? "warn" : "ok") : "error"}" style="width:${widthPct}%"></div>
        </div>
      </div>
      <div class="meter">
        <div class="meter-label">
          <span>佔用高度</span>
          <span>${footprint.occupiedHeight} / ${bg.height} mm</span>
        </div>
        <div class="meter-bar">
          <div class="meter-fill ${heightOk ? (heightPct > 80 ? "warn" : "ok") : "error"}" style="width:${heightPct}%"></div>
        </div>
      </div>
      <div class="hint">已貼上 ${placedItems.length} 個組件，排列為 ${footprint.rowCount} 行。組件會對齊網格，同行共用高度、同列累加寬度。</div>
    `;
  }

  function updatePaletteState() {
    $$(".palette-item").forEach((el) => {
      const itemId = el.dataset.itemId;
      const itemDef = getItemDef(itemId);
      const disabled = wouldExceedIfAdded(itemDef);
      el.classList.toggle("disabled", disabled);
      const dims = el.querySelector(".dims");
      if (dims) {
        dims.textContent = disabled
          ? `${itemDef.width} × ${itemDef.height} mm — 網格已滿`
          : `${itemDef.width} × ${itemDef.height} mm`;
      }
    });
  }

  function applyConfigFromInputs() {
    config.backgrounds.forEach((bg) => {
      const wInput = document.querySelector(`[data-bg-width="${bg.id}"]`);
      const hInput = document.querySelector(`[data-bg-height="${bg.id}"]`);
      if (wInput) bg.width = Math.max(1, parseInt(wInput.value, 10) || bg.width);
      if (hInput) bg.height = Math.max(1, parseInt(hInput.value, 10) || bg.height);
    });

    config.items.forEach((item) => {
      const wInput = document.querySelector(`[data-item-width="${item.id}"]`);
      const hInput = document.querySelector(`[data-item-height="${item.id}"]`);
      if (wInput) item.width = Math.max(1, parseInt(wInput.value, 10) || item.width);
      if (hInput) item.height = Math.max(1, parseInt(hInput.value, 10) || item.height);
    });

    buildPalette();
    resizeBoard();
    renderPlacedItems();
    updateStatus();
    updatePaletteState();

    const bg = getCurrentBg();
    if (bg) {
      $("#board-label").textContent = `${bg.name} — ${bg.width} × ${bg.height} mm`;
    }
  }

  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.className = `toast show${isError ? " error" : ""}`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  let pointerDrag = null;
  let dragGhost = null;

  function onPalettePointerDown(e) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    if (el.classList.contains("disabled")) return;

    const itemId = el.dataset.itemId;
    const itemDef = getItemDef(itemId);
    if (!itemDef || wouldExceedIfAdded(itemDef)) return;

    e.preventDefault();
    pointerDrag = { type: "palette", itemId };

    dragGhost = document.createElement("div");
    dragGhost.className = "drag-ghost";
    dragGhost.innerHTML = `<img src="${assetUrl(itemDef.file)}" alt="" draggable="false">`;
    dragGhost.style.width = `${Math.min(modelToDisplay(itemDef.width), 120)}px`;
    dragGhost.style.height = `${Math.min(modelToDisplay(itemDef.height), 120)}px`;
    document.body.appendChild(dragGhost);
    moveDragGhost(e.clientX, e.clientY);
  }

  function onPlacedPointerDown(e, instanceId) {
    if (e.button !== 0) return;
    if (e.target.classList.contains("remove-btn")) return;

    const placed = placedItems.find((p) => p.instanceId === instanceId);
    if (!placed) return;

    const itemDef = getItemDef(placed.itemId);
    const coords = getBoardCoords(e.clientX, e.clientY);

    e.preventDefault();
    e.stopPropagation();

    selectedPlacedId = instanceId;
    pointerDrag = {
      type: "placed",
      instanceId,
      offsetX: coords.x - placed.x,
      offsetY: coords.y - placed.y,
      startX: placed.x,
      startY: placed.y,
      moved: false,
    };

    const el = board.querySelector(`[data-instance-id="${instanceId}"]`);
    if (el) {
      el.classList.add("dragging");
      el.style.zIndex = "30";
    }
  }

  function updatePlacedElement(placed) {
    const el = board.querySelector(`[data-instance-id="${placed.instanceId}"]`);
    const itemDef = getItemDef(placed.itemId);
    if (!el || !itemDef) return;
    el.style.left = `${modelToDisplay(placed.x)}px`;
    el.style.top = `${modelToDisplay(placed.y)}px`;
  }

  function moveDragGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = `${x}px`;
    dragGhost.style.top = `${y}px`;
  }

  function getBoardCoords(clientX, clientY) {
    const rect = board.getBoundingClientRect();
    return {
      x: displayToModel(clientX - rect.left),
      y: displayToModel(clientY - rect.top),
      inside:
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
    };
  }

  function onPointerMove(e) {
    if (!pointerDrag) return;
    moveDragGhost(e.clientX, e.clientY);

    const coords = getBoardCoords(e.clientX, e.clientY);
    board.classList.add("drag-over");
    if (pointerDrag.type === "palette") {
      const itemDef = getItemDef(pointerDrag.itemId);
      const centered = clampPosition(
        coords.x - itemDef.width / 2,
        coords.y - itemDef.height / 2,
        itemDef
      );
      const check = canPlaceAt(centered.x, centered.y, itemDef);
      board.classList.toggle("drag-invalid", !check.ok);
    } else if (pointerDrag.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === pointerDrag.instanceId);
      if (!placed) return;

      const itemDef = getItemDef(placed.itemId);
      const clamped = clampPosition(
        coords.x - pointerDrag.offsetX,
        coords.y - pointerDrag.offsetY,
        itemDef
      );
      placed.x = clamped.x;
      placed.y = clamped.y;
      pointerDrag.moved = true;
      updatePlacedElement(placed);

      const check = canPlaceAt(clamped.x, clamped.y, itemDef, pointerDrag.instanceId);
      board.classList.toggle("drag-invalid", !check.ok);
    }
  }

  function onPointerUp(e) {
    if (!pointerDrag) return;

    const coords = getBoardCoords(e.clientX, e.clientY);
    board.classList.remove("drag-over", "drag-invalid");

    if (pointerDrag.type === "palette" && coords.inside) {
      placeItemAt(pointerDrag.itemId, coords.x, coords.y);
    } else if (pointerDrag.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === pointerDrag.instanceId);
      if (placed) {
        const itemDef = getItemDef(placed.itemId);
        const snapped = snapToGrid(placed.x, placed.y, itemDef.width, itemDef.height);
        placed.x = snapped.x;
        placed.y = snapped.y;
        const check = canPlaceAt(placed.x, placed.y, itemDef, pointerDrag.instanceId);
        if (!check.ok) {
          placed.x = pointerDrag.startX;
          placed.y = pointerDrag.startY;
          showToast(check.reason, true);
        }
        const el = board.querySelector(`[data-instance-id="${pointerDrag.instanceId}"]`);
        if (el) {
          el.classList.remove("dragging");
          el.style.zIndex = "";
          if (pointerDrag.moved) el.dataset.dragMoved = "1";
        }
        renderPlacedItems();
        updateStatus();
      }
    }

    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
    pointerDrag = null;
  }

  function bindPointerDrag() {
    document.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseup", onPointerUp);
  }

  function bindEvents() {
    bgSelect.addEventListener("change", (e) => selectBackground(e.target.value));

    $("#save-config").addEventListener("click", () => {
      applyConfigFromInputs();
      saveConfig();
    });

    $("#apply-config").addEventListener("click", () => {
      applyConfigFromInputs();
      showToast("尺寸已套用");
    });

    $("#save-image").addEventListener("click", () => {
      exportBoardImage();
    });

    $("#clear-board").addEventListener("click", () => {
      placedItems = [];
      selectedPlacedId = null;
      renderPlacedItems();
      updateStatus();
      updatePaletteState();
      showToast("底板已清空");
    });

    board.addEventListener("dragover", onBoardDragOver);
    board.addEventListener("dragleave", onBoardDragLeave);
    board.addEventListener("drop", onBoardDrop);

    window.addEventListener("resize", () => {
      resizeBoard();
      renderPlacedItems();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Delete" && selectedPlacedId) {
        removePlaced(selectedPlacedId);
      }
    });
  }

  init();
})();
