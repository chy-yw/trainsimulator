(function () {
  "use strict";

  let config = { backgrounds: [], items: [] };
  let currentBgId = null;
  let placedItems = [];
  let selectedPlacedId = null;
  let dragState = null;
  let scale = 1;
  let exportInProgress = false;
  let dataSource = "error";
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
    const loaded = await loadConfig();
    updateDataSourceBadge();

    if (!loaded) {
      showLoadError();
      bindEvents();
      return;
    }

    buildBgSelect();
    buildBgConfig();
    buildItemsConfig();
    selectBackground(config.backgrounds[0]?.id);
    buildPalette();
    bindEvents();
    bindPointerDrag();
  }

  function updateDataSourceBadge() {
    const el = $("#data-source-badge");
    if (!el) return;

    if (dataSource === "firebase") {
      el.textContent = "資料來源：Firebase 雲端";
      el.dataset.source = "firebase";
      el.hidden = false;
      return;
    }

    el.textContent = "無法載入雲端資料";
    el.dataset.source = "error";
    el.hidden = false;
  }

  function showLoadError() {
    bgConfig.innerHTML =
      '<p class="hint" style="color:var(--danger)">無法從 Firebase 載入設定。請確認網路連線，或請管理員至後台發布資料。</p>';
    itemsConfig.innerHTML = "";
    statusCard.className = "status-card error";
    statusCard.innerHTML =
      '<div class="status-title">✗ 雲端資料載入失敗</div><div class="hint">請稍後重新整理，或聯絡管理員。</div>';
    showToast("無法載入雲端資料", true);
  }

  async function loadConfig() {
    if (!window.TrainModelFirebase?.isConfigured()) {
      dataSource = "error";
      return false;
    }

    try {
      const cloudConfig = await TrainModelFirebase.getConfig();
      if (!cloudConfig?.backgrounds?.length && !cloudConfig?.items?.length) {
        dataSource = "error";
        return false;
      }

      config = cloudConfig;
      dataSource = "firebase";
      const urls = await TrainModelFirebase.loadImageUrlsForConfig(config);
      urls.forEach((url, path) => adminImageUrls.set(path, url));
      return true;
    } catch {
      dataSource = "error";
      return false;
    }
  }

  function getCurrentBg() {
    return config.backgrounds.find((b) => b.id === currentBgId);
  }

  function getItemDef(itemId) {
    return config.items.find((i) => i.id === itemId);
  }

  function canUserEditDims(entry) {
    return entry?.userCanEditDims !== false;
  }

  function buildBgSelect() {
    bgSelect.innerHTML = config.backgrounds
      .map((bg) => `<option value="${bg.id}">${bg.name}</option>`)
      .join("");
  }

  function buildDimFields(entry, widthAttr, heightAttr) {
    if (canUserEditDims(entry)) {
      return `
        <div class="dim-row">
          <div class="field">
            <label>寬度 (mm)</label>
            <input type="number" min="1" ${widthAttr} value="${entry.width}">
          </div>
          <div class="field">
            <label>高度 (mm)</label>
            <input type="number" min="1" ${heightAttr} value="${entry.height}">
          </div>
        </div>
      `;
    }

    return `
      <div class="dim-row dim-row-locked">
        <div class="field">
          <label>寬度 (mm)</label>
          <span class="dim-readonly">${entry.width}</span>
        </div>
        <div class="field">
          <label>高度 (mm)</label>
          <span class="dim-readonly">${entry.height}</span>
        </div>
      </div>
      <p class="dim-lock-hint">尺寸由管理員鎖定</p>
    `;
  }

  function buildBgConfig() {
    bgConfig.innerHTML = "";
    config.backgrounds.forEach((bg) => {
      const card = document.createElement("div");
      card.className = `config-card${canUserEditDims(bg) ? "" : " config-card-locked"}`;
      card.dataset.bgId = bg.id;
      card.innerHTML = `
        <div class="card-title">
          <img src="${assetUrl(bg.file)}" alt="">
          <span>${bg.name}</span>
        </div>
        ${buildDimFields(bg, `data-bg-width="${bg.id}"`, `data-bg-height="${bg.id}"`)}
      `;
      bgConfig.appendChild(card);
    });
  }

  function buildItemsConfig() {
    itemsConfig.innerHTML = "";
    config.items.forEach((item) => {
      const card = document.createElement("div");
      card.className = `config-card${canUserEditDims(item) ? "" : " config-card-locked"}`;
      card.innerHTML = `
        <div class="card-title">
          <img src="${assetUrl(item.file)}" alt="">
          <span>${item.name}</span>
        </div>
        ${buildDimFields(item, `data-item-width="${item.id}"`, `data-item-height="${item.id}"`)}
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

  function getPlacementBounds(excludePlacedId = null) {
    const rects = getPlacedRects(excludePlacedId);
    if (!rects.length) {
      return { width: 0, height: 0, count: 0, area: 0 };
    }

    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));
    const area = rects.reduce((sum, r) => sum + r.width * r.height, 0);

    return {
      width: maxX - minX,
      height: maxY - minY,
      count: rects.length,
      area,
    };
  }

  function findNextGridSlot(itemDef, excludePlacedId = null) {
    const bg = getCurrentBg();
    if (!bg) return null;

    const cell = getGridCell();
    const maxY = bg.height - itemDef.height;
    const maxX = bg.width - itemDef.width;

    for (let y = 0; y <= maxY; y += cell) {
      for (let x = 0; x <= maxX; x += cell) {
        const check = canPlaceAt(x, y, itemDef, excludePlacedId);
        if (check.ok) return { x, y };
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

  function canPlaceAt(x, y, itemDef, excludePlacedId = null) {
    const bg = getCurrentBg();
    const w = itemDef.width;
    const h = itemDef.height;

    if (x < 0 || y < 0 || x + w > bg.width || y + h > bg.height) {
      return {
        ok: false,
        reason: "組件超出背景邊界，無法貼上",
      };
    }

    if (overlapsAnyPlaced(x, y, itemDef, excludePlacedId)) {
      return {
        ok: false,
        reason: "組件不能重疊在其他組件上",
      };
    }

    return { ok: true };
  }

  function hasNoAvailableSlot(itemDef, excludePlacedId = null) {
    if (!itemDef) return false;
    return findNextGridSlot(itemDef, excludePlacedId) === null;
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

    if (hasNoAvailableSlot(itemDef)) {
      showToast("無法添加：背景上已無可放置的空位", true);
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

    if (hasNoAvailableSlot(itemDef)) {
      e.preventDefault();
      showToast("無法添加：背景上已無可放置的空位", true);
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
    const bounds = getPlacementBounds();
    const boardArea = bg.width * bg.height;
    const areaPct = bounds.area ? Math.min(100, (bounds.area / boardArea) * 100) : 0;

    statusCard.className = "status-card ok";

    if (!bounds.count) {
      statusCard.innerHTML = `
        <div class="status-title">尚未貼上組件</div>
        <div class="hint">背景尺寸 ${bg.width} × ${bg.height} mm。只要位置在背景內且不重疊，即可自由放置組件。</div>
      `;
      return;
    }

    statusCard.innerHTML = `
      <div class="status-title">✓ 可自由排版</div>
      <div class="meter">
        <div class="meter-label">
          <span>排版外框寬度</span>
          <span>${bounds.width} / ${bg.width} mm</span>
        </div>
        <div class="meter-bar">
          <div class="meter-fill ok" style="width:${Math.min(100, (bounds.width / bg.width) * 100)}%"></div>
        </div>
      </div>
      <div class="meter">
        <div class="meter-label">
          <span>排版外框高度</span>
          <span>${bounds.height} / ${bg.height} mm</span>
        </div>
        <div class="meter-bar">
          <div class="meter-fill ok" style="width:${Math.min(100, (bounds.height / bg.height) * 100)}%"></div>
        </div>
      </div>
      <div class="hint">已貼上 ${bounds.count} 個組件，組件總面積約佔背景 ${areaPct.toFixed(1)}%。僅在超出邊界或重疊時無法放置。</div>
    `;
  }

  function updatePaletteState() {
    $$(".palette-item").forEach((el) => {
      const itemId = el.dataset.itemId;
      const itemDef = getItemDef(itemId);
      const disabled = hasNoAvailableSlot(itemDef);
      el.classList.toggle("disabled", disabled);
      const dims = el.querySelector(".dims");
      if (dims) {
        dims.textContent = disabled
          ? `${itemDef.width} × ${itemDef.height} mm — 無可用空位`
          : `${itemDef.width} × ${itemDef.height} mm`;
      }
    });
  }

  function applyConfigFromInputs() {
    config.backgrounds.forEach((bg) => {
      if (!canUserEditDims(bg)) return;
      const wInput = document.querySelector(`[data-bg-width="${bg.id}"]`);
      const hInput = document.querySelector(`[data-bg-height="${bg.id}"]`);
      if (wInput) bg.width = Math.max(1, parseInt(wInput.value, 10) || bg.width);
      if (hInput) bg.height = Math.max(1, parseInt(hInput.value, 10) || bg.height);
    });

    config.items.forEach((item) => {
      if (!canUserEditDims(item)) return;
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
    if (!itemDef || hasNoAvailableSlot(itemDef)) return;

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

    $("#apply-config")?.addEventListener("click", () => {
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
      showToast("背景已清空");
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
