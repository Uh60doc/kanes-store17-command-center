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

  /**
   * A zone scan is one letter, or one letter plus digits: A, B, A1, B1.
   * Numeric area tags and SKUs are not zone names.
   */
  function parseZoneName(raw) {
    const compact = String(raw ?? "").trim().replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]\d*$/.test(compact)) return null;
    return compact;
  }

  // Code 128 bar/space widths. Index is the symbol value. 106 is the stop.
  const CODE128 = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
  ];

  function code128Symbols(text) {
    const value = String(text ?? "");
    if (!value) return null;
    const symbols = [104];
    for (const ch of value) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) return null;
      symbols.push(code - 32);
    }
    let sum = symbols[0];
    for (let i = 1; i < symbols.length; i += 1) sum += symbols[i] * i;
    symbols.push(sum % 103);
    symbols.push(106);
    return symbols;
  }

  function code128Bits(text, quiet) {
    const symbols = code128Symbols(text);
    if (!symbols) return "";
    let bits = "";
    for (const symbol of symbols) {
      const pattern = CODE128[symbol];
      for (let i = 0; i < pattern.length; i += 1) {
        bits += (i % 2 === 0 ? "1" : "0").repeat(Number(pattern[i]));
      }
    }
    const pad = "0".repeat(quiet);
    return pad + bits + pad;
  }

  /** Code 128 symbol whose scanned data is exactly `text`. */
  function code128Svg(text, options) {
    const module = options?.module || 3;
    const height = options?.height || 96;
    const quiet = options?.quiet ?? 10;
    const bits = code128Bits(text, quiet);
    const width = bits.length * module;
    let x = 0;
    let bars = "";
    let i = 0;
    while (i < bits.length) {
      const on = bits[i] === "1";
      let j = i + 1;
      while (j < bits.length && bits[j] === bits[i]) j += 1;
      const w = (j - i) * module;
      if (on) bars += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
      x += w;
      i = j;
    }
    const label = String(text).replace(/[&<>"']/g, "");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges" role="img" aria-label="Code 128 ${label}"><rect width="${width}" height="${height}" fill="#fff"/>${bars}</svg>`;
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

  function zoneRank(name) {
    const match = String(name ?? "").match(/^([A-Z])(\d*)$/);
    if (!match) return [1, 0, String(name ?? "")];
    return [0, match[2] === "" ? 0 : Number(match[2]), match[1]];
  }

  function compareZoneNames(a, b) {
    const left = zoneRank(a);
    const right = zoneRank(b);
    if (left[0] !== right[0]) return left[0] - right[0];
    if (left[1] !== right[1]) return left[1] - right[1];
    return String(left[2]).localeCompare(String(right[2]));
  }

  function zoneLabel(zone) {
    if (!zone) return "";
    if (zone.letter != null && zone.letter !== "") return zone.letter;
    return zone.name || zone.id || "";
  }

  /** One line per scanned SKU. Sheet on-hand and total are previous, not the count. */
  function buildMasterLines(zones, counts, itemsBySku) {
    const lines = [];
    const ordered = [...(zones || [])].sort((a, b) => compareZoneNames(zoneLabel(a), zoneLabel(b)));
    for (const zone of ordered) {
      const name = zoneLabel(zone);
      const buckets = areaBuckets(counts?.[zone.id] || {});
      for (const [areaId, bucket] of buckets) {
        const skus = Object.keys(bucket).sort();
        for (const sku of skus) {
          const entry = bucket[sku];
          if (!isSkuEntry(entry)) continue;
          const item = itemsBySku?.[sku];
          if (!item) continue;
          const newQty = Number(entry.new) || 0;
          const asIsQty = Number(entry.asIs) || 0;
          if (newQty === 0 && asIsQty === 0) continue;
          lines.push({
            zone: name,
            area: areaId,
            groupName: item.groupName || "",
            description: item.description || "",
            sku: item.sku,
            newQty,
            asIsQty,
            totalPieces: newQty + asIsQty,
            previousOnHand: item.store ?? "",
            previousTotal: item.total ?? "",
          });
        }
      }
    }
    return lines;
  }

  const COUNT_HEADERS = [
    "Zone",
    "Area",
    "Group Name",
    "Description",
    "SKU",
    "Condition",
    "Quantity",
    "Previous on hand",
    "Previous total",
  ];

  const ZONE_HEADERS = [
    "Zone",
    "Area count",
    "New pieces",
    "AS IS pieces",
    "Total pieces",
  ];

  function buildCountSheetRows(lines) {
    const rows = [];
    for (const line of lines) {
      const base = {
        Zone: line.zone,
        Area: line.area,
        "Group Name": line.groupName,
        Description: line.description,
        SKU: line.sku,
        "Previous on hand": line.previousOnHand,
        "Previous total": line.previousTotal,
      };
      if (line.newQty > 0) rows.push({ ...base, Condition: "New", Quantity: String(line.newQty) });
      if (line.asIsQty > 0) rows.push({ ...base, Condition: "AS IS", Quantity: String(line.asIsQty) });
    }
    return rows;
  }

  function buildZoneSheetRows(lines) {
    const grouped = new Map();
    for (const line of lines) {
      if (!grouped.has(line.zone)) {
        grouped.set(line.zone, { areas: new Set(), newPieces: 0, asIsPieces: 0 });
      }
      const row = grouped.get(line.zone);
      row.areas.add(line.area);
      row.newPieces += line.newQty;
      row.asIsPieces += line.asIsQty;
    }
    const rows = [];
    for (const [zone, row] of grouped) {
      rows.push({
        Zone: zone,
        "Area count": String(row.areas.size),
        "New pieces": String(row.newPieces),
        "AS IS pieces": String(row.asIsPieces),
        "Total pieces": String(row.newPieces + row.asIsPieces),
      });
    }
    return rows;
  }

  function masterWorkbookCsv(countRows, zoneRows) {
    const counts = toCsv(COUNT_HEADERS, countRows).replace(/^\uFEFF/, "");
    const zones = toCsv(ZONE_HEADERS, zoneRows).replace(/^\uFEFF/, "");
    return `\uFEFF${counts}\r\n${zones}`;
  }

  function xmlEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]
    ));
  }

  function colLetters(index) {
    let n = index + 1;
    let letters = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  }

  function worksheetXml(headers, rows) {
    const grid = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
    const body = grid.map((cells, rowIndex) => {
      const cols = cells.map((value, colIndex) => {
        const ref = `${colLetters(colIndex)}${rowIndex + 1}`;
        const text = String(value ?? "");
        if (rowIndex > 0 && /^-?\d+$/.test(text)) {
          return `<c r="${ref}"><v>${text}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cols}</row>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  function u16(n) {
    return [n & 255, (n >> 8) & 255];
  }

  function u32(n) {
    return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
  }

  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) {
      c ^= data[i];
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function buildZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const local = new Uint8Array([
        ...u32(0x04034b50),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(name.length),
        ...u16(0),
      ]);
      localParts.push(local, name, data);
      centralParts.push(new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
      ]), name);
      offset += local.length + name.length + data.length;
    }
    const central = concatBytes(centralParts);
    const eocd = new Uint8Array([
      ...u32(0x06054b50),
      ...u16(0),
      ...u16(0),
      ...u16(files.length),
      ...u16(files.length),
      ...u32(central.length),
      ...u32(offset),
      ...u16(0),
    ]);
    return concatBytes([...localParts, central, eocd]);
  }

  function buildCountWorkbook(countRows, zoneRows) {
    const sheets = [
      { name: "Counts", headers: COUNT_HEADERS, rows: countRows },
      { name: "By zone", headers: ZONE_HEADERS, rows: zoneRows },
    ];
    const overrides = sheets.map((sheet, index) => (
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )).join("");
    const sheetTags = sheets.map((sheet, index) => (
      `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )).join("");
    const rels = sheets.map((sheet, index) => (
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )).join("");
    const files = [
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`,
      },
      {
        name: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      },
      {
        name: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
      },
    ];
    sheets.forEach((sheet, index) => {
      files.push({
        name: `xl/worksheets/sheet${index + 1}.xml`,
        data: worksheetXml(sheet.headers, sheet.rows),
      });
    });
    return buildZip(files);
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
    parseZoneName,
    code128Symbols,
    code128Svg,
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
    compareZoneNames,
    buildMasterLines,
    COUNT_HEADERS,
    ZONE_HEADERS,
    buildCountSheetRows,
    buildZoneSheetRows,
    masterWorkbookCsv,
    buildCountWorkbook,
  };
});
