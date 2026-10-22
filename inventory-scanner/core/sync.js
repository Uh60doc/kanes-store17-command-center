/* Authenticated Google Apps Script sync client (idempotent by eventId). */
(function (root, factory) {
  root.InventorySync = factory(root.InventoryEvents);
})(typeof globalThis !== "undefined" ? globalThis : this, function (InventoryEvents) {
  const E = InventoryEvents;

  /**
   * Sync pending events to Apps Script web app.
   * Endpoint must verify syncToken server-side; never put Sheet secrets in the frontend.
   */
  async function syncPending(state, options) {
    const endpoint = (options && options.endpoint) || state.syncEndpoint || "";
    const token = (options && options.token) || state.syncToken || "";
    const fetchImpl = (options && options.fetchImpl) || globalThis.fetch;
    const pending = E.pendingSync(state.events).filter((e) => e.syncStatus !== "syncing");

    if (!endpoint) {
      return { ok: false, reason: "no_endpoint", pending: pending.length, synced: [] };
    }
    if (!token) {
      return { ok: false, reason: "no_token", pending: pending.length, synced: [] };
    }
    if (!pending.length) {
      return { ok: true, reason: "nothing_pending", pending: 0, synced: [] };
    }

    const batch = pending.slice(0, options?.limit || 200);
    const ids = batch.map((e) => e.eventId);
    let events = E.markSyncing(state.events, ids);

    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "upsertEvents",
          token,
          clientId: state.clientId,
          events: batch,
        }),
      });
      if (!res.ok) {
        events = E.markSyncError(events, ids);
        return {
          ok: false,
          reason: `http_${res.status}`,
          pending: pending.length,
          synced: [],
          events,
        };
      }
      const body = await res.json();
      if (!body || body.ok !== true) {
        events = E.markSyncError(events, ids);
        return {
          ok: false,
          reason: (body && body.error) || "server_rejected",
          pending: pending.length,
          synced: [],
          events,
        };
      }
      const acked = Array.isArray(body.ackedEventIds) ? body.ackedEventIds : ids;
      events = E.markSynced(events, acked);
      return {
        ok: true,
        reason: "synced",
        pending: E.pendingSync(events).length,
        synced: acked,
        events,
        server: body,
      };
    } catch (err) {
      events = E.markSyncError(events, ids);
      return {
        ok: false,
        reason: "network",
        error: String(err && err.message ? err.message : err),
        pending: pending.length,
        synced: [],
        events,
      };
    }
  }

  function badgeForEvent(event) {
    switch (event.syncStatus) {
      case "synced":
        return { label: "Synced", tone: "ok" };
      case "syncing":
        return { label: "Syncing", tone: "busy" };
      case "error":
        return { label: "Needs attention", tone: "bad" };
      default:
        return { label: "Saved locally", tone: "local" };
    }
  }

  function summaryBadges(events) {
    const pending = E.pendingSync(events);
    const errors = (events || []).filter((e) => e.syncStatus === "error");
    const synced = (events || []).filter((e) => e.syncStatus === "synced");
    return {
      local: pending.filter((e) => e.syncStatus === "local").length,
      syncing: pending.filter((e) => e.syncStatus === "syncing").length,
      error: errors.length,
      synced: synced.length,
      label: errors.length
        ? "Needs attention"
        : pending.length
          ? `${pending.length} pending sync`
          : "All synced",
    };
  }

  /** In-memory fake server for tests (idempotent). */
  function createMemoryServer(seed) {
    const byId = new Map();
    if (seed) for (const e of seed) byId.set(e.eventId, e);
    return {
      async handle(body) {
        if (!body || body.token !== "test-token") return { ok: false, error: "unauthorized" };
        if (body.action !== "upsertEvents") return { ok: false, error: "unknown_action" };
        const acked = [];
        for (const e of body.events || []) {
          if (!byId.has(e.eventId)) byId.set(e.eventId, e);
          else {
            const prev = byId.get(e.eventId);
            if (e.status === "void") byId.set(e.eventId, { ...prev, ...e });
          }
          acked.push(e.eventId);
        }
        return { ok: true, ackedEventIds: acked, stored: byId.size };
      },
      get size() {
        return byId.size;
      },
      get(eventId) {
        return byId.get(eventId);
      },
    };
  }

  function memoryFetch(server) {
    return async function fetchImpl(_url, init) {
      const body = JSON.parse(init.body);
      const result = await server.handle(body);
      return {
        ok: true,
        status: 200,
        async json() {
          return result;
        },
      };
    };
  }

  return {
    syncPending,
    badgeForEvent,
    summaryBadges,
    createMemoryServer,
    memoryFetch,
  };
});
