/* Local-first persistence: localStorage + optional IndexedDB. Never silent-clear. */
(function (root, factory) {
  root.InventoryPersist = factory(root.InventoryEvents);
})(typeof globalThis !== "undefined" ? globalThis : this, function (InventoryEvents) {
  const E = InventoryEvents;
  const LEGACY_KEY = "floor-inventory-scanner-v3";
  const STATE_KEY = "store17-inventory-state-v1";
  const DB_NAME = "store17-inventory";
  const DB_VERSION = 1;
  const STORE = "state";

  function emptyAreaStatuses() {
    return {};
  }

  function emptyExpected() {
    return { loaded: false, snapshotDate: "", source: "", rows: [] };
  }

  function emptyState() {
    return {
      version: 1,
      clientId: E ? E.uuid() : `client-${Date.now()}`,
      zones: [],
      currentZoneId: null,
      currentAreaId: null,
      areaOwner: {},
      areaMeta: {},
      areaStatus: emptyAreaStatuses(),
      events: [],
      added: [],
      asIsArmed: false,
      sheetUrl: "",
      syncEndpoint: "",
      syncToken: "",
      lastSyncAt: "",
      expected: emptyExpected(),
      importBatches: [],
      auditLog: [],
      migratedFromLegacy: false,
    };
  }

  function normalizeState(data) {
    const base = emptyState();
    if (!data || typeof data !== "object") return base;
    return {
      ...base,
      ...data,
      zones: Array.isArray(data.zones) ? data.zones : [],
      areaOwner: data.areaOwner && typeof data.areaOwner === "object" ? data.areaOwner : {},
      areaMeta: data.areaMeta && typeof data.areaMeta === "object" ? data.areaMeta : {},
      areaStatus: data.areaStatus && typeof data.areaStatus === "object" ? data.areaStatus : {},
      events: Array.isArray(data.events) ? data.events : [],
      added: Array.isArray(data.added) ? data.added : [],
      expected: data.expected && typeof data.expected === "object" ? { ...emptyExpected(), ...data.expected } : emptyExpected(),
      importBatches: Array.isArray(data.importBatches) ? data.importBatches : [],
      auditLog: Array.isArray(data.auditLog) ? data.auditLog : [],
      asIsArmed: Boolean(data.asIsArmed),
      migratedFromLegacy: Boolean(data.migratedFromLegacy),
    };
  }

  function migrateLegacyIfNeeded(state) {
    if (state.migratedFromLegacy && state.events.length) return state;
    let legacy = null;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) legacy = JSON.parse(raw);
    } catch {
      legacy = null;
    }
    if (!legacy || typeof legacy.counts !== "object" || !legacy.counts) {
      return { ...state, migratedFromLegacy: true };
    }
    // If we already have events, do not re-expand (would risk duplicates with non-stable IDs).
    if (state.events.length > 0) {
      return { ...state, migratedFromLegacy: true };
    }
    const expanded = E.expandCountsToEvents(legacy.counts, legacy.areaOwner, {
      clientId: state.clientId,
    });
    const next = {
      ...state,
      zones: Array.isArray(legacy.zones) && legacy.zones.length ? legacy.zones : state.zones,
      currentZoneId: legacy.currentZoneId || state.currentZoneId,
      currentAreaId: legacy.currentAreaId || state.currentAreaId,
      areaOwner: legacy.areaOwner && typeof legacy.areaOwner === "object" ? legacy.areaOwner : state.areaOwner,
      areaMeta: legacy.areaMeta && typeof legacy.areaMeta === "object" ? legacy.areaMeta : state.areaMeta,
      added: Array.isArray(legacy.added) ? legacy.added : state.added,
      sheetUrl: typeof legacy.sheetUrl === "string" ? legacy.sheetUrl : state.sheetUrl,
      events: expanded,
      migratedFromLegacy: true,
    };
    // Keep legacy key intact — never clear silently.
    return next;
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) return migrateLegacyIfNeeded(normalizeState(JSON.parse(raw)));
    } catch {
      /* fall through */
    }
    return migrateLegacyIfNeeded(emptyState());
  }

  function saveLocalStorage(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    // Mirror aggregated counts into legacy key so old recovery paths still see data.
    try {
      const counts = E.countsFromEvents(state.events);
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      let legacy = {};
      try {
        legacy = legacyRaw ? JSON.parse(legacyRaw) : {};
      } catch {
        legacy = {};
      }
      localStorage.setItem(LEGACY_KEY, JSON.stringify({
        ...legacy,
        zones: state.zones,
        currentZoneId: state.currentZoneId,
        currentAreaId: state.currentAreaId,
        areaOwner: state.areaOwner,
        areaMeta: state.areaMeta,
        counts,
        added: state.added,
        asIsArmed: state.asIsArmed,
        sheetUrl: state.sheetUrl,
      }));
    } catch {
      /* do not block primary save */
    }
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("indexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
    });
  }

  async function saveIndexedDb(state) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, "main");
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  async function loadIndexedDb() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("main");
      req.onsuccess = () => {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  }

  async function load() {
    let fromIdb = null;
    try {
      fromIdb = await loadIndexedDb();
    } catch {
      fromIdb = null;
    }
    const fromLs = loadFromLocalStorage();
    if (fromIdb && typeof fromIdb === "object") {
      const idb = normalizeState(fromIdb);
      // Prefer whichever has more events (never drop the richer set).
      if (idb.events.length >= fromLs.events.length) return migrateLegacyIfNeeded(idb);
    }
    return fromLs;
  }

  async function save(state) {
    saveLocalStorage(state);
    try {
      await saveIndexedDb(state);
    } catch {
      /* localStorage already saved */
    }
  }

  function exportRecoveryJson(state) {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      pending: E.pendingSync(state.events).length,
      state,
    }, null, 2);
  }

  const AREA_STATUSES = ["not_started", "in_progress", "ready_for_review", "complete"];

  function ensureAreaStatus(state, zoneId, areaId) {
    const key = `${zoneId}|${areaId}`;
    if (!state.areaStatus[key]) {
      state.areaStatus[key] = {
        zoneId,
        areaId,
        status: "not_started",
        revision: 1,
        assignedTo: "",
        updatedAt: E.nowIso(),
      };
    }
    return state.areaStatus[key];
  }

  function setAreaStatus(state, zoneId, areaId, status, extra) {
    if (!AREA_STATUSES.includes(status)) throw new Error("invalid area status");
    const row = ensureAreaStatus(state, zoneId, areaId);
    row.status = status;
    row.updatedAt = E.nowIso();
    if (extra && extra.assignedTo != null) row.assignedTo = String(extra.assignedTo);
    if (extra && extra.bumpRevision) row.revision = (Number(row.revision) || 1) + 1;
    return row;
  }

  function bumpAreaRevision(state, zoneId, areaId) {
    const row = ensureAreaStatus(state, zoneId, areaId);
    row.revision = (Number(row.revision) || 1) + 1;
    row.updatedAt = E.nowIso();
    if (row.status === "not_started") row.status = "in_progress";
    return row;
  }

  function appendAudit(state, entry) {
    state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
    state.auditLog.push({
      id: E.uuid(),
      at: E.nowIso(),
      ...entry,
    });
    if (state.auditLog.length > 5000) state.auditLog = state.auditLog.slice(-4000);
  }

  return {
    LEGACY_KEY,
    STATE_KEY,
    emptyState,
    normalizeState,
    migrateLegacyIfNeeded,
    loadFromLocalStorage,
    saveLocalStorage,
    load,
    save,
    exportRecoveryJson,
    AREA_STATUSES,
    ensureAreaStatus,
    setAreaStatus,
    bumpAreaRevision,
    appendAudit,
  };
});
