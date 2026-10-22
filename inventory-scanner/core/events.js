/* Unit events + aggregations. Browser: globalThis.InventoryEvents */
(function (root, factory) {
  root.InventoryEvents = factory(root.FloorLogic);
})(typeof globalThis !== "undefined" ? globalThis : this, function (FloorLogic) {
  const L = FloorLogic || {};

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /** One physical identified unit (or a void/correction of one). */
  function createUnitEvent( partial ) {
    const sku = String(partial.sku ?? "");
    if (!sku) throw new Error("sku required");
    const zoneId = String(partial.zoneId ?? "");
    const areaId = String(partial.areaId ?? "");
    if (!zoneId || !areaId) throw new Error("zone and area required");
    return {
      eventId: partial.eventId || uuid(),
      sku,
      zoneId,
      areaId,
      condition: partial.condition === "asis" ? "asis" : "new",
      status: partial.status === "void" ? "void" : "active",
      syncStatus: partial.syncStatus || "local",
      source: partial.source || "scan",
      importBatchId: partial.importBatchId || "",
      description: partial.description || "",
      groupName: partial.groupName || "",
      createdAt: partial.createdAt || nowIso(),
      voidedAt: partial.voidedAt || "",
      voidReason: partial.voidReason || "",
      clientId: partial.clientId || "",
      replacesEventId: partial.replacesEventId || "",
    };
  }

  /**
   * Expand legacy aggregated counts {zone:{area:{sku:{new,asIs}}}} into unit events.
   * Stable event IDs so re-migration does not invent new units.
   */
  function expandCountsToEvents(counts, areaOwner, options) {
    const events = [];
    const clientId = options?.clientId || "migrate";
    const createdAt = options?.createdAt || nowIso();
    const zones = counts && typeof counts === "object" ? counts : {};
    for (const zoneId of Object.keys(zones)) {
      const areas = zones[zoneId] || {};
      for (const areaId of Object.keys(areas)) {
        const bucket = areas[areaId];
        if (!bucket || typeof bucket !== "object") continue;
        if ("new" in bucket || "asIs" in bucket) continue;
        for (const sku of Object.keys(bucket)) {
          const entry = bucket[sku];
          if (!entry || typeof entry !== "object") continue;
          const newQty = Math.max(0, Number(entry.new) || 0);
          const asIsQty = Math.max(0, Number(entry.asIs) || 0);
          for (let i = 0; i < newQty; i += 1) {
            events.push(createUnitEvent({
              eventId: `legacy-${zoneId}-${areaId}-${sku}-new-${i}`,
              sku,
              zoneId,
              areaId,
              condition: "new",
              source: "migrate",
              syncStatus: "local",
              clientId,
              createdAt,
            }));
          }
          for (let i = 0; i < asIsQty; i += 1) {
            events.push(createUnitEvent({
              eventId: `legacy-${zoneId}-${areaId}-${sku}-asis-${i}`,
              sku,
              zoneId,
              areaId,
              condition: "asis",
              source: "migrate",
              syncStatus: "local",
              clientId,
              createdAt,
            }));
          }
        }
      }
    }
    return events;
  }

  /** Idempotent merge: same eventId keeps the first / server-ack wins sync. */
  function upsertEvent(events, event) {
    const list = Array.isArray(events) ? events.slice() : [];
    const idx = list.findIndex((e) => e.eventId === event.eventId);
    if (idx === -1) {
      list.push(event);
      return { events: list, inserted: true, duplicate: false };
    }
    const prev = list[idx];
    // Retry with same ID: no extra unit. Prefer synced over local.
    const merged = { ...prev };
    if (event.syncStatus === "synced") merged.syncStatus = "synced";
    if (event.status === "void") {
      merged.status = "void";
      merged.voidedAt = event.voidedAt || nowIso();
      merged.voidReason = event.voidReason || merged.voidReason;
    }
    list[idx] = merged;
    return { events: list, inserted: false, duplicate: true };
  }

  function voidEvent(events, eventId, reason) {
    const list = Array.isArray(events) ? events.slice() : [];
    const idx = list.findIndex((e) => e.eventId === eventId);
    if (idx === -1) return { events: list, found: false };
    const prev = list[idx];
    if (prev.status === "void") return { events: list, found: true, alreadyVoid: true };
    list[idx] = {
      ...prev,
      status: "void",
      voidedAt: nowIso(),
      voidReason: reason || "correction",
      syncStatus: prev.syncStatus === "synced" ? "local" : prev.syncStatus,
    };
    return { events: list, found: true, alreadyVoid: false };
  }

  function activeEvents(events) {
    return (events || []).filter((e) => e && e.status !== "void");
  }

  function identifiedQtyBySku(events) {
    const map = new Map();
    for (const e of activeEvents(events)) {
      map.set(e.sku, (map.get(e.sku) || 0) + 1);
    }
    return map;
  }

  function locationsBySku(events) {
    const map = new Map();
    for (const e of activeEvents(events)) {
      if (!map.has(e.sku)) map.set(e.sku, new Map());
      const loc = map.get(e.sku);
      const key = `${e.zoneId}|${e.areaId}`;
      loc.set(key, (loc.get(key) || 0) + 1);
    }
    const out = new Map();
    for (const [sku, loc] of map) {
      out.set(
        sku,
        [...loc.entries()].map(([key, qty]) => {
          const [zoneId, areaId] = key.split("|");
          return { zoneId, areaId, qty };
        }).sort((a, b) => String(a.zoneId).localeCompare(String(b.zoneId))
          || String(a.areaId).localeCompare(String(b.areaId))),
      );
    }
    return out;
  }

  function areaUnitList(events, zoneId, areaId) {
    return activeEvents(events)
      .filter((e) => e.zoneId === zoneId && e.areaId === areaId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
        || String(a.eventId).localeCompare(String(b.eventId)));
  }

  function countsFromEvents(events) {
    const counts = {};
    for (const e of activeEvents(events)) {
      if (!counts[e.zoneId]) counts[e.zoneId] = {};
      if (!counts[e.zoneId][e.areaId]) counts[e.zoneId][e.areaId] = {};
      if (!counts[e.zoneId][e.areaId][e.sku]) {
        counts[e.zoneId][e.areaId][e.sku] = { new: 0, asIs: 0 };
      }
      const key = e.condition === "asis" ? "asIs" : "new";
      counts[e.zoneId][e.areaId][e.sku][key] += 1;
    }
    return counts;
  }

  function pendingSync(events) {
    return (events || []).filter((e) => e.syncStatus === "local" || e.syncStatus === "error" || e.syncStatus === "syncing");
  }

  function markSyncing(events, eventIds) {
    const set = new Set(eventIds);
    return (events || []).map((e) => (set.has(e.eventId) ? { ...e, syncStatus: "syncing" } : e));
  }

  function markSynced(events, eventIds) {
    const set = new Set(eventIds);
    return (events || []).map((e) => (set.has(e.eventId) ? { ...e, syncStatus: "synced" } : e));
  }

  function markSyncError(events, eventIds) {
    const set = new Set(eventIds);
    return (events || []).map((e) => (set.has(e.eventId) ? { ...e, syncStatus: "error" } : e));
  }

  /** Create N unit events for an import row (quantity → N barcodes). */
  function eventsFromQuantityRow(row, batchId) {
    const qty = Math.floor(Number(row.quantity));
    if (!Number.isFinite(qty) || qty < 0) throw new Error("quantity must be nonnegative integer");
    const sku = String(row.sku ?? "");
    const zoneId = String(row.zone ?? "");
    const areaId = String(row.area ?? "");
    const condition = row.condition === "asis" ? "asis" : "new";
    const out = [];
    for (let i = 0; i < qty; i += 1) {
      out.push(createUnitEvent({
        eventId: row.eventIdPrefix
          ? `${row.eventIdPrefix}-${i}`
          : undefined,
        sku,
        zoneId,
        areaId,
        condition,
        source: "import",
        importBatchId: batchId,
        description: row.description || "",
        groupName: row.groupName || "",
        syncStatus: "local",
      }));
    }
    return out;
  }

  return {
    uuid,
    nowIso,
    createUnitEvent,
    expandCountsToEvents,
    upsertEvent,
    voidEvent,
    activeEvents,
    identifiedQtyBySku,
    locationsBySku,
    areaUnitList,
    countsFromEvents,
    pendingSync,
    markSyncing,
    markSynced,
    markSyncError,
    eventsFromQuantityRow,
    AS_IS_PREFIX: L.AS_IS_PREFIX || "999999999",
  };
});
