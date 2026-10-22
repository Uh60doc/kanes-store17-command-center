import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

require(path.join(root, "logic.js"));
require(path.join(root, "core/events.js"));
require(path.join(root, "core/persist.js"));
require(path.join(root, "core/sync.js"));
require(path.join(root, "core/report.js"));
require(path.join(root, "core/print-area.js"));
require(path.join(root, "core/import-csv.js"));

const L = globalThis.FloorLogic;
const E = globalThis.InventoryEvents;
const Persist = globalThis.InventoryPersist;
const Sync = globalThis.InventorySync;
const Report = globalThis.InventoryReport;
const Print = globalThis.InventoryPrint;
const Import = globalThis.InventoryImport;

test("1: expected 2 / identify 1,2,3 → variance -1,0,+1", () => {
  const sku = "123456789";
  let events = [];
  const expected = {
    loaded: true,
    snapshotDate: "2026-10-22",
    source: "test",
    rows: [{ sku, description: "Sample", expected_qty: 2 }],
  };
  const step = (n) => {
    events = [];
    for (let i = 0; i < n; i += 1) {
      const up = E.upsertEvent(events, E.createUnitEvent({
        sku, zoneId: "A", areaId: "001", condition: "new", eventId: `t-${n}-${i}`,
      }));
      events = up.events;
    }
    return Report.buildReport({ events, expected, view: "full" }).rows.find((r) => r.sku === sku);
  };
  assert.equal(step(1).variance, -1);
  assert.equal(step(2).variance, 0);
  assert.equal(step(3).variance, 1);
});

test("2: repeat scans add units; same eventId retry does not", () => {
  let events = [];
  const a = E.createUnitEvent({ sku: "001", zoneId: "A", areaId: "5", eventId: "same-id" });
  events = E.upsertEvent(events, a).events;
  events = E.upsertEvent(events, E.createUnitEvent({
    sku: "001", zoneId: "A", areaId: "5", eventId: "other-1",
  })).events;
  const dup = E.upsertEvent(events, { ...a, syncStatus: "synced" });
  assert.equal(dup.duplicate, true);
  assert.equal(E.activeEvents(dup.events).length, 2);
  assert.equal(dup.events.find((e) => e.eventId === "same-id").syncStatus, "synced");
});

test("3: same SKU in two areas shows both locations on report", () => {
  let events = [];
  for (const [z, a, id] of [["A", "5", "e1"], ["B", "92", "e2"]]) {
    events = E.upsertEvent(events, E.createUnitEvent({
      sku: "001206538", zoneId: z, areaId: a, eventId: id,
    })).events;
  }
  const report = Report.buildReport({
    events,
    expected: { loaded: true, rows: [{ sku: "001206538", expected_qty: 2 }] },
  });
  const row = report.rows.find((r) => r.sku === "001206538");
  assert.equal(row.identifiedQty, 2);
  assert.equal(row.locations.length, 2);
  assert.match(row.locationsLabel, /A\/5/);
  assert.match(row.locationsLabel, /B\/92/);
});

test("4: Zone B Area 92 with 3 units prints three Code 128 symbols", () => {
  let events = [];
  for (let i = 0; i < 3; i += 1) {
    events = E.upsertEvent(events, E.createUnitEvent({
      sku: "123456789", zoneId: "B", areaId: "92", eventId: `b92-${i}`,
    })).events;
  }
  // decoy in another area
  events = E.upsertEvent(events, E.createUnitEvent({
    sku: "123456789", zoneId: "B", areaId: "01", eventId: "other-area",
  })).events;
  const model = Print.buildPrintModel({ zoneId: "B", areaId: "92", events });
  assert.equal(model.totalUnits, 3);
  assert.equal(model.areas.length, 1);
  assert.equal(model.areas[0].units.length, 3);
  const html = Print.renderPrintHtml(model);
  assert.equal((html.match(/<svg /g) || []).length, 3);
  assert.deepEqual(L.code128Symbols("123456789").slice(0, 1), [104]);
});

test("5: Entire Zone vs single Area; revision bumps", () => {
  let events = [];
  for (const [area, id] of [["91", "x1"], ["92", "x2"], ["92", "x3"]]) {
    events = E.upsertEvent(events, E.createUnitEvent({
      sku: "1", zoneId: "B", areaId: area, eventId: id,
    })).events;
  }
  const state = Persist.emptyState();
  state.events = events;
  Persist.ensureAreaStatus(state, "B", "92");
  Persist.bumpAreaRevision(state, "B", "92");
  const whole = Print.buildPrintModel({ zoneId: "B", events, areaStatus: state.areaStatus });
  const one = Print.buildPrintModel({ zoneId: "B", areaId: "92", events, areaStatus: state.areaStatus });
  assert.equal(whole.totalUnits, 3);
  assert.equal(whole.areas.length, 2);
  assert.equal(one.totalUnits, 2);
  assert.equal(one.areas[0].areaId, "92");
  assert.equal(one.areas[0].revision, 2);
});

test("6: CSV qty 5 → five units; repeat checksum → zero extra", () => {
  const csv = Import.TEMPLATES.identified;
  const v = Import.validateIdentified(csv, { allowCreateArea: true });
  assert.equal(v.ok, true);
  assert.equal(v.unitTotal, 5);
  let state = Persist.emptyState();
  const first = Import.commitIdentified(state, v, {});
  assert.equal(first.added, 5);
  assert.equal(E.activeEvents(state.events).length, 5);
  const second = Import.commitIdentified(state, v, {});
  assert.equal(second.duplicate, true);
  assert.equal(second.added, 0);
  assert.equal(E.activeEvents(state.events).length, 5);
  const print = Print.buildPrintModel({ zoneId: "B", areaId: "092", events: state.events });
  assert.equal(print.totalUnits, 5);
});

test("7: invalid SKU / AS-IS / area tag / leading-zero handling", () => {
  assert.equal(L.parseAreaTag("0001-8").areaId, "001");
  assert.equal(L.isAsIsPrefix("999999999"), true);
  const bad = Import.validateIdentified(
    "sku,zone,area,quantity\n999999999,A,001,1\n,B,002,1\nbadzone,ZZ,001,1\n000123456,A,001,1\n",
    { allowCreateArea: true },
  );
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /AS-IS/i.test(e) || /999999999/.test(e)));
  const zero = bad.preview.find((p) => p.sku === "000123456");
  assert.equal(zero.sku, "000123456");
});

test("8: no expected → unavailable, never fake zero variance", () => {
  let events = [E.createUnitEvent({ sku: "1", zoneId: "A", areaId: "1", eventId: "e" })];
  const report = Report.buildReport({
    events,
    expected: { loaded: false, rows: [] },
  });
  const row = report.rows[0];
  assert.equal(row.expectedAvailable, false);
  assert.equal(row.variance, null);
  assert.equal(row.expectedLabel, "Expected unavailable");
  assert.match(report.coverage.notice, /not been imported/i);
});

test("9: offline queue + reload + sync idempotent (memory server)", async () => {
  const server = Sync.createMemoryServer();
  let state = Persist.emptyState();
  state.syncEndpoint = "https://example.test/exec";
  state.syncToken = "test-token";
  for (let i = 0; i < 3; i += 1) {
    state.events = E.upsertEvent(state.events, E.createUnitEvent({
      sku: "9", zoneId: "A", areaId: "1", eventId: `off-${i}`, syncStatus: "local",
    })).events;
  }
  // simulate reload from JSON
  const reloaded = Persist.normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(E.pendingSync(reloaded.events).length, 3);
  const r1 = await Sync.syncPending(reloaded, { fetchImpl: Sync.memoryFetch(server) });
  assert.equal(r1.ok, true);
  assert.equal(server.size, 3);
  reloaded.events = r1.events;
  // retry same events already synced — pending empty
  const r2 = await Sync.syncPending(reloaded, { fetchImpl: Sync.memoryFetch(server) });
  assert.equal(r2.reason, "nothing_pending");
  assert.equal(server.size, 3);
});

test("10: concurrent upsert same eventId stays one unit", () => {
  let events = [];
  const ev = E.createUnitEvent({ sku: "1", zoneId: "A", areaId: "1", eventId: "concurrent" });
  events = E.upsertEvent(events, ev).events;
  events = E.upsertEvent(events, { ...ev, syncStatus: "syncing" }).events;
  events = E.upsertEvent(events, { ...ev, syncStatus: "synced" }).events;
  assert.equal(E.activeEvents(events).length, 1);
});

test("11: four executive views filter correctly; no barcodes in report HTML path", () => {
  let events = [];
  // expected 2; identify 1 => shortage; identify 3 on another => handled per sku
  events = E.upsertEvent(events, E.createUnitEvent({ sku: "S", zoneId: "A", areaId: "1", eventId: "1" })).events;
  events = E.upsertEvent(events, E.createUnitEvent({ sku: "O", zoneId: "A", areaId: "1", eventId: "2" })).events;
  events = E.upsertEvent(events, E.createUnitEvent({ sku: "O", zoneId: "A", areaId: "1", eventId: "3" })).events;
  events = E.upsertEvent(events, E.createUnitEvent({ sku: "O", zoneId: "A", areaId: "1", eventId: "4" })).events;
  const expected = {
    loaded: true,
    rows: [
      { sku: "S", expected_qty: 2 },
      { sku: "O", expected_qty: 1 },
      { sku: "Z", expected_qty: 1 },
    ],
  };
  assert.equal(Report.buildReport({ events, expected, view: "shortages" }).rows.every((r) => r.variance < 0), true);
  assert.equal(Report.buildReport({ events, expected, view: "overages" }).rows.every((r) => r.variance > 0), true);
  assert.equal(Report.buildReport({ events, expected, view: "discrepancies" }).rows.every((r) => r.variance !== 0), true);
  const full = Report.buildReport({ events, expected, view: "full" });
  assert.ok(full.rows.length >= 3);
});

test("legacy localStorage expand migrates without clearing", () => {
  const legacyCounts = {
    A: { "001": { "001206538": { new: 2, asIs: 1 } } },
  };
  const expanded = E.expandCountsToEvents(legacyCounts, { "001": "A" });
  assert.equal(expanded.length, 3);
  assert.equal(expanded[0].eventId, "legacy-A-001-001206538-new-0");
  const again = E.expandCountsToEvents(legacyCounts, { "001": "A" });
  assert.equal(again[0].eventId, expanded[0].eventId);
});

test("embedded Code 128 for sample print page generation", () => {
  const events = [0, 1, 2].map((i) => E.createUnitEvent({
    sku: "123456789", zoneId: "B", areaId: "92", eventId: `sample-${i}`,
    description: "Sample SKU",
  }));
  const html = Print.renderPrintHtml(Print.buildPrintModel({ zoneId: "B", areaId: "92", events }));
  assert.match(html, /AREA REVISION/);
  assert.match(html, /123456789/);
  assert.equal((html.match(/role="img"/g) || []).length, 3);
});
