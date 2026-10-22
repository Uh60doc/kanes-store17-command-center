import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
require("../logic.js");
const logic = globalThis.FloorLogic;
const root = path.dirname(fileURLToPath(import.meta.url));

test("zone scans are a letter or a letter plus digits", () => {
  assert.equal(logic.parseZoneName("A"), "A");
  assert.equal(logic.parseZoneName(" a1 "), "A1");
  assert.equal(logic.parseZoneName("Z1"), "Z1");
  assert.equal(logic.parseZoneName("C12"), "C12");
  assert.equal(logic.parseZoneName("0001-8"), null);
  assert.equal(logic.parseZoneName("00018"), null);
  assert.equal(logic.parseZoneName("001206538"), null);
  assert.equal(logic.parseZoneName("999999999"), null);
  assert.equal(logic.parseZoneName("AB"), null);
  assert.deepEqual(logic.code128Symbols("A"), [104, 33, 34, 106]);
  assert.deepEqual(logic.code128Symbols("A1"), [104, 33, 17, 68, 106]);
  assert.match(logic.code128Svg("A"), /<rect /);
  assert.doesNotMatch(logic.code128Svg("A"), />A</);
});

test("area tags drop the first and last digit", () => {
  const printed = logic.parseAreaTag("0001-8");
  assert.equal(printed.areaId, "001");
  assert.equal(printed.raw, "0001-8");
  assert.equal(printed.digits, "00018");
  assert.equal(logic.parseAreaTag("00018").areaId, "001");
  assert.equal(logic.parseAreaTag("00018").raw, "00018");
  assert.equal(logic.parseAreaTag("0002-4").areaId, "002");
  assert.equal(logic.parseAreaTag(" 0001 - 8 ").areaId, "001");
  assert.equal(logic.parseAreaTag("001206538"), null);
  assert.equal(logic.parseAreaTag("999999999"), null);
  assert.equal(logic.parseAreaTag("0001"), null);
  assert.equal(logic.parseAreaTag("001-206-538"), null);
  assert.equal(logic.digitsOnly("001206538"), "001206538");
});

test("later zone names continue past a single letter", () => {
  assert.equal(logic.zoneNameAt(0), "A");
  assert.equal(logic.zoneNameAt(1), "B");
  assert.equal(logic.zoneNameAt(25), "Z");
  assert.equal(logic.zoneNameAt(26), "A1");
  assert.equal(logic.zoneNameAt(27), "B1");
  assert.equal(logic.zoneNameAt(28), "C1");
  assert.equal(logic.zoneNameAt(51), "Z1");
  assert.equal(logic.zoneNameAt(52), "A2");
  assert.equal(logic.zoneNameAt(-1), "");
  assert.notEqual(logic.zoneNameAt(26).length, 1);
});

test("digits only and the AS IS prefix", () => {
  assert.equal(logic.digitsOnly("001-206 538x"), "001206538");
  assert.equal(logic.digitsOnly("001354113 (*)"), "001354113");
  assert.equal(logic.isAsIsPrefix("999999999"), true);
  assert.equal(logic.isAsIsPrefix("999-999-999"), true);
  assert.equal(logic.isAsIsPrefix("999999998"), false);
  assert.equal(logic.isAsIsPrefix("9999999990"), false);
});

test("paired rows keep AS IS directly under the new line", () => {
  const rows = logic.pairCountRows(
    [
      { sku: "000000002", groupName: "B", description: "Chair", newQty: 1, asIsQty: 2 },
      { sku: "000000001", groupName: "A", description: "Sofa", newQty: 3, asIsQty: 1 },
    ],
    "paired",
  );
  assert.deepEqual(
    rows.map((row) => [row.sku, row.condition]),
    [
      ["000000001", "new"],
      ["000000001", "asis"],
      ["000000002", "new"],
      ["000000002", "asis"],
    ],
  );
  const asIsFirst = logic.pairCountRows(
    [{ sku: "000000001", groupName: "A", description: "Sofa", newQty: 1, asIsQty: 1 }],
    "asis-first",
  );
  assert.deepEqual(asIsFirst.map((row) => row.condition), ["asis", "new"]);
});

test("search matches group, description, and sku digits", () => {
  const item = {
    sku: "001206538",
    originalSku: "",
    groupName: "BHLD",
    description: 'Sofa 99"',
  };
  assert.equal(logic.matchesQuery(item, "bhld"), true);
  assert.equal(logic.matchesQuery(item, "sofa"), true);
  assert.equal(logic.matchesQuery(item, "001-206-538"), true);
  assert.equal(logic.matchesQuery(item, "ottoman"), false);
  assert.equal(logic.matchesQuery({ ...item, description: "x Sofa 95\"" }, "x Sofa 95"), true);
  assert.equal(logic.matchesQuery(item, "x Sofa 95"), false);
});

test("zone status stays with the zone that was counted", () => {
  const counts = {
    front: { "001206538": { new: 1, asIs: 0 } },
    back: { "001206538": { new: 0, asIs: 2 } },
  };
  assert.equal(logic.countStatus(counts, "front", "001206538"), "zone");
  assert.equal(logic.countStatus(counts, "back", "001206538"), "zone");
  assert.equal(logic.countStatus(counts, "front", "009999999"), "none");
  assert.equal(logic.zoneQty(counts, "back", "001206538").asIsQty, 2);
  assert.equal(logic.zoneQty(counts, "front", "001206538").asIsQty, 0);
});

test("csv keeps new and AS IS on separate lines and escapes commas", () => {
  const item = {
    sku: "001206538",
    originalSku: "",
    groupName: "BHLD",
    description: 'Sofa, 99"',
    asIs: false,
    vendor: "BHLD",
    vendorSku: "BH4315",
    finish: "",
    dimensions: "3.42",
    site: "17",
    store: "1",
    locked: "0",
    reserved: "0",
    transfers: "0",
    total: "1",
    source: "catalog",
  };
  const rows = logic.buildExportRows(
    [{ id: "z1", name: "Front window" }],
    { z1: { "001206538": { new: 1, asIs: 1 } } },
    { "001206538": item },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Counted As"], "New");
  assert.equal(rows[1]["Counted As"], "AS IS");
  const csv = logic.toCsv(logic.CSV_HEADERS, rows);
  assert.match(csv, /Sofa, 99"/);
  assert.match(csv, /AS IS/);
  assert.equal(rows[0].Zone, "Front window");
  assert.equal(rows[0].Area, "");
});

test("nested areas export the area id with New and AS IS on separate lines", () => {
  const item = {
    sku: "001206538",
    originalSku: "",
    groupName: "BHLD",
    description: 'Sofa 99"',
    asIs: false,
    source: "catalog",
  };
  const rows = logic.buildExportRows(
    [{ id: "floor", letter: "" }],
    {
      floor: {
        "001": { "001206538": { new: 2, asIs: 1 } },
        "002": { "001206538": { new: 1, asIs: 0 } },
      },
    },
    { "001206538": item },
  );
  assert.deepEqual(
    rows.map((row) => [row.Zone, row.Area, row["Counted As"], row.Quantity]),
    [
      ["", "001", "New", "2"],
      ["", "001", "AS IS", "1"],
      ["", "002", "New", "1"],
    ],
  );
  assert.equal(logic.areaQty({ floor: { "001": { "001206538": { new: 2, asIs: 1 } } } }, "floor", "001", "001206538").newQty, 2);
});

test("master quantities come from scans, not previous on hand", () => {
  const item = {
    sku: "001206538",
    groupName: "BHLD",
    description: 'Sofa 99"',
    store: "1",
    total: "4",
  };
  const other = {
    sku: "001200001",
    groupName: "ACME",
    description: "Chair",
    store: "9",
    total: "9",
  };
  const lines = logic.buildMasterLines(
    [
      { id: "B", letter: "B" },
      { id: "A", letter: "A" },
      { id: "A1", letter: "A1" },
    ],
    {
      A: { "001": { "001206538": { new: 2, asIs: 1 } } },
      B: { "002": { "001200001": { new: 1, asIs: 0 } } },
      A1: {},
    },
    { "001206538": item, "001200001": other },
  );
  assert.deepEqual(lines.map((line) => [line.zone, line.area, line.sku, line.newQty, line.asIsQty, line.totalPieces]), [
    ["A", "001", "001206538", 2, 1, 3],
    ["B", "002", "001200001", 1, 0, 1],
  ]);
  assert.equal(lines[0].previousOnHand, "1");
  assert.notEqual(lines[0].totalPieces, Number(lines[0].previousOnHand));
  const countRows = logic.buildCountSheetRows(lines);
  assert.deepEqual(countRows.map((row) => [row.Zone, row.Area, row.SKU, row.Condition, row.Quantity]), [
    ["A", "001", "001206538", "New", "2"],
    ["A", "001", "001206538", "AS IS", "1"],
    ["B", "002", "001200001", "New", "1"],
  ]);
  const zoneRows = logic.buildZoneSheetRows(lines);
  assert.deepEqual(zoneRows.map((row) => [row.Zone, row["Area count"], row["New pieces"], row["AS IS pieces"], row["Total pieces"]]), [
    ["A", "1", "2", "1", "3"],
    ["B", "1", "1", "0", "1"],
  ]);
  const csv = logic.masterWorkbookCsv(countRows, zoneRows);
  assert.match(csv, /Previous on hand/);
  assert.match(csv, /Area count/);
  const bytes = logic.buildCountWorkbook(countRows, zoneRows);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /name="Counts"/);
  assert.match(text, /name="By zone"/);
  assert.match(text, /001206538/);
  assert.equal(logic.compareZoneNames("A", "B") < 0, true);
  assert.equal(logic.compareZoneNames("Z", "A1") < 0, true);
});

test("embedded catalog rows, sku digits, and leading-X AS IS marks", () => {
  const code = readFileSync(path.join(root, "..", "catalog.js"), "utf8");
  const catalog = vm.runInNewContext(code, {});
  // runInNewContext returns the completion value of the assignment expression.
  const data = catalog && catalog.items ? catalog : globalThis.FLOOR_CATALOG;
  assert.ok(data, "catalog loaded");
  assert.equal(data.rowCount, data.items.length);
  assert.equal(data.items.length, 4775);
  assert.equal(data.asIsCount, data.items.filter((item) => item.asIs).length);
  assert.equal(data.asIsCount, 759);
  const skus = new Set();
  for (const item of data.items) {
    assert.match(item.sku, /^\d+$/);
    assert.equal(skus.has(item.sku), false);
    skus.add(item.sku);
    if (item.originalSku) {
      assert.notEqual(item.originalSku, item.sku);
      assert.equal(item.originalSku.replace(/\D/g, ""), item.sku);
    }
    const marked = item.description.trim().startsWith("x") || item.description.trim().startsWith("X");
    assert.equal(item.asIs, marked);
  }
  assert.equal(skus.has("999999999"), false);
  const sofa = data.items.find((item) => item.sku === "001206538");
  assert.equal(sofa.groupName, "BHLD");
  assert.equal(sofa.description, 'Sofa 99"');
  assert.equal(sofa.asIs, false);
  assert.equal(sofa.vendorSku, "BH4315-03-2197-10");
  assert.equal(sofa.site, "17");
  const marked = data.items.find((item) => item.sku === "001353402");
  assert.equal(marked.asIs, true);
  assert.equal(marked.description.startsWith("x "), true);
  const dropped = data.items.find((item) => item.sku === "001354113");
  assert.equal(dropped.dropped, true);
  assert.match(dropped.originalSku, /\(\*\)/);
  assert.equal(dropped.asIs, true);
});
