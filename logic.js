/* Shared scan and count rules. Browser pages read globalThis.FloorLogic. */
(function (root, factory) {
  root.FloorLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const AS_IS_PREFIX = "999999999";

  /** Later zone names: A–Z, then A1, B1, … Z1, then A2, B2, and so on. */
  function zoneNameAt(index) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const n = Number(index);
    if (!Number.isInteger(n) || n < 0) return "";
    if (n < letters.length) return letters[n];
    const after = n - letters.length;
    return letters[after % letters.length] + String(Math.floor(after / letters.length) + 1);
  }

  function digitsOnly(value) {
    return String(value ?? "").replace(/\D/g, "");
  }

  function isAsIsPrefix(value) {
    return digitsOnly(value) === AS_IS_PREFIX;
  }

  /**
   * WIS area ticket: digits with an optional hyphen before the last digit.
   * Sample 0001-8 and 00018 are the same tag. Drop the first digit and the
   * last digit; the middle is the area id (001). A 9-digit product SKU is
   * never an area tag. The hyphen is ignored when reading the number.
   */
  function parseAreaTag(raw) {
    const compact = String(raw ?? "").trim().replace(/\s+/g, "");
    if (!compact) return null;
    // Hyphen sits immediately before the last digit: 0001-8.
    const hyphenForm = /^\d{2,}-\d$/.test(compact);
    // Same tag with the hyphen omitted: 00018. Four digits (the photo
    // barcode read "0001") are not an area tag.
    const digitForm = /^\d{5,8}$/.test(compact);
    if (!hyphenForm && !digitForm) return null;
    const digits = compact.replace(/\D/g, "");
    if (digits.length < 3 || digits.length > 8) return null;
    if (digits === AS_IS_PREFIX) return null;
    return {
      areaId: digits.slice(1, -1),
      raw: compact,
      digits,
    };
  }

  function matchesQuery(item, query) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return true;
    const group = String(item.groupName ?? "").toLowerCase();
    const description = String(item.description ?? "").toLowerCase();
    const sku = String(item.sku ?? "");
    const original = String(item.originalSku ?? "").toLowerCase();
    if (group.includes(q) || description.includes(q) || sku.toLowerCase().includes(q)) {
      return true;
    }
    if (original && original.includes(q)) return true;
    // "001-206-538" is a SKU. "Sofa 95" is not, even though it contains digits.
    if (/[a-z]/i.test(q)) return false;
    const digits = q.replace(/\D/g, "");
    return Boolean(digits) && sku.includes(digits);
  }

  function readQty(entry) {
    if (!entry) return { newQty: 0, asIsQty: 0 };
    return {
      newQty: Number(entry.new) || 0,
      asIsQty: Number(entry.asIs) || 0,
    };
  }

  function isSkuEntry(value) {
    return Boolean(value) && typeof value === "object" && ("new" in value || "asIs" in value);
  }

  function zoneQty(counts, zoneId, sku) {
    const zone = counts?.[zoneId];
    if (!zone) return { newQty: 0, asIsQty: 0 };
    if (isSkuEntry(zone[sku])) return readQty(zone[sku]);
    let newQty = 0;
    let asIsQty = 0;
    for (const areaId of Object.keys(zone)) {
      if (isSkuEntry(zone[areaId])) continue;
      const qty = readQty(zone[areaId]?.[sku]);
      newQty += qty.newQty;
      asIsQty += qty.asIsQty;
    }
    return { newQty, asIsQty };
  }

  function areaQty(counts, zoneId, areaId, sku) {
    return readQty(counts?.[zoneId]?.[areaId]?.[sku]);
  }

  function countedAnywhere(counts, sku) {
    if (!counts) return false;
    for (const zoneId of Object.keys(counts)) {
      const qty = zoneQty(counts, zoneId, sku);
      if (qty.newQty > 0 || qty.asIsQty > 0) return true;
    }
    return false;
  }

  function countStatus(counts, zoneId, sku) {
    const here = zoneQty(counts, zoneId, sku);
    const inZone = here.newQty > 0 || here.asIsQty > 0;
    const anywhere = countedAnywhere(counts, sku);
    if (inZone) return "zone";
    if (anywhere) return "any";
    return "none";
  }

  function pairCountRows(entries, sortMode) {
    const present = entries.filter((entry) => entry.newQty > 0 || entry.asIsQty > 0);
    present.sort((a, b) => {
      const group = String(a.groupName).localeCompare(String(b.groupName));
      if (group) return group;
      const description = String(a.description).localeCompare(String(b.description));
      if (description) return description;
      return String(a.sku).localeCompare(String(b.sku));
    });
    const paired = [];
    const news = [];
    const asIsRows = [];
    for (const entry of present) {
      if (entry.newQty > 0) {
        const row = { ...entry, condition: "new", qty: entry.newQty };
        news.push(row);
        paired.push(row);
      }
      if (entry.asIsQty > 0) {
        const row = { ...entry, condition: "asis", qty: entry.asIsQty };
        asIsRows.push(row);
        paired.push(row);
      }
    }
    if (sortMode === "new-first") return news.concat(asIsRows);
    if (sortMode === "asis-first") return asIsRows.concat(news);
    return paired;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function toCsv(headers, rows) {
    const lines = [headers.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(headers.map((header) => csvEscape(row[header])).join(","));
    }
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  function areaBuckets(zoneCounts) {
    const keys = Object.keys(zoneCounts);
    const nested = keys.some((key) => zoneCounts[key] && !isSkuEntry(zoneCounts[key]));
    if (!nested) return [[ "", zoneCounts ]];
    return keys.sort().map((areaId) => [areaId, zoneCounts[areaId] || {}]);
  }

  function buildExportRows(zones, counts, itemsBySku) {
    const rows = [];
    for (const zone of zones) {
      const buckets = areaBuckets(counts[zone.id] || {});
      for (const [areaId, bucket] of buckets) {
      const skus = Object.keys(bucket).sort();
      for (const sku of skus) {
        const entry = bucket[sku] || {};
        if (isSkuEntry(entry) === false) continue;
        const item = itemsBySku[sku];
        if (!item) continue;
        const base = {
          Zone: zone.letter != null ? zone.letter : (zone.name || ""),
          Area: areaId,
          "Group Name": item.groupName,
          Description: item.description,
          SKU: item.sku,
          "Original SKU": item.originalSku || "",
          "Sheet Condition": item.asIs ? "AS IS" : "",
          Vendor: item.vendor || "",
          "Vendor SKU": item.vendorSku || "",
          Finish: item.finish || "",
          Dimensions: item.dimensions || "",
          Site: item.site || "",
          Store: item.store || "",
          Locked: item.locked || "",
          Reserved: item.reserved || "",
          Transfers: item.transfers || "",
          Total: item.total || "",
          Source: item.source === "added" ? "Added" : "Catalog",
        };
        if ((Number(entry.new) || 0) > 0) {
          rows.push({ ...base, "Counted As": "New", Quantity: String(entry.new) });
        }
        if ((Number(entry.asIs) || 0) > 0) {
          rows.push({ ...base, "Counted As": "AS IS", Quantity: String(entry.asIs) });
        }
      }
      }
    }
    return rows;
  }

  const CSV_HEADERS = [
    "Zone",
    "Area",
    "Group Name",
    "Description",
    "SKU",
    "Original SKU",
    "Counted As",
    "Quantity",
    "Sheet Condition",
    "Vendor",
    "Vendor SKU",
    "Finish",
    "Dimensions",
    "Site",
    "Store",
    "Locked",
    "Reserved",
    "Transfers",
    "Total",
    "Source",
  ];

  return {
    AS_IS_PREFIX,
    CSV_HEADERS,
    zoneNameAt,
    digitsOnly,
    isAsIsPrefix,
    parseAreaTag,
    matchesQuery,
    zoneQty,
    areaQty,
    countedAnywhere,
    countStatus,
    pairCountRows,
    csvEscape,
    toCsv,
    buildExportRows,
  };
});
