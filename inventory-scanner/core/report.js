/* Executive report: expected vs identified. Never invent expected. */
(function (root, factory) {
  root.InventoryReport = factory(root.InventoryEvents);
})(typeof globalThis !== "undefined" ? globalThis : this, function (InventoryEvents) {
  const E = InventoryEvents;

  /**
   * @param {object} options
   * @param {Array} options.events
   * @param {{loaded:boolean,snapshotDate?:string,source?:string,rows:Array<{sku:string,description?:string,expected_qty:number}>}|null} options.expected
   * @param {Map|object} [options.catalogBySku]
   * @param {'full'|'shortages'|'overages'|'discrepancies'} [options.view]
   * @param {string} [options.query]
   * @param {Set|Array} [options.incompleteAreaKeys] zone|area keys still not complete → preliminary
   */
  function buildReport(options) {
    const events = options.events || [];
    const expected = options.expected || { loaded: false, rows: [] };
    const view = options.view || "full";
    const query = String(options.query || "").trim().toLowerCase();
    const incomplete = new Set(
      Array.isArray(options.incompleteAreaKeys)
        ? options.incompleteAreaKeys
        : options.incompleteAreaKeys
          ? [...options.incompleteAreaKeys]
          : [],
    );
    const catalog = options.catalogBySku instanceof Map
      ? options.catalogBySku
      : new Map(Object.entries(options.catalogBySku || {}));

    const identified = E.identifiedQtyBySku(events);
    const locations = E.locationsBySku(events);
    const expectedMap = new Map();
    if (expected.loaded) {
      for (const row of expected.rows || []) {
        const sku = String(row.sku ?? "");
        if (!sku) continue;
        const qty = Number(row.expected_qty);
        expectedMap.set(sku, {
          expectedQty: Number.isFinite(qty) ? qty : null,
          description: row.description || "",
        });
      }
    }

    const skus = new Set([...identified.keys(), ...expectedMap.keys()]);
    const rows = [];
    for (const sku of skus) {
      const idQty = identified.get(sku) || 0;
      const exp = expectedMap.get(sku);
      const catalogItem = catalog.get(sku);
      const description = (exp && exp.description)
        || (catalogItem && catalogItem.description)
        || "";
      const expectedAvailable = expected.loaded && exp != null && Number.isFinite(exp.expectedQty);
      const expectedQty = expectedAvailable ? exp.expectedQty : null;
      const variance = expectedAvailable ? idQty - expectedQty : null;
      const locs = locations.get(sku) || [];
      const preliminary = locs.some((loc) => incomplete.has(`${loc.zoneId}|${loc.areaId}`))
        || incomplete.size > 0;

      const row = {
        sku,
        description,
        expectedQty,
        expectedAvailable,
        expectedLabel: expected.loaded
          ? (expectedAvailable ? String(expectedQty) : "Not in expected file")
          : "Expected unavailable",
        identifiedQty: idQty,
        variance,
        varianceLabel: expectedAvailable ? String(variance) : "—",
        locations: locs,
        locationsLabel: locs.map((l) => `${l.zoneId}/${l.areaId}×${l.qty}`).join("; "),
        preliminary: Boolean(preliminary && expectedAvailable && variance !== 0),
      };

      if (query) {
        const hay = `${row.sku} ${row.description} ${row.locationsLabel}`.toLowerCase();
        if (!hay.includes(query)) continue;
      }

      if (view === "shortages") {
        if (!expectedAvailable || variance >= 0) continue;
      } else if (view === "overages") {
        if (!expectedAvailable || variance <= 0) continue;
      } else if (view === "discrepancies") {
        if (!expectedAvailable || variance === 0) continue;
      }
      rows.push(row);
    }

    rows.sort((a, b) => {
      if (a.variance != null && b.variance != null) {
        const mag = Math.abs(b.variance) - Math.abs(a.variance);
        if (mag) return mag;
      }
      return String(a.sku).localeCompare(String(b.sku));
    });

    const coverage = {
      expectedLoaded: Boolean(expected.loaded),
      snapshotDate: expected.snapshotDate || "",
      source: expected.source || "",
      incompleteAreas: incomplete.size,
      generatedAt: new Date().toISOString(),
      rowCount: rows.length,
      identifiedSkuCount: identified.size,
      expectedSkuCount: expectedMap.size,
      notice: !expected.loaded
        ? "Expected inventory has not been imported. Variances are unavailable — catalog size is not expected stock."
        : incomplete.size
          ? "Some areas are incomplete. Variances are PRELIMINARY."
          : "Expected snapshot loaded.",
    };

    return { rows, coverage, view };
  }

  function printHeading(coverage, viewTitle) {
    return {
      store: "STORE 17",
      title: `Executive Report — ${viewTitle}`,
      snapshotDate: coverage.snapshotDate || "Expected unavailable",
      generatedAt: coverage.generatedAt,
      notice: coverage.notice,
    };
  }

  const VIEW_TITLES = {
    full: "Full Inventory",
    shortages: "Shortages Only",
    overages: "Overages Only",
    discrepancies: "All Discrepancies",
  };

  return { buildReport, printHeading, VIEW_TITLES };
});
