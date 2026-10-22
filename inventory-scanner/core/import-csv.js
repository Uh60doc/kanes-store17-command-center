/* CSV import: handwritten identified units + expected inventory. */
(function (root, factory) {
  root.InventoryImport = factory(root.InventoryEvents, root.FloorLogic);
})(typeof globalThis !== "undefined" ? globalThis : this, function (InventoryEvents, FloorLogic) {
  const E = InventoryEvents;
  const L = FloorLogic;

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    const src = String(text ?? "").replace(/^\uFEFF/, "");
    while (i < src.length) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        row.push(cell);
        cell = "";
        i += 1;
        continue;
      }
      if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        i += 1;
        continue;
      }
      if (ch === "\r") {
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  }

  function checksum(text) {
    const s = String(text ?? "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (`00000000${(h >>> 0).toString(16)}`).slice(-8);
  }

  function headerIndex(headers) {
    const map = {};
    headers.forEach((h, i) => {
      map[String(h).trim().toLowerCase()] = i;
    });
    return map;
  }

  function cell(row, idx, name) {
    const i = idx[name];
    if (i == null) return "";
    return String(row[i] ?? "").trim();
  }

  const IDENTIFIED_REQUIRED = ["sku", "zone", "area", "quantity"];
  const EXPECTED_REQUIRED = ["sku", "expected_qty"];

  function validateIdentified(text, options) {
    const rows = parseCsv(text);
    const errors = [];
    const warnings = [];
    const preview = [];
    if (!rows.length) {
      return { ok: false, errors: ["File is empty"], warnings, preview, checksum: checksum(text) };
    }
    const idx = headerIndex(rows[0]);
    for (const col of IDENTIFIED_REQUIRED) {
      if (idx[col] == null) errors.push(`Missing required column: ${col}`);
    }
    if (errors.length) {
      return { ok: false, errors, warnings, preview, checksum: checksum(text) };
    }

    const knownZones = options?.knownZones instanceof Set
      ? options.knownZones
      : new Set(options?.knownZones || []);
    const catalog = options?.catalogBySku instanceof Map
      ? options.catalogBySku
      : new Map(Object.entries(options?.catalogBySku || {}));
    const allowCreateArea = Boolean(options?.allowCreateArea);

    for (let r = 1; r < rows.length; r += 1) {
      const line = rows[r];
      const rowNum = r + 1;
      let sku = cell(line, idx, "sku");
      // Preserve leading zeros: strip wrapping quotes/apostrophes only.
      sku = sku.replace(/^['"]+|['"]+$/g, "");
      if (/^\d+$/.test(sku) === false && sku) {
        // Keep as text but flag if not digits
        warnings.push(`Row ${rowNum}: SKU has non-digit characters (${sku})`);
      }
      const zone = cell(line, idx, "zone").toUpperCase();
      let area = cell(line, idx, "area");
      const areaTag = L.parseAreaTag?.(area);
      if (areaTag) area = areaTag.areaId;
      const qtyRaw = cell(line, idx, "quantity");
      const quantity = Number(qtyRaw);
      const description = cell(line, idx, "description");
      const source = cell(line, idx, "source") || "handwritten";
      const sourceReference = cell(line, idx, "source_reference");
      const notes = cell(line, idx, "notes");
      const issues = [];

      if (!sku) issues.push("sku required");
      if (L.isAsIsPrefix?.(sku)) {
        issues.push("999999999 is AS-IS arm code, not an item SKU");
      }
      if (!zone || !L.parseZoneName?.(zone)) issues.push("invalid zone");
      if (!area) issues.push("area required");
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        issues.push("quantity must be a nonnegative integer");
      }
      if (knownZones.size && !knownZones.has(zone) && !allowCreateArea) {
        warnings.push(`Row ${rowNum}: zone ${zone} not yet in local zone list (will create on confirm if allowed)`);
      }
      const known = catalog.get(sku);
      if (!known) warnings.push(`Row ${rowNum}: SKU ${sku} not in product master`);

      const entry = {
        rowNum,
        sku,
        description: description || (known && known.description) || "",
        zone,
        area,
        quantity: Number.isFinite(quantity) ? quantity : null,
        source,
        sourceReference,
        notes,
        issues,
        unknownSku: !known,
      };
      preview.push(entry);
      for (const issue of issues) errors.push(`Row ${rowNum}: ${issue}`);
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      preview,
      checksum: checksum(text),
      type: "identified",
      unitTotal: preview.reduce((n, p) => n + (p.quantity || 0), 0),
    };
  }

  function validateExpected(text) {
    const rows = parseCsv(text);
    const errors = [];
    const warnings = [];
    const preview = [];
    if (!rows.length) {
      return { ok: false, errors: ["File is empty"], warnings, preview, checksum: checksum(text) };
    }
    const idx = headerIndex(rows[0]);
    for (const col of EXPECTED_REQUIRED) {
      if (idx[col] == null) errors.push(`Missing required column: ${col}`);
    }
    if (errors.length) {
      return { ok: false, errors, warnings, preview, checksum: checksum(text), type: "expected" };
    }
    const seen = new Map();
    for (let r = 1; r < rows.length; r += 1) {
      const line = rows[r];
      const rowNum = r + 1;
      let sku = cell(line, idx, "sku").replace(/^['"]+|['"]+$/g, "");
      const description = cell(line, idx, "description");
      const qtyRaw = cell(line, idx, "expected_qty");
      const expectedQty = Number(qtyRaw);
      const issues = [];
      if (!sku) issues.push("sku required");
      if (!Number.isFinite(expectedQty) || expectedQty < 0) issues.push("expected_qty must be nonnegative");
      if (seen.has(sku)) {
        warnings.push(`Row ${rowNum}: duplicate SKU ${sku} — will aggregate on confirm under audited rule`);
      }
      seen.set(sku, (seen.get(sku) || 0) + (Number.isFinite(expectedQty) ? expectedQty : 0));
      preview.push({
        rowNum,
        sku,
        description,
        expected_qty: Number.isFinite(expectedQty) ? expectedQty : null,
        issues,
      });
      for (const issue of issues) errors.push(`Row ${rowNum}: ${issue}`);
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      preview,
      checksum: checksum(text),
      type: "expected",
    };
  }

  function commitIdentified(state, validation, options) {
    if (!validation.ok) throw new Error("Cannot commit invalid import");
    const batchId = options?.batchId || E.uuid();
    const replaceBatchId = options?.replaceBatchId || "";
    let events = state.events.slice();

    if (replaceBatchId) {
      for (const e of events) {
        if (e.importBatchId === replaceBatchId && e.status !== "void") {
          const result = E.voidEvent(events, e.eventId, `replaced by batch ${batchId}`);
          events = result.events;
        }
      }
    }

    // Idempotent: same checksum+batch already committed → no extra units.
    const existing = (state.importBatches || []).find(
      (b) => b.checksum === validation.checksum && b.type === "identified" && !b.replaced,
    );
    if (existing && !replaceBatchId) {
      return { state, batchId: existing.batchId, duplicate: true, added: 0 };
    }

    let added = 0;
    for (const row of validation.preview) {
      if (!state.areaOwner[row.area]) state.areaOwner[row.area] = row.zone;
      if (!state.zones.some((z) => z.id === row.zone)) {
        state.zones.push({ id: row.zone, name: row.zone, letter: row.zone });
      }
      const created = E.eventsFromQuantityRow({
        sku: row.sku,
        zone: row.zone,
        area: row.area,
        quantity: row.quantity,
        description: row.description,
        eventIdPrefix: `${batchId}-${row.rowNum}`,
      }, batchId);
      for (const ev of created) {
        const up = E.upsertEvent(events, ev);
        events = up.events;
        if (up.inserted) added += 1;
      }
    }

    state.events = events;
    state.importBatches = state.importBatches || [];
    state.importBatches.push({
      batchId,
      type: "identified",
      checksum: validation.checksum,
      added,
      unitTotal: validation.unitTotal,
      createdAt: E.nowIso(),
      replaced: false,
      replaces: replaceBatchId || "",
    });
    if (replaceBatchId) {
      for (const b of state.importBatches) {
        if (b.batchId === replaceBatchId) b.replaced = true;
      }
    }
    return { state, batchId, duplicate: false, added };
  }

  function commitExpected(state, validation, meta) {
    if (!validation.ok) throw new Error("Cannot commit invalid expected import");
    const aggregated = new Map();
    for (const row of validation.preview) {
      const prev = aggregated.get(row.sku) || { sku: row.sku, description: row.description, expected_qty: 0 };
      prev.expected_qty += Number(row.expected_qty) || 0;
      if (!prev.description && row.description) prev.description = row.description;
      aggregated.set(row.sku, prev);
    }
    state.expected = {
      loaded: true,
      snapshotDate: meta?.snapshotDate || new Date().toISOString().slice(0, 10),
      source: meta?.source || "csv-import",
      rows: [...aggregated.values()],
      checksum: validation.checksum,
      importedAt: E.nowIso(),
    };
    const batchId = E.uuid();
    state.importBatches = state.importBatches || [];
    state.importBatches.push({
      batchId,
      type: "expected",
      checksum: validation.checksum,
      added: state.expected.rows.length,
      createdAt: E.nowIso(),
      replaced: false,
    });
    return { state, batchId };
  }

  const TEMPLATES = {
    identified:
      'sku,description,zone,area,quantity,source,source_reference,notes\n001206538,"Sofa 99""",B,092,5,handwritten,sheet-1,\n',
    expected:
      'sku,description,expected_qty\n001206538,"Sofa 99""",2\n123456789,Sample SKU,2\n',
  };

  return {
    parseCsv,
    checksum,
    validateIdentified,
    validateExpected,
    commitIdentified,
    commitExpected,
    TEMPLATES,
  };
});
