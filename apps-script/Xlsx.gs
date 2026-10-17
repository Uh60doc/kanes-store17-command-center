/**
 * Minimal .xlsx writer: inline strings, a deduplicated style registry, merged cells, pictures, print areas, page
 * breaks and footers. Plain JavaScript (no Apps Script services) so the bytes are the same in tests and in Apps Script.
 */

function utf8Bytes_(text) {
  var out = [];
  var i;
  for (i = 0; i < text.length; i += 1) {
    var code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return new Uint8Array(out);
}

var BASE64_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Bytes_(text) {
  var clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
  var out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  var buffer = 0;
  var bits = 0;
  var n = 0;
  var i;
  for (i = 0; i < clean.length; i += 1) {
    buffer = (buffer << 6) | BASE64_.indexOf(clean.charAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n] = (buffer >> bits) & 255;
      n += 1;
    }
  }
  return out.subarray(0, n);
}

function bytesBase64_(bytes) {
  var parts = [];
  var i;
  for (i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var triple = (a << 16) | (b << 8) | c;
    parts.push(BASE64_.charAt((triple >> 18) & 63) + BASE64_.charAt((triple >> 12) & 63) +
      (i + 1 < bytes.length ? BASE64_.charAt((triple >> 6) & 63) : '=') + (i + 2 < bytes.length ? BASE64_.charAt(triple & 63) : '='));
  }
  return parts.join('');
}

var CRC_TABLE_ = null;

function crc32_(bytes) {
  if (!CRC_TABLE_) {
    CRC_TABLE_ = [];
    var n;
    for (n = 0; n < 256; n += 1) {
      var c = n;
      var k;
      for (k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE_.push(c >>> 0);
    }
  }
  var crc = 0xffffffff;
  var i;
  for (i = 0; i < bytes.length; i += 1) crc = CRC_TABLE_[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stored (uncompressed) ZIP archive of [{ name, bytes }]. */
function zipStore_(files) {
  var chunks = [];
  var central = [];
  var offset = 0;
  var le = function (value, size) {
    var out = [];
    var i;
    for (i = 0; i < size; i += 1) out.push((value >>> (8 * i)) & 255);
    return out;
  };
  files.forEach(function (file) {
    var name = utf8Bytes_(file.name);
    var data = file.bytes;
    var crc = crc32_(data);
    var head = [].concat(le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2));
    chunks.push(new Uint8Array(head), name, data);
    central.push([].concat(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(name.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4)));
    central.push(Array.prototype.slice.call(name));
    offset += head.length + name.length + data.length;
  });
  var centralBytes = [];
  central.forEach(function (part) { centralBytes = centralBytes.concat(part); });
  var end = [].concat(le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(centralBytes.length, 4), le(offset, 4), le(0, 2));
  chunks.push(new Uint8Array(centralBytes), new Uint8Array(end));
  var total = 0;
  chunks.forEach(function (chunk) { total += chunk.length; });
  var out = new Uint8Array(total);
  var at = 0;
  chunks.forEach(function (chunk) { out.set(chunk, at); at += chunk.length; });
  return out;
}

function xmlText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnLetter_(index) {
  var letters = '';
  var n = index;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Style registry: style objects become cellXfs indexes, with fonts, fills, borders and number formats deduplicated. */
function XlsxStyles_() {
  this.fonts = ['<font><sz val="10"/><color rgb="FF1B2833"/><name val="Calibri"/><family val="2"/></font>'];
  this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  this.numFmts = [];
  this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  this.keys = { '{}': 0 };
}

XlsxStyles_.prototype.index_ = function (list, xml, offset) {
  var at = list.indexOf(xml);
  if (at === -1) { list.push(xml); at = list.length - 1; }
  return at + (offset || 0);
};

XlsxStyles_.prototype.get = function (style) {
  style = style || {};
  var key = JSON.stringify(style);
  if (Object.prototype.hasOwnProperty.call(this.keys, key)) return this.keys[key];
  var font = '<font>' + (style.bold ? '<b/>' : '') + (style.italic ? '<i/>' : '') + '<sz val="' + (style.size || 10) + '"/><color rgb="FF' + (style.color || '1B2833') + '"/><name val="' + (style.font || 'Calibri') + '"/><family val="2"/></font>';
  var fontId = this.index_(this.fonts, font);
  var fillId = style.fill ? this.index_(this.fills, '<fill><patternFill patternType="solid"><fgColor rgb="FF' + style.fill + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
  var borderId = 0;
  if (style.border) {
    var edge = function (side) {
      var spec = style.border[side];
      if (!spec) return '<' + side + '/>';
      var parts = spec.split(' ');
      return '<' + side + ' style="' + parts[0] + '"><color rgb="FF' + (parts[1] || '9AA9B5') + '"/></' + side + '>';
    };
    borderId = this.index_(this.borders, '<border>' + edge('left') + edge('right') + edge('top') + edge('bottom') + '<diagonal/></border>');
  }
  var numFmtId = 0;
  if (style.format) {
    var builtIn = { '0': 1, '0.00': 2, '0%': 9, '0.00%': 10 };
    if (builtIn[style.format] !== undefined) numFmtId = builtIn[style.format];
    else numFmtId = this.index_(this.numFmts, style.format, 0) + 164;
  }
  var align = '';
  if (style.align || style.valign || style.wrap || style.indent) {
    align = '<alignment' + (style.align ? ' horizontal="' + style.align + '"' : '') + ' vertical="' + (style.valign || 'center') + '"' + (style.wrap ? ' wrapText="1"' : '') + (style.indent ? ' indent="' + style.indent + '"' : '') + '/>';
  }
  var xf = '<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"' +
    (numFmtId ? ' applyNumberFormat="1"' : '') + ' applyFont="1"' + (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') + (align ? ' applyAlignment="1">' + align + '</xf>' : '/>');
  this.xfs.push(xf);
  this.keys[key] = this.xfs.length - 1;
  return this.xfs.length - 1;
};

XlsxStyles_.prototype.xml = function () {
  var formats = this.numFmts.map(function (code, i) { return '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + xmlText_(code) + '"/>'; }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (this.numFmts.length ? '<numFmts count="' + this.numFmts.length + '">' + formats + '</numFmts>' : '') +
    '<fonts count="' + this.fonts.length + '">' + this.fonts.join('') + '</fonts>' +
    '<fills count="' + this.fills.length + '">' + this.fills.join('') + '</fills>' +
    '<borders count="' + this.borders.length + '">' + this.borders.join('') + '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
};

/** One worksheet. Rows and columns are 1-based. */
function XlsxSheet_(name, styles) {
  this.name = name;
  this.styles = styles;
  this.cells = {};
  this.heights = {};
  this.widths = [];
  this.merges = [];
  this.pictures = [];
  this.breaks = [];
  this.lastRow = 0;
  this.lastCol = 0;
  this.footer = '';
  this.margins = { left: 0.4, right: 0.4, top: 0.45, bottom: 0.55, header: 0.2, footer: 0.25 };
}

XlsxSheet_.prototype.set = function (row, col, value, style) {
  this.cells[row + ':' + col] = { value: value, style: this.styles.get(style) };
  if (row > this.lastRow) this.lastRow = row;
  if (col > this.lastCol) this.lastCol = col;
};

/** Writes the value in the first cell and styles every cell of the merged range so borders and fills are whole. */
XlsxSheet_.prototype.merge = function (row, col, toRow, toCol, value, style) {
  var r;
  var c;
  for (r = row; r <= toRow; r += 1) {
    for (c = col; c <= toCol; c += 1) this.set(r, c, r === row && c === col ? value : null, style);
  }
  if (toRow > row || toCol > col) this.merges.push(columnLetter_(col) + row + ':' + columnLetter_(toCol) + toRow);
};

XlsxSheet_.prototype.height = function (row, points) { this.heights[row] = points; };

XlsxSheet_.prototype.picture = function (media, row, col, widthIn, heightIn, offsetXIn, offsetYIn) {
  this.pictures.push({ media: media, row: row, col: col, cx: Math.round(widthIn * 914400), cy: Math.round(heightIn * 914400), dx: Math.round((offsetXIn || 0) * 914400), dy: Math.round((offsetYIn || 0) * 914400) });
};

XlsxSheet_.prototype.xml = function (drawingId) {
  var self = this;
  var rows = [];
  var r;
  for (r = 1; r <= this.lastRow; r += 1) {
    var cells = [];
    var c;
    for (c = 1; c <= this.lastCol; c += 1) {
      var cell = this.cells[r + ':' + c];
      if (!cell) continue;
      var ref = columnLetter_(c) + r;
      var value = cell.value;
      if (value === null || value === undefined || value === '') cells.push('<c r="' + ref + '" s="' + cell.style + '"/>');
      else if (typeof value === 'number' && isFinite(value)) cells.push('<c r="' + ref + '" s="' + cell.style + '"><v>' + value + '</v></c>');
      else cells.push('<c r="' + ref + '" s="' + cell.style + '" t="inlineStr"><is><t xml:space="preserve">' + xmlText_(value) + '</t></is></c>');
    }
    var height = this.heights[r];
    if (cells.length || height) rows.push('<row r="' + r + '"' + (height ? ' ht="' + height + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>');
  }
  var cols = this.widths.map(function (width, i) { return width ? '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>' : ''; }).join('');
  var m = this.margins;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    '<dimension ref="A1:' + columnLetter_(Math.max(1, this.lastCol)) + Math.max(1, this.lastRow) + '"/>' +
    '<sheetViews><sheetView showGridLines="0" zoomScale="100" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? '<cols>' + cols + '</cols>' : '') +
    '<sheetData>' + rows.join('') + '</sheetData>' +
    (this.merges.length ? '<mergeCells count="' + this.merges.length + '">' + this.merges.map(function (ref) { return '<mergeCell ref="' + ref + '"/>'; }).join('') + '</mergeCells>' : '') +
    '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="' + m.left + '" right="' + m.right + '" top="' + m.top + '" bottom="' + m.bottom + '" header="' + m.header + '" footer="' + m.footer + '"/>' +
    '<pageSetup paperSize="1" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' +
    (self.footer ? '<headerFooter><oddFooter>' + xmlText_(self.footer) + '</oddFooter></headerFooter>' : '') +
    (this.breaks.length ? '<rowBreaks count="' + this.breaks.length + '" manualBreakCount="' + this.breaks.length + '">' + this.breaks.map(function (row) { return '<brk id="' + row + '" max="16383" man="1"/>'; }).join('') + '</rowBreaks>' : '') +
    (drawingId ? '<drawing r:id="rId1"/>' : '') +
    '</worksheet>';
};

/** media: [{ name: 'image1.png', type: 'png', bytes }]; sheets: XlsxSheet_. Returns the file bytes. */
function xlsxWorkbook_(sheets, media, title) {
  var files = [];
  var add = function (name, text) { files.push({ name: name, bytes: utf8Bytes_(text) }); };
  var types = {};
  media.forEach(function (item) { types[item.type] = item.type === 'png' ? 'image/png' : 'image/jpeg'; });
  var overrides = sheets.map(function (sheet, i) {
    return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      (sheet.pictures.length ? '<Override PartName="/xl/drawings/drawing' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '');
  }).join('');
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    Object.keys(types).map(function (ext) { return '<Default Extension="' + ext + '" ContentType="' + types[ext] + '"/>'; }).join('') +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + overrides +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  add('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + xmlText_(title) + '</dc:title><dc:creator>Kane\'s Store 17 Command Center</dc:creator></cp:coreProperties>');
  add('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kane\'s Store 17 Command Center</Application></Properties>');
  var definedNames = sheets.map(function (sheet, i) {
    var quoted = "'" + sheet.name.replace(/'/g, "''") + "'";
    return '<definedName name="_xlnm.Print_Area" localSheetId="' + i + '">' + xmlText_(quoted + '!$A$1:$' + columnLetter_(sheet.lastCol) + '$' + sheet.lastRow) + '</definedName>';
  }).join('');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    sheets.map(function (sheet, i) { return '<sheet name="' + xmlText_(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
    '</sheets><definedNames>' + definedNames + '</definedNames><calcPr calcId="191029"/></workbook>');
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map(function (sheet, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
    '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  var styleSource = sheets.length ? sheets[0].styles : new XlsxStyles_();
  sheets.forEach(function (sheet, i) {
    var n = i + 1;
    add('xl/worksheets/sheet' + n + '.xml', sheet.xml(sheet.pictures.length ? n : 0));
    if (!sheet.pictures.length) return;
    add('xl/worksheets/_rels/sheet' + n + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + n + '.xml"/></Relationships>');
    var used = [];
    sheet.pictures.forEach(function (picture) { if (used.indexOf(picture.media) === -1) used.push(picture.media); });
    add('xl/drawings/_rels/drawing' + n + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      used.map(function (mediaName, j) { return '<Relationship Id="rId' + (j + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + mediaName + '"/>'; }).join('') + '</Relationships>');
    add('xl/drawings/drawing' + n + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      sheet.pictures.map(function (picture, j) {
        return '<xdr:oneCellAnchor><xdr:from><xdr:col>' + (picture.col - 1) + '</xdr:col><xdr:colOff>' + picture.dx + '</xdr:colOff><xdr:row>' + (picture.row - 1) + '</xdr:row><xdr:rowOff>' + picture.dy + '</xdr:rowOff></xdr:from>' +
          '<xdr:ext cx="' + picture.cx + '" cy="' + picture.cy + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (j + 2) + '" name="' + xmlText_(picture.media) + ' ' + (j + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
          '<xdr:blipFill><a:blip r:embed="rId' + (used.indexOf(picture.media) + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
          '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + picture.cx + '" cy="' + picture.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
      }).join('') + '</xdr:wsDr>');
  });
  add('xl/styles.xml', styleSource.xml());
  media.forEach(function (item) { files.push({ name: 'xl/media/' + item.name, bytes: item.bytes }); });
  return zipStore_(files);
}
