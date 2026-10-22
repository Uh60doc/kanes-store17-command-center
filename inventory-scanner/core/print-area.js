/* Zone/Area count sheets: one Code 128 per identified unit. */
(function (root, factory) {
  root.InventoryPrint = factory(root.FloorLogic, root.InventoryEvents);
})(typeof globalThis !== "undefined" ? globalThis : this, function (FloorLogic, InventoryEvents) {
  const L = FloorLogic;
  const E = InventoryEvents;

  function areaRevision(areaStatus, zoneId, areaId) {
    const key = `${zoneId}|${areaId}`;
    const row = areaStatus && areaStatus[key];
    return row ? Number(row.revision) || 1 : 1;
  }

  /**
   * Build printable units for Entire Zone or a single Area.
   * One active event → one barcode payload (the SKU string).
   */
  function buildPrintModel(options) {
    const zoneId = String(options.zoneId || "");
    const areaId = options.areaId == null || options.areaId === "" ? null : String(options.areaId);
    const events = options.events || [];
    const areaStatus = options.areaStatus || {};
    const catalog = options.catalogBySku instanceof Map
      ? options.catalogBySku
      : new Map(Object.entries(options.catalogBySku || {}));

    let units = E.activeEvents(events).filter((e) => e.zoneId === zoneId);
    if (areaId) units = units.filter((e) => e.areaId === areaId);

    units.sort((a, b) => String(a.areaId).localeCompare(String(b.areaId))
      || String(a.sku).localeCompare(String(b.sku))
      || String(a.createdAt).localeCompare(String(b.createdAt)));

    const byArea = new Map();
    for (const u of units) {
      if (!byArea.has(u.areaId)) byArea.set(u.areaId, []);
      const item = catalog.get(u.sku);
      byArea.get(u.areaId).push({
        eventId: u.eventId,
        sku: u.sku,
        condition: u.condition,
        description: u.description || (item && item.description) || "",
        groupName: u.groupName || (item && item.groupName) || "",
        barcodeSvg: L.code128Svg(u.sku, { module: 2, height: 56, quiet: 10 }),
      });
    }

    const areas = [...byArea.keys()].sort().map((aid) => ({
      zoneId,
      areaId: aid,
      revision: areaRevision(areaStatus, zoneId, aid),
      units: byArea.get(aid),
      count: byArea.get(aid).length,
    }));

    return {
      store: "STORE 17",
      zoneId,
      mode: areaId ? "area" : "zone",
      selectedAreaId: areaId,
      generatedAt: new Date().toISOString(),
      areas,
      totalUnits: units.length,
      disclaimer: "Preparatory identified units for third-party counters. Not the official final inventory.",
    };
  }

  function renderPrintHtml(model) {
    const chunks = [];
    chunks.push(`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Store 17 Zone ${model.zoneId} count sheet</title>
<style>
  @page { size: letter; margin: 0.5in; }
  body { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; color: #111; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { font-size: 12px; margin-bottom: 12px; }
  .disclaimer { font-size: 11px; color: #444; margin-bottom: 16px; }
  .area { break-before: page; }
  .area:first-of-type { break-before: auto; }
  .area-head { border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }
  .card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #ccc; padding: 8px; }
  .sku { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; }
  .desc { font-size: 11px; margin: 2px 0 6px; }
  svg { display: block; max-width: 100%; height: auto; }
  .print-hint { font-size: 11px; margin-top: 8px; }
  @media print { .no-print { display: none !important; } }
</style></head><body>`);
    chunks.push(`<div class="no-print"><button onclick="window.print()">Print</button>
<p class="print-hint">Use 100% scale, letter paper, dark-on-light. One Code 128 symbol per physical unit.</p></div>`);
    chunks.push(`<p class="meta">${model.store} · Zone ${model.zoneId} · ${model.mode === "area" ? `Area ${model.selectedAreaId} only` : "Entire zone"} · Generated ${model.generatedAt} · ${model.totalUnits} unit(s)</p>`);
    chunks.push(`<p class="disclaimer">${model.disclaimer}</p>`);

    for (const area of model.areas) {
      chunks.push(`<section class="area">`);
      chunks.push(`<div class="area-head"><h1>STORE 17 · Zone ${area.zoneId} · Area ${area.areaId}</h1>
<p class="meta">AREA REVISION ${area.revision} · ${area.count} barcode(s) · ${model.generatedAt}</p></div>`);
      chunks.push(`<div class="grid">`);
      for (const u of area.units) {
        chunks.push(`<div class="card"><div class="sku">${escapeHtml(u.sku)}${u.condition === "asis" ? " · AS IS" : ""}</div>
<div class="desc">${escapeHtml(u.groupName)} — ${escapeHtml(u.description)}</div>
${u.barcodeSvg}</div>`);
      }
      chunks.push(`</div></section>`);
    }
    if (!model.areas.length) {
      chunks.push(`<p>No identified units for this selection.</p>`);
    }
    chunks.push(`</body></html>`);
    return chunks.join("\n");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
    ));
  }

  return { buildPrintModel, renderPrintHtml, areaRevision };
});
