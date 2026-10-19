/* Floor inventory scanner. Catalog is embedded; counts stay in localStorage. */
(function () {
  const L = globalThis.FloorLogic;
  const CATALOG = globalThis.FLOOR_CATALOG;
  const STORAGE_KEY = "floor-inventory-scanner-v1";
  const LIST_CAP = 200;

  const scanForm = document.querySelector("#scan-form");
  const scanInput = document.querySelector("#scan");
  const banner = document.querySelector("#asis-banner");
  const zoneChips = document.querySelector("#zone-chips");
  const zoneCreate = document.querySelector("#zone-create");
  const zoneNameInput = document.querySelector("#zone-name");
  const currentZoneEl = document.querySelector("#current-zone");
  const matchEl = document.querySelector("#match");
  const liveEl = document.querySelector("#live");
  const countBody = document.querySelector("#count-body");
  const catalogBody = document.querySelector("#catalog-body");
  const countEmpty = document.querySelector("#count-empty");
  const catalogEmpty = document.querySelector("#catalog-empty");
  const listNote = document.querySelector("#list-note");
  const searchInput = document.querySelector("#search");
  const countView = document.querySelector("#count-view");
  const catalogView = document.querySelector("#catalog-view");
  const sortBar = document.querySelector("#sort-bar");
  const filterBar = document.querySelector("#filter-bar");
  const addDialog = document.querySelector("#add-dialog");
  const addForm = document.querySelector("#add-form");
  const addGroup = document.querySelector("#add-group");
  const addDescription = document.querySelector("#add-description");
  const addSku = document.querySelector("#add-sku");
  const addZone = document.querySelector("#add-zone");
  const addAsIsNote = document.querySelector("#add-asis-note");
  const addError = document.querySelector("#add-error");
  const catalogStats = document.querySelector("#catalog-stats");
  const zoneSummary = document.querySelector("#zone-summary");

  const state = loadState();
  let bySku = new Map();
  let sortMode = "paired";
  let catalogFilter = "all";
  let view = "count";
  let lastMatch = null;

  rebuildIndex();
  zoneCreate.hidden = state.zones.length > 0;
  bind();
  render();
  if (state.zones.length === 0) {
    zoneNameInput.focus();
  } else {
    focusScan();
  }

  function emptyState() {
    return {
      zones: [],
      currentZoneId: null,
      counts: {},
      added: [],
      asIsArmed: false,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.zones) || typeof data.counts !== "object" || data.counts === null) {
        return emptyState();
      }
      data.added = Array.isArray(data.added) ? data.added : [];
      data.asIsArmed = Boolean(data.asIsArmed);
      if (!data.zones.some((zone) => zone.id === data.currentZoneId)) {
        data.currentZoneId = data.zones[0] ? data.zones[0].id : null;
      }
      return data;
    } catch {
      return emptyState();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function rebuildIndex() {
    bySku = new Map();
    for (const item of CATALOG.items) bySku.set(item.sku, item);
    for (const item of state.added) {
      if (!bySku.has(item.sku)) bySku.set(item.sku, item);
    }
  }

  function currentZone() {
    return state.zones.find((zone) => zone.id === state.currentZoneId) || null;
  }

  function bind() {
    scanForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = scanInput.value;
      scanInput.value = "";
      handleScan(raw);
    });

    document.querySelector("#cancel-asis").addEventListener("click", () => {
      state.asIsArmed = false;
      save();
      say("AS IS cancelled. The next scan counts as new.");
      renderBanner();
      focusScan();
    });

    document.querySelector("#new-zone").addEventListener("click", () => {
      zoneCreate.hidden = false;
      zoneNameInput.focus();
      zoneNameInput.select();
    });

    document.querySelector("#zone-form").addEventListener("submit", (event) => {
      event.preventDefault();
      createZone(zoneNameInput.value);
    });

    document.querySelector("#export").addEventListener("click", exportCsv);

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        view = button.getAttribute("data-view");
        renderViews();
        renderActiveList();
        focusScan();
      });
    });

    document.querySelectorAll("[data-sort]").forEach((button) => {
      button.addEventListener("click", () => {
        sortMode = button.getAttribute("data-sort");
        renderSort();
        renderCount();
        focusScan();
      });
    });

    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        catalogFilter = button.getAttribute("data-filter");
        renderFilters();
        renderCatalog();
        focusScan();
      });
    });

    searchInput.addEventListener("input", () => {
      renderActiveList();
    });

    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const raw = searchInput.value.trim();
      if (!raw || /[a-z]/i.test(raw)) return;
      const sku = L.digitsOnly(raw);
      if (!sku) return;
      event.preventDefault();
      searchInput.value = "";
      searchInput.blur();
      renderActiveList();
      handleScan(sku);
    });

    countBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-step]");
      if (!button) return;
      const row = button.closest("tr");
      const sku = row.getAttribute("data-sku");
      const condition = row.getAttribute("data-condition");
      const delta = Number(button.getAttribute("data-step"));
      adjust(sku, condition === "asis", delta);
    });

    addForm.addEventListener("submit", (event) => {
      event.preventDefault();
      commitAdd();
    });

    document.querySelector("#add-cancel").addEventListener("click", () => {
      closeAdd(false);
    });

    addDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeAdd(false);
    });

    addDialog.addEventListener("close", () => {
      focusScan();
    });

    document.addEventListener("keydown", (event) => {
      if (addDialog.open) return;
      const target = event.target;
      if (target && target.closest("[data-keep-focus]")) return;
      if (event.key.length !== 1) return;
      if (target === scanInput) return;
      scanInput.focus({ preventScroll: true });
      scanInput.value += event.key;
      event.preventDefault();
    });

    document.addEventListener("pointerup", (event) => {
      if (addDialog.open) return;
      if (event.target.closest("[data-keep-focus], button, a, select, label")) return;
      focusScan();
    });
  }

  function handleScan(raw) {
    const zone = currentZone();
    if (!zone) {
      say("Create a zone first, then scan.");
      zoneCreate.hidden = false;
      zoneNameInput.focus();
      return;
    }
    const sku = L.digitsOnly(raw);
    if (!sku) {
      say("Enter a numeric SKU.");
      focusScan();
      return;
    }
    if (L.isAsIsPrefix(sku)) {
      state.asIsArmed = true;
      save();
      say("Next scan is AS IS.");
      renderBanner();
      focusScan();
      return;
    }
    const item = bySku.get(sku);
    if (!item) {
      openAdd(sku);
      return;
    }
    const asIs = state.asIsArmed;
    state.asIsArmed = false;
    bump(zone.id, sku, asIs, 1);
    save();
    remember(item, zone, asIs);
    renderAfterCount(sku, asIs);
    focusScan();
  }

  function bump(zoneId, sku, asIs, delta) {
    if (!state.counts[zoneId]) state.counts[zoneId] = {};
    const bucket = state.counts[zoneId];
    if (!bucket[sku]) bucket[sku] = { new: 0, asIs: 0 };
    const key = asIs ? "asIs" : "new";
    bucket[sku][key] = Math.max(0, (Number(bucket[sku][key]) || 0) + delta);
    if (bucket[sku].new === 0 && bucket[sku].asIs === 0) delete bucket[sku];
  }

  function adjust(sku, asIs, delta) {
    const zone = currentZone();
    if (!zone) return;
    bump(zone.id, sku, asIs, delta);
    save();
    const item = bySku.get(sku);
    if (item) {
      const qty = L.zoneQty(state.counts, zone.id, sku);
      const left = asIs ? qty.asIsQty : qty.newQty;
      lastMatch = {
        sku,
        zoneId: zone.id,
        zoneName: zone.name,
        asIs,
        groupName: item.groupName,
        description: item.description,
        sheetAsIs: Boolean(item.asIs),
        originalSku: item.originalSku || "",
        qty: left,
      };
    }
    renderAfterCount(sku, asIs);
    focusScan();
  }

  function remember(item, zone, asIs) {
    const qty = L.zoneQty(state.counts, zone.id, item.sku);
    lastMatch = {
      sku: item.sku,
      zoneId: zone.id,
      zoneName: zone.name,
      asIs,
      groupName: item.groupName,
      description: item.description,
      sheetAsIs: Boolean(item.asIs),
      originalSku: item.originalSku || "",
      qty: asIs ? qty.asIsQty : qty.newQty,
    };
    const kind = asIs ? "AS IS" : "new";
    const sheet = item.asIs ? " The sheet already marks this item AS IS." : "";
    say(`Counted ${kind} in ${zone.name}. ${item.groupName}, ${item.description}, SKU ${item.sku}.${sheet}`);
  }

  function createZone(name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) {
      say("Give the zone a name.");
      zoneNameInput.focus();
      return;
    }
    const zone = {
      id: `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed.slice(0, 60),
    };
    state.zones.push(zone);
    state.currentZoneId = zone.id;
    if (!state.counts[zone.id]) state.counts[zone.id] = {};
    save();
    zoneNameInput.value = "";
    zoneCreate.hidden = true;
    say(`Counting in ${zone.name}.`);
    render();
    focusScan();
  }

  function switchZone(zoneId) {
    if (!state.zones.some((zone) => zone.id === zoneId)) return;
    state.currentZoneId = zoneId;
    save();
    const zone = currentZone();
    say(`Now counting in ${zone.name}.`);
    render();
    focusScan();
  }

  function openAdd(sku) {
    const zone = currentZone();
    addSku.value = sku;
    addGroup.value = "";
    addDescription.value = "";
    addError.textContent = "";
    addZone.textContent = zone ? zone.name : "";
    addAsIsNote.hidden = !state.asIsArmed;
    addDialog.showModal();
    addGroup.focus();
  }

  function closeAdd(counted) {
    if (addDialog.open) addDialog.close();
    if (!counted && state.asIsArmed) {
      say("Not added. Next scan is still AS IS.");
    }
    renderBanner();
    focusScan();
  }

  function commitAdd() {
    const zone = currentZone();
    if (!zone) {
      addError.textContent = "Create a zone before adding an item.";
      return;
    }
    const groupName = addGroup.value.trim();
    const description = addDescription.value.trim();
    const sku = L.digitsOnly(addSku.value);
    if (!groupName || !description || !sku) {
      addError.textContent = "Group Name, Description, and a numeric SKU are required.";
      return;
    }
    if (L.isAsIsPrefix(sku)) {
      addError.textContent = "999999999 only marks the next scan AS IS. It is not an item.";
      return;
    }
    let item = bySku.get(sku);
    if (!item) {
      item = {
        sku,
        originalSku: "",
        groupName,
        description,
        asIs: false,
        dropped: false,
        vendor: "",
        vendorSku: "",
        finish: "",
        dimensions: "",
        site: "",
        store: "",
        locked: "",
        reserved: "",
        transfers: "",
        total: "",
        source: "added",
      };
      state.added.push(item);
      bySku.set(sku, item);
    }
    const asIs = state.asIsArmed;
    state.asIsArmed = false;
    bump(zone.id, sku, asIs, 1);
    save();
    remember(item, zone, asIs);
    if (addDialog.open) addDialog.close();
    renderAfterCount(sku, asIs);
    renderStats();
    focusScan();
  }

  function exportCsv() {
    const itemsBySku = Object.fromEntries(bySku);
    const rows = L.buildExportRows(state.zones, state.counts, itemsBySku);
    if (rows.length === 0) {
      say("Nothing counted yet. Scan a few items, then export.");
      focusScan();
      return;
    }
    const csv = L.toCsv(L.CSV_HEADERS, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `inventory-count-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    say(`Exported ${rows.length} count ${rows.length === 1 ? "line" : "lines"}.`);
    focusScan();
  }

  function render() {
    renderZones();
    renderBanner();
    renderMatch();
    renderViews();
    renderSort();
    renderFilters();
    renderStats();
    renderActiveList();
  }

  function renderAfterCount(sku, asIs) {
    renderBanner();
    renderMatch();
    renderZones();
    renderStats();
    renderActiveList();
    const row = countBody.querySelector(
      `tr[data-sku="${cssEscape(sku)}"][data-condition="${asIs ? "asis" : "new"}"]`,
    );
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  function renderZones() {
    const zone = currentZone();
    currentZoneEl.textContent = zone ? zone.name : "No zone yet";
    zoneChips.replaceChildren();
    for (const candidate of state.zones) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zone-chip";
      button.textContent = candidate.name;
      button.setAttribute("aria-pressed", candidate.id === state.currentZoneId ? "true" : "false");
      button.addEventListener("click", () => switchZone(candidate.id));
      zoneChips.appendChild(button);
    }
    const summary = zoneTotals(state.currentZoneId);
    zoneSummary.textContent = zone
      ? `${summary.newQty} new · ${summary.asIsQty} AS IS in this zone`
      : "Create a zone to start counting";
    scanInput.disabled = !zone;
    scanForm.querySelector("button").disabled = !zone;
  }

  function zoneTotals(zoneId) {
    const bucket = state.counts[zoneId] || {};
    let newQty = 0;
    let asIsQty = 0;
    for (const sku of Object.keys(bucket)) {
      newQty += Number(bucket[sku].new) || 0;
      asIsQty += Number(bucket[sku].asIs) || 0;
    }
    return { newQty, asIsQty };
  }

  function renderBanner() {
    banner.hidden = !state.asIsArmed;
    scanInput.classList.toggle("armed", state.asIsArmed);
  }

  function renderMatch() {
    if (!lastMatch) {
      matchEl.hidden = true;
      matchEl.replaceChildren();
      return;
    }
    matchEl.hidden = false;
    const kind = lastMatch.asIs ? "AS IS" : "New";
    const original = lastMatch.originalSku
      ? `<p class="original">Original SKU ${escapeHtml(lastMatch.originalSku)}</p>`
      : "";
    const sheet = lastMatch.sheetAsIs
      ? `<p class="sheet-flag">Sheet marks this item AS IS</p>`
      : "";
    matchEl.innerHTML = `
      <p class="match-kicker">Last scan · counted as ${kind}</p>
      <p class="match-desc">${escapeHtml(lastMatch.groupName)} · ${escapeHtml(lastMatch.description)}</p>
      <p class="match-sku">${escapeHtml(lastMatch.sku)} · ${escapeHtml(String(lastMatch.qty))} ${kind} in ${escapeHtml(lastMatch.zoneName)}</p>
      ${original}
      ${sheet}
    `;
    matchEl.classList.toggle("match-asis", lastMatch.asIs);
  }

  function renderViews() {
    countView.hidden = view !== "count";
    catalogView.hidden = view !== "catalog";
    sortBar.hidden = view !== "count";
    filterBar.hidden = view !== "catalog";
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.setAttribute("aria-pressed", button.getAttribute("data-view") === view ? "true" : "false");
    });
  }

  function renderSort() {
    document.querySelectorAll("[data-sort]").forEach((button) => {
      button.setAttribute("aria-pressed", button.getAttribute("data-sort") === sortMode ? "true" : "false");
    });
  }

  function renderFilters() {
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", button.getAttribute("data-filter") === catalogFilter ? "true" : "false");
    });
  }

  function renderStats() {
    const added = state.added.length;
    catalogStats.textContent = `${CATALOG.rowCount.toLocaleString()} catalog items · ${CATALOG.asIsCount.toLocaleString()} marked AS IS on the sheet${added ? ` · ${added} added` : ""}`;
  }

  function renderActiveList() {
    if (view === "count") renderCount();
    else renderCatalog();
  }

  function queryText() {
    return searchInput.value || "";
  }

  function renderCount() {
    const zone = currentZone();
    countBody.replaceChildren();
    if (!zone) {
      countEmpty.hidden = false;
      countEmpty.textContent = "Create a zone, then scan the first piece.";
      countView.querySelector("table").hidden = true;
      listNote.textContent = "";
      return;
    }
    const bucket = state.counts[zone.id] || {};
    const entries = [];
    for (const sku of Object.keys(bucket)) {
      const item = bySku.get(sku);
      if (!item) continue;
      if (!L.matchesQuery(item, queryText())) continue;
      const qty = L.zoneQty(state.counts, zone.id, sku);
      entries.push({
        sku,
        groupName: item.groupName,
        description: item.description,
        originalSku: item.originalSku || "",
        sheetAsIs: Boolean(item.asIs),
        meta: metaLine(item),
        newQty: qty.newQty,
        asIsQty: qty.asIsQty,
      });
    }
    const rows = L.pairCountRows(entries, sortMode);
    countEmpty.hidden = rows.length > 0;
    countEmpty.textContent = queryText().trim()
      ? "No counted items match that search in this zone."
      : "Nothing counted in this zone yet. Scan a barcode or type a SKU.";
    countView.querySelector("table").hidden = rows.length === 0;
    listNote.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? "line" : "lines"} in ${zone.name}` : "";
    for (const row of rows) {
      countBody.appendChild(countRow(row));
    }
  }

  function countRow(row) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-sku", row.sku);
    tr.setAttribute("data-condition", row.condition);
    tr.setAttribute("data-testid", "count-row");
    if (row.condition === "asis") tr.className = "as-is";
    const conditionLabel = row.condition === "asis" ? "AS IS" : "New";
    const original = row.originalSku ? `<div class="original">Original ${escapeHtml(row.originalSku)}</div>` : "";
    const sheet = row.sheetAsIs ? `<div class="sheet-flag">Sheet: AS IS</div>` : "";
    tr.innerHTML = `
      <td>${escapeHtml(row.groupName)}</td>
      <td>
        <div class="desc">${escapeHtml(row.description)}</div>
        <div class="meta">${escapeHtml(row.meta)}</div>
        ${sheet}
      </td>
      <td class="sku">
        <div>${escapeHtml(row.sku)}</div>
        ${original}
      </td>
      <td class="condition" data-testid="condition">${
        row.condition === "asis"
          ? `<span class="asis-pill">AS IS</span>`
          : `<span class="new-pill">New</span>`
      }</td>
      <td class="qty">
        <button type="button" data-step="-1" aria-label="Decrease ${conditionLabel} count for ${escapeHtml(row.sku)}">−</button>
        <span data-testid="qty">${row.qty}</span>
        <button type="button" data-step="1" aria-label="Increase ${conditionLabel} count for ${escapeHtml(row.sku)}">+</button>
      </td>
    `;
    return tr;
  }

  function renderCatalog() {
    const zone = currentZone();
    const zoneId = zone ? zone.id : null;
    const matches = [];
    for (const item of bySku.values()) {
      if (!L.matchesQuery(item, queryText())) continue;
      const status = L.countStatus(state.counts, zoneId, item.sku);
      if (catalogFilter === "zone" && status !== "zone") continue;
      if (catalogFilter === "any" && status === "none") continue;
      if (catalogFilter === "none" && status !== "none") continue;
      matches.push(item);
    }
    matches.sort((a, b) => a.sku.localeCompare(b.sku));
    const shown = matches.slice(0, LIST_CAP);
    catalogBody.replaceChildren();
    catalogEmpty.hidden = shown.length > 0;
    catalogEmpty.textContent = "No catalog items match.";
    catalogView.querySelector("table").hidden = shown.length === 0;
    listNote.textContent = matches.length
      ? `Showing ${shown.length} of ${matches.length.toLocaleString()}`
      : "";
    for (const item of shown) {
      catalogBody.appendChild(catalogRow(item, zone));
    }
  }

  function catalogRow(item, zone) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-testid", "catalog-row");
    if (item.asIs) tr.className = "as-is";
    const status = describeStatus(item.sku, zone);
    const original = item.originalSku ? `<div class="original">Original ${escapeHtml(item.originalSku)}</div>` : "";
    const added = item.source === "added" ? `<div class="sheet-flag">Added on this device</div>` : "";
    tr.innerHTML = `
      <td>${escapeHtml(item.groupName)}</td>
      <td>
        <div class="desc">${escapeHtml(item.description)}</div>
        <div class="meta">${escapeHtml(metaLine(item))}</div>
        ${added}
      </td>
      <td class="sku">
        <div>${escapeHtml(item.sku)}</div>
        ${original}
      </td>
      <td class="condition" data-testid="sheet-condition">${sheetBadge(item)}</td>
      <td class="status">${escapeHtml(status)}</td>
    `;
    return tr;
  }

  function sheetBadge(item) {
    if (item.source === "added") return `<span class="new-pill">Added</span>`;
    if (item.asIs) return `<span class="asis-pill">AS IS</span>`;
    return `<span class="new-pill">New</span>`;
  }

  function describeStatus(sku, zone) {
    const parts = [];
    for (const candidate of state.zones) {
      const qty = L.zoneQty(state.counts, candidate.id, sku);
      if (qty.newQty === 0 && qty.asIsQty === 0) continue;
      const bits = [];
      if (qty.newQty) bits.push(`${qty.newQty} new`);
      if (qty.asIsQty) bits.push(`${qty.asIsQty} AS IS`);
      const here = zone && candidate.id === zone.id ? " (this zone)" : "";
      parts.push(`${candidate.name}: ${bits.join(", ")}${here}`);
    }
    return parts.length ? parts.join(" · ") : "Not counted";
  }

  function metaLine(item) {
    const bits = [];
    if (item.vendor && item.vendor !== item.groupName) bits.push(`Vendor ${item.vendor}`);
    if (item.vendorSku) bits.push(`Vendor SKU ${item.vendorSku}`);
    if (item.finish) bits.push(`Finish ${item.finish}`);
    if (item.dimensions) bits.push(`Dim ${item.dimensions}`);
    if (item.site) bits.push(`Site ${item.site}`);
    if (item.store) bits.push(`On hand ${item.store}`);
    if (item.locked && item.locked !== "0") bits.push(`Locked ${item.locked}`);
    if (item.reserved && item.reserved !== "0") bits.push(`Reserved ${item.reserved}`);
    if (item.transfers && item.transfers !== "0") bits.push(`Transfers ${item.transfers}`);
    if (item.total) bits.push(`Total ${item.total}`);
    if (item.dropped) bits.push("Dropped");
    return bits.join(" · ");
  }

  function say(message) {
    liveEl.textContent = message;
  }

  function focusScan() {
    if (addDialog.open) return;
    const active = document.activeElement;
    if (active && active.closest("[data-keep-focus]") && !addDialog.contains(active)) return;
    if (!currentZone()) return;
    // A just-closed dialog can leave this field focused but ignoring keys.
    if (document.activeElement === scanInput) scanInput.blur();
    scanInput.focus({ preventScroll: true });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }
})();
