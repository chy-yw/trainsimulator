(function () {
  "use strict";

  let config = { backgrounds: [], items: [] };
  let currentBgId = null;
  let placedItems = [];
  let selectedPlacedId = null;
  let paletteRotation = 0;
  let dragState = null;
  let scale = 1;
  let exportInProgress = false;
  const exportImageCache = new Map();
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
    bindBoardResize();
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
      return false;
    }

    try {
      const cloudConfig = await TrainModelFirebase.getConfig();
      if (!cloudConfig?.backgrounds?.length && !cloudConfig?.items?.length) {
        return false;
      }

      config = cloudConfig;
      const urls = await TrainModelFirebase.loadImageUrlsForConfig(config);
      urls.forEach((url, path) => adminImageUrls.set(path, url));
      return true;
    } catch (err) {
      console.error("Firebase load failed:", err);
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

  const ROTATION_ANGLES = [0, 90, 180, 270];

  function normalizeRotation(rotation) {
    const value = Number(rotation) || 0;
    return ROTATION_ANGLES.includes(value) ? value : 0;
  }

  function nextRotation(rotation) {
    const rot = normalizeRotation(rotation);
    const idx = ROTATION_ANGLES.indexOf(rot);
    return ROTATION_ANGLES[(idx + 1) % ROTATION_ANGLES.length];
  }

  function getItemDims(itemDef, rotation = 0) {
    const rot = normalizeRotation(rotation);
    if (rot === 90 || rot === 270) {
      return { width: itemDef.height, height: itemDef.width };
    }
    return { width: itemDef.width, height: itemDef.height };
  }

  function rotationLabel(rotation) {
    const rot = normalizeRotation(rotation);
    return rot === 0 ? "" : ` ${rot}°`;
  }

  function getPlacedDims(placed) {
    const def = getItemDef(placed.itemId);
    if (!def) return { width: 0, height: 0 };
    return getItemDims(def, placed.rotation);
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
      el.dataset.itemId = item.id;
      el.innerHTML = `
        <img src="${assetUrl(item.file)}" alt="${item.name}" draggable="false">
        <div class="info">
          <div class="name">${item.name}</div>
          <div class="dims">${item.width} × ${item.height} mm</div>
        </div>
      `;
      el.addEventListener("pointerdown", onPalettePointerDown);
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

  function syncScaleFromBoard() {
    const bg = getCurrentBg();
    if (!bg || !board) return;
    const w = board.getBoundingClientRect().width;
    if (w > 0) scale = w / bg.width;
  }

  function resizeBoard() {
    const bg = getCurrentBg();
    const viewport = $(".viewport");
    if (!bg || !viewport) return;

    const padX = 32;
    const padY = 40;
    const availW = Math.max(280, viewport.clientWidth - padX);
    const availH = Math.max(220, viewport.clientHeight - padY);
    const aspect = bg.width / bg.height;

    let displayW = availW;
    let displayH = displayW / aspect;

    if (displayH > availH) {
      displayH = availH;
      displayW = displayH * aspect;
    }

    board.style.width = `${displayW}px`;
    board.style.height = `${displayH}px`;
    syncScaleFromBoard();
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
        const dims = getPlacedDims(p);
        return { x: p.x, y: p.y, width: dims.width, height: dims.height };
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

  function findNextGridSlot(itemDef, excludePlacedId = null, rotation = 0) {
    const bg = getCurrentBg();
    if (!bg) return null;

    const dims = getItemDims(itemDef, rotation);
    const cell = getGridCell();
    const maxY = bg.height - dims.height;
    const maxX = bg.width - dims.width;

    for (let y = 0; y <= maxY; y += cell) {
      for (let x = 0; x <= maxX; x += cell) {
        const check = canPlaceAt(x, y, itemDef, excludePlacedId, rotation);
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

  function overlapsAnyPlaced(x, y, itemDef, excludePlacedId = null, rotation = 0) {
    const dims = getItemDims(itemDef, rotation);
    return placedItems.some((placed) => {
      if (placed.instanceId === excludePlacedId) return false;
      const otherDims = getPlacedDims(placed);
      return rectanglesOverlap(
        x,
        y,
        dims.width,
        dims.height,
        placed.x,
        placed.y,
        otherDims.width,
        otherDims.height
      );
    });
  }

  function canPlaceAt(x, y, itemDef, excludePlacedId = null, rotation = 0) {
    const bg = getCurrentBg();
    const { width: w, height: h } = getItemDims(itemDef, rotation);

    if (x < 0 || y < 0 || x + w > bg.width || y + h > bg.height) {
      return {
        ok: false,
        reason: "組件超出背景邊界，無法貼上",
      };
    }

    if (overlapsAnyPlaced(x, y, itemDef, excludePlacedId, rotation)) {
      return {
        ok: false,
        reason: "組件不能重疊在其他組件上",
      };
    }

    return { ok: true };
  }

  function hasNoAvailableSlot(itemDef, excludePlacedId = null) {
    if (!itemDef) return false;
    return ROTATION_ANGLES.every(
      (rot) => findNextGridSlot(itemDef, excludePlacedId, rot) === null
    );
  }

  function clampPosition(x, y, itemDef, rotation = 0) {
    const bg = getCurrentBg();
    const { width, height } = getItemDims(itemDef, rotation);
    const maxX = Math.max(0, bg.width - width);
    const maxY = Math.max(0, bg.height - height);
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    };
  }

  function placeItemAt(itemId, modelX, modelY, rotation = paletteRotation) {
    const itemDef = getItemDef(itemId);
    if (!itemDef) return false;
    const rot = normalizeRotation(rotation);
    const dims = getItemDims(itemDef, rot);

    if (hasNoAvailableSlot(itemDef)) {
      showToast("無法添加：背景上已無可放置的空位", true);
      return false;
    }

    let pos = clampPosition(
      modelX - dims.width / 2,
      modelY - dims.height / 2,
      itemDef,
      rot
    );
    pos = snapToGrid(pos.x, pos.y, dims.width, dims.height);

    let check = canPlaceAt(pos.x, pos.y, itemDef, null, rot);
    if (!check.ok) {
      const slot = findNextGridSlot(itemDef, null, rot);
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
      rotation: rot,
    });
    renderPlacedItems();
    updateStatus();
    updatePaletteState();
    showToast(`${itemDef.name} 已貼上`);
    return true;
  }

  async function loadImageFromBlob(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob);
    }

    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to decode image blob"));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function exportImageApiUrl(filePath, src) {
    if (src) {
      return `/api/image?url=${encodeURIComponent(src)}`;
    }
    return `/api/image?path=${encodeURIComponent(filePath)}`;
  }

  async function loadExportImage(filePath, src) {
    const cacheKey = filePath || src;
    if (exportImageCache.has(cacheKey)) return exportImageCache.get(cacheKey);

    const promise = (async () => {
      if (filePath || src) {
        try {
          const proxyRes = await fetch(exportImageApiUrl(filePath, src));
          if (proxyRes.ok) return loadImageFromBlob(await proxyRes.blob());
        } catch (err) {
          console.warn("Export proxy load failed:", filePath || src, err);
        }
      }

      if (filePath && window.TrainModelFirebase?.isConfigured()) {
        try {
          const blob = await TrainModelFirebase.getImageBlob(filePath);
          if (blob) return loadImageFromBlob(blob);
        } catch (err) {
          console.warn("Firebase blob export load failed:", filePath, err);
        }
      }

      if (src) {
        try {
          const res = await fetch(src, { mode: "cors", credentials: "omit" });
          if (res.ok) return loadImageFromBlob(await res.blob());
        } catch {
          /* fall through */
        }
      }

      throw new Error(`Unable to load export image: ${filePath || src}`);
    })();

    exportImageCache.set(cacheKey, promise);
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

      const bgImg = await loadExportImage(bg.file, assetUrl(bg.file));
      ctx.drawImage(bgImg, 0, 0, bg.width, bg.height);

      for (const placed of placedItems) {
        const def = getItemDef(placed.itemId);
        const dims = getPlacedDims(placed);
        const itemImg = await loadExportImage(def.file, assetUrl(def.file));
        const rot = normalizeRotation(placed.rotation);
        if (rot !== 0) {
          ctx.save();
          ctx.translate(placed.x + dims.width / 2, placed.y + dims.height / 2);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.drawImage(itemImg, -def.width / 2, -def.height / 2, def.width, def.height);
          ctx.restore();
        } else {
          ctx.drawImage(itemImg, placed.x, placed.y, def.width, def.height);
        }
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
    } catch (err) {
      console.error("Export failed:", err);
      if (!silent) {
        showToast("無法儲存圖片，請稍後再試或聯絡管理員", true);
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

    dragState = { type: "palette", itemId, rotation: paletteRotation };
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
      const dims = getItemDims(itemDef, dragState.rotation);
      check = canPlaceAt(
        modelX - dims.width / 2,
        modelY - dims.height / 2,
        itemDef,
        null,
        dragState.rotation
      );
    } else if (dragState.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === dragState.instanceId);
      const itemDef = getItemDef(placed.itemId);
      const dims = getPlacedDims(placed);
      check = canPlaceAt(
        modelX - dims.width / 2,
        modelY - dims.height / 2,
        itemDef,
        dragState.instanceId,
        placed.rotation
      );
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
      placeItemAt(dragState.itemId, modelX, modelY, dragState.rotation);
    } else if (dragState?.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === dragState.instanceId);
      const itemDef = getItemDef(placed.itemId);
      const dims = getPlacedDims(placed);
      let pos = clampPosition(
        modelX - dims.width / 2,
        modelY - dims.height / 2,
        itemDef,
        placed.rotation
      );
      pos = snapToGrid(pos.x, pos.y, dims.width, dims.height);
      const check = canPlaceAt(pos.x, pos.y, itemDef, dragState.instanceId, placed.rotation);
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

  function getItemUiScale(displayW, displayH) {
    const base = Math.min(displayW, displayH);
    return Math.max(7, Math.min(28, base * 0.13));
  }

  function applyItemUiScale(el, displayW, displayH) {
    const labelSize = getItemUiScale(displayW, displayH);
    el.style.setProperty("--label-size", `${labelSize}px`);
    el.style.setProperty("--control-size", `${Math.max(18, Math.min(34, labelSize * 1.75))}px`);
  }

  function buildPlacedItemMarkup(placed, itemDef) {
    const rot = normalizeRotation(placed.rotation);
    const eff = getItemDims(itemDef, rot);
    const rotClass = rot !== 0 ? " is-angled" : "";
    const innerStyle =
      rot !== 0
        ? ` style="width:${modelToDisplay(itemDef.width)}px;height:${modelToDisplay(itemDef.height)}px;--item-rotation:${rot}deg"`
        : "";
    const dimText = `${eff.width}×${eff.height}${rotationLabel(rot)}`;

    return `
      <div class="placed-item-inner${rotClass}"${innerStyle}>
        <img src="${assetUrl(itemDef.file)}" alt="${itemDef.name}" draggable="false">
      </div>
      <span class="dim-label">${dimText}</span>
      <button class="rotate-btn" type="button" title="旋轉 90°（0→90→180→270）">↻</button>
      <button class="remove-btn" type="button" title="移除">×</button>
    `;
  }

  function renderPlacedItems() {
    board.querySelectorAll(".placed-item").forEach((el) => el.remove());

    placedItems.forEach((placed) => {
      const itemDef = getItemDef(placed.itemId);
      const eff = getPlacedDims(placed);
      const el = document.createElement("div");
      el.className = "placed-item";
      if (placed.instanceId === selectedPlacedId) el.classList.add("selected");
      if (normalizeRotation(placed.rotation) !== 0) el.classList.add("is-rotated");
      el.dataset.instanceId = placed.instanceId;
      el.style.left = `${modelToDisplay(placed.x)}px`;
      el.style.top = `${modelToDisplay(placed.y)}px`;
      el.style.width = `${modelToDisplay(eff.width)}px`;
      el.style.height = `${modelToDisplay(eff.height)}px`;
      applyItemUiScale(el, modelToDisplay(eff.width), modelToDisplay(eff.height));

      el.innerHTML = buildPlacedItemMarkup(placed, itemDef);

      el.addEventListener("pointerdown", (e) => onPlacedPointerDown(e, placed.instanceId));
      el.addEventListener("click", (e) => {
        if (
          e.target.classList.contains("remove-btn") ||
          e.target.classList.contains("rotate-btn")
        ) {
          return;
        }
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
      el.querySelector(".rotate-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        selectedPlacedId = placed.instanceId;
        rotatePlaced(placed.instanceId);
      });

      board.appendChild(el);
    });

    renderPlacedList();
  }

  function rotatePlaced(instanceId) {
    const placed = placedItems.find((p) => p.instanceId === instanceId);
    if (!placed) return;

    const itemDef = getItemDef(placed.itemId);
    const newRotation = nextRotation(placed.rotation);
    const check = canPlaceAt(placed.x, placed.y, itemDef, instanceId, newRotation);
    if (!check.ok) {
      showToast(check.reason, true);
      return;
    }

    placed.rotation = newRotation;
    renderPlacedItems();
    updateStatus();
    updatePaletteState();
    showToast(
      newRotation === 0 ? "已恢復 0°（正常方向）" : `已旋轉至 ${newRotation}°`
    );
  }

  function togglePaletteRotation() {
    paletteRotation = nextRotation(paletteRotation);
    updatePaletteState();
    showToast(
      paletteRotation === 0
        ? "下次放置：0°（正常方向）"
        : `下次放置：${paletteRotation}°`
    );
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
        const eff = getPlacedDims(p);
        return `<li>
          <span>${def.name}</span>
          <span>${eff.width}×${eff.height}${rotationLabel(p.rotation)}</span>
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
        const size = `${itemDef.width} × ${itemDef.height} mm`;
        const rot = rotationLabel(paletteRotation);
        dims.textContent = disabled
          ? `${size}${rot} — 無可用空位`
          : `${size}${rot}`;
      }
      el.classList.toggle("palette-rotated", paletteRotation !== 0);
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

  function isLeftPointer(e) {
    return e.pointerType !== "mouse" || e.button === 0;
  }

  function capturePointer(e, el) {
    if (el?.setPointerCapture) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function releasePointer(e, el) {
    if (el?.releasePointerCapture) {
      try {
        if (!el.hasPointerCapture || el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }
    }
  }

  function onPalettePointerDown(e) {
    if (!isLeftPointer(e) || e.isPrimary === false) return;
    const el = e.currentTarget;
    if (el.classList.contains("disabled")) return;

    const itemId = el.dataset.itemId;
    const itemDef = getItemDef(itemId);
    if (!itemDef || hasNoAvailableSlot(itemDef)) return;

    e.preventDefault();
    capturePointer(e, el);
    pointerDrag = {
      type: "palette",
      itemId,
      rotation: paletteRotation,
      pointerId: e.pointerId,
      captureEl: el,
    };

    const ghostDims = getItemDims(itemDef, paletteRotation);
    dragGhost = document.createElement("div");
    dragGhost.className = `drag-ghost${paletteRotation !== 0 ? " drag-ghost-rotated" : ""}`;
    const ghostRotate =
      paletteRotation !== 0 ? ` style="transform:rotate(${paletteRotation}deg)"` : "";
    dragGhost.innerHTML = `<img src="${assetUrl(itemDef.file)}" alt="" draggable="false"${ghostRotate}>`;
    dragGhost.style.width = `${Math.min(modelToDisplay(ghostDims.width), 120)}px`;
    dragGhost.style.height = `${Math.min(modelToDisplay(ghostDims.height), 120)}px`;
    document.body.appendChild(dragGhost);
    moveDragGhost(e.clientX, e.clientY);
  }

  function onPlacedPointerDown(e, instanceId) {
    if (!isLeftPointer(e) || e.isPrimary === false) return;
    if (e.target.classList.contains("remove-btn") || e.target.classList.contains("rotate-btn")) {
      return;
    }

    const placed = placedItems.find((p) => p.instanceId === instanceId);
    if (!placed) return;

    const itemDef = getItemDef(placed.itemId);
    const coords = getBoardCoords(e.clientX, e.clientY);
    const el = e.currentTarget;

    e.preventDefault();
    e.stopPropagation();
    capturePointer(e, el);

    selectedPlacedId = instanceId;
    pointerDrag = {
      type: "placed",
      instanceId,
      offsetX: coords.x - placed.x,
      offsetY: coords.y - placed.y,
      startX: placed.x,
      startY: placed.y,
      moved: false,
      pointerId: e.pointerId,
      captureEl: el,
    };

    el.classList.add("dragging");
    el.style.zIndex = "30";
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
    syncScaleFromBoard();
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
    if (e.pointerId !== pointerDrag.pointerId) return;
    e.preventDefault();
    moveDragGhost(e.clientX, e.clientY);

    const coords = getBoardCoords(e.clientX, e.clientY);
    board.classList.add("drag-over");
    if (pointerDrag.type === "palette") {
      const itemDef = getItemDef(pointerDrag.itemId);
      const dims = getItemDims(itemDef, pointerDrag.rotation);
      const centered = clampPosition(
        coords.x - dims.width / 2,
        coords.y - dims.height / 2,
        itemDef,
        pointerDrag.rotation
      );
      const check = canPlaceAt(centered.x, centered.y, itemDef, null, pointerDrag.rotation);
      board.classList.toggle("drag-invalid", !check.ok);
    } else if (pointerDrag.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === pointerDrag.instanceId);
      if (!placed) return;

      const itemDef = getItemDef(placed.itemId);
      const clamped = clampPosition(
        coords.x - pointerDrag.offsetX,
        coords.y - pointerDrag.offsetY,
        itemDef,
        placed.rotation
      );
      placed.x = clamped.x;
      placed.y = clamped.y;
      pointerDrag.moved = true;
      updatePlacedElement(placed);

      const check = canPlaceAt(
        clamped.x,
        clamped.y,
        itemDef,
        pointerDrag.instanceId,
        placed.rotation
      );
      board.classList.toggle("drag-invalid", !check.ok);
    }
  }

  function onPointerUp(e) {
    if (!pointerDrag) return;
    if (e.pointerId !== pointerDrag.pointerId) return;

    const coords = getBoardCoords(e.clientX, e.clientY);
    board.classList.remove("drag-over", "drag-invalid");

    if (pointerDrag.type === "palette" && coords.inside) {
      placeItemAt(pointerDrag.itemId, coords.x, coords.y, pointerDrag.rotation);
    } else if (pointerDrag.type === "placed") {
      const placed = placedItems.find((p) => p.instanceId === pointerDrag.instanceId);
      if (placed) {
        const itemDef = getItemDef(placed.itemId);
        const dims = getPlacedDims(placed);
        const snapped = snapToGrid(placed.x, placed.y, dims.width, dims.height);
        placed.x = snapped.x;
        placed.y = snapped.y;
        const check = canPlaceAt(
          placed.x,
          placed.y,
          itemDef,
          pointerDrag.instanceId,
          placed.rotation
        );
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

    releasePointer(e, pointerDrag.captureEl);
    pointerDrag = null;
  }

  function bindPointerDrag() {
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  }

  function bindBoardResize() {
    const viewport = $(".viewport");
    if (!viewport) return;

    const onLayoutChange = () => {
      resizeBoard();
      renderPlacedItems();
    };

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(onLayoutChange).observe(viewport);
    }

    window.addEventListener("orientationchange", () => {
      setTimeout(onLayoutChange, 150);
    });
  }

  function bindEvents() {
    bgSelect.addEventListener("change", (e) => selectBackground(e.target.value));

    $("#apply-config")?.addEventListener("click", () => {
      applyConfigFromInputs();
      showToast("尺寸已套用（僅本次瀏覽有效，不會上傳雲端）");
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

    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select")) return;

      if (e.key === "Delete" && selectedPlacedId) {
        removePlaced(selectedPlacedId);
        return;
      }

      if (e.key === "r" || e.key === "R") {
        if (selectedPlacedId) {
          rotatePlaced(selectedPlacedId);
        } else {
          togglePaletteRotation();
        }
      }
    });
  }

  init();
})();
