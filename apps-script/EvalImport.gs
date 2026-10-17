/**
 * Historical evaluation workbook upload. The original file is archived byte for byte before anything is read from
 * it. Each associate worksheet is read by its labels (Salesperson, GOALS, the metric names, Focus Metric, Action Plan,
 * Spotlight, signatures), so a moved row does not shift a value into the wrong metric. Every recorded value keeps the
 * sheet and cell it came from. A blank or placeholder cell stays missing; nothing is filled in.
 */

function xmlUnescape_(text) {
  return String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (all, code) { return String.fromCharCode(Number(code)); })
    .replace(/&#x([0-9a-f]+);/gi, function (all, code) { return String.fromCharCode(parseInt(code, 16)); })
    .replace(/&amp;/g, '&');
}

function xmlRunsText_(xml) {
  var out = [];
  var re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  var m;
  while ((m = re.exec(xml))) out.push(m[1] ? xmlUnescape_(m[1]) : '');
  return out.join('');
}

function cellRefParts_(ref) {
  var m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  var col = 0;
  var i;
  for (i = 0; i < m[1].length; i += 1) col = col * 26 + (m[1].charCodeAt(i) - 64);
  return { col: col, row: Number(m[2]) };
}

/** files: { 'xl/workbook.xml': '<xml…>', … }. Returns [{ name, hidden, cells: [{ ref, row, col, value }] }]. */
function xlsxCells_(files) {
  var workbook = files['xl/workbook.xml'];
  if (!workbook) throw new Error('This file is not an Excel .xlsx workbook.');
  var rels = {};
  String(files['xl/_rels/workbook.xml.rels'] || '').replace(/<Relationship\b[^>]*>/g, function (tag) {
    var id = /\bId="([^"]+)"/.exec(tag);
    var target = /\bTarget="([^"]+)"/.exec(tag);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    return tag;
  });
  var shared = [];
  String(files['xl/sharedStrings.xml'] || '').replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, function (all, inner) { shared.push(xmlRunsText_(inner)); return all; });
  var sheets = [];
  workbook.replace(/<sheet\b[^>]*>/g, function (tag) {
    var name = /\bname="([^"]*)"/.exec(tag);
    var rid = /\br:id="([^"]+)"/.exec(tag);
    var hidden = /\bstate="(hidden|veryHidden)"/.test(tag);
    var xml = rid ? files['xl/' + rels[rid[1]]] : '';
    var cells = [];
    String(xml || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (all, attrs, inner) {
      var ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      if (!ref || inner === undefined) return all;
      var type = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || 'n';
      var raw = /<v>([\s\S]*?)<\/v>/.exec(inner);
      var value = null;
      if (type === 's' && raw) value = shared[Number(raw[1])];
      else if (type === 'inlineStr') value = xmlRunsText_(inner);
      else if (type === 'str' && raw) value = xmlUnescape_(raw[1]);
      else if (type === 'b' && raw) value = raw[1] === '1';
      else if (raw) value = Number(raw[1]);
      if (value === null || value === undefined || value === '') return all;
      var parts = cellRefParts_(ref[1]);
      cells.push({ ref: ref[1], row: parts.row, col: parts.col, value: value });
      return all;
    });
    sheets.push({ name: name ? xmlUnescape_(name[1]) : '', hidden: hidden, cells: cells });
    return tag;
  });
  return sheets;
}

var EVAL_LABELS_ = [
  ['volume', /sales\s*volume/i], ['average', /average\s*sale|avg\.?\s*sale/i], ['mattress', /mattress\s*%|mattress.*total\s*sales/i],
  ['powerAdj', /power\s*adj/i], ['adjBase', /ad[ju]+stable\s*base|adj\.?\s*base/i], ['pillows', /pillow/i], ['protector', /protector/i],
  ['warranty', /warranty/i], ['fabric', /fabric/i], ['power', /power\s*upholstery|power\s*uph/i], ['leather', /leather/i],
  ['wood', /wood|uvwl|furniture\s*protection/i], ['finance', /financ/i], ['rugs', /rug/i],
];

function evalLabelKey_(text) {
  var found = '';
  EVAL_LABELS_.forEach(function (pair) { if (!found && pair[1].test(String(text))) found = pair[0]; });
  return found;
}

function excelSerialDate_(value) {
  if (typeof value !== 'number' || value < 20000 || value > 80000) return isoDate_(value);
  var ms = Date.UTC(1899, 11, 30) + Math.round(value) * 86400000;
  var date = new Date(ms);
  return date.getUTCFullYear() + '-' + pad2_(date.getUTCMonth() + 1) + '-' + pad2_(date.getUTCDate());
}

/** One associate worksheet in the established format, or null when the sheet is not an evaluation. */
function parseEvalSheet_(sheet) {
  var grid = {};
  sheet.cells.forEach(function (cell) { if (!grid[cell.row]) grid[cell.row] = {}; grid[cell.row][cell.col] = cell; });
  var text = function (cell) { return cell ? String(cell.value).trim() : ''; };
  var find = function (re) { return sheet.cells.filter(function (cell) { return typeof cell.value === 'string' && re.test(cell.value.trim()); }).sort(function (a, b) { return a.row - b.row || a.col - b.col; }); };
  var rightOf = function (cell, stop) {
    var row = grid[cell.row] || {};
    var cols = Object.keys(row).map(Number).filter(function (col) { return col > cell.col; }).sort(function (a, b) { return a - b; });
    var i;
    for (i = 0; i < cols.length; i += 1) {
      var next = row[cols[i]];
      if (stop && typeof next.value === 'string' && stop.test(next.value.trim())) return null;
      return next;
    }
    return null;
  };
  var below = function (cell, max, stop) {
    var r;
    for (r = cell.row + 1; r <= cell.row + max; r += 1) {
      var next = grid[r] && grid[r][cell.col];
      if (!next) continue;
      if (stop && typeof next.value === 'string' && stop.test(next.value.trim())) return null;
      return next;
    }
    return null;
  };
  var goalsHead = find(/^goals?$/i)[0];
  if (!goalsHead) return null;
  var salesperson = find(/^sales\s*(person|consultant)\s*:?$/i)[0];
  var nameCell = salesperson ? rightOf(salesperson, /^date\s*:?$/i) : null;
  var monthCells = Object.keys(grid[goalsHead.row] || {}).map(Number).filter(function (col) { return col > goalsHead.col; }).sort(function (a, b) { return a - b; }).slice(0, 3).map(function (col) { return grid[goalsHead.row][col]; });
  var focusRow = (find(/^focus\s*metric\s*#?\s*1\b/i)[0] || { row: goalsHead.row + 40 }).row;
  var metrics = [];
  var r;
  for (r = goalsHead.row + 1; r < focusRow; r += 1) {
    var row = grid[r];
    if (!row) continue;
    var labelCell = null;
    Object.keys(row).map(Number).sort(function (a, b) { return a - b; }).forEach(function (col) {
      if (!labelCell && col < goalsHead.col && typeof row[col].value === 'string') labelCell = row[col];
    });
    if (!labelCell) continue;
    var key = evalLabelKey_(labelCell.value);
    if (!key) continue;
    var goal = row[goalsHead.col] || null;
    metrics.push({
      key: key, label: text(labelCell), labelRef: labelCell.ref,
      goal: goal ? goal.value : null, goalRef: goal ? goal.ref : '',
      values: monthCells.map(function (head) { var cell = row[head.col]; return cell ? { value: cell.value, ref: cell.ref } : { value: null, ref: columnLetter_(head.col) + r }; }),
    });
  }
  if (!metrics.length) return null;
  var focusLabels = [find(/^focus\s*metric\s*#?\s*1\b(?!.*action)/i)[0], find(/^focus\s*metric\s*#?\s*2\b(?!.*action)/i)[0]];
  var priors = find(/^prior\s*month/i);
  var goalsEnd = find(/^goal\s*(at\s*)?end\s*of\s*month/i);
  var plans = [find(/focus\s*metric\s*#?\s*1.*action\s*plan/i)[0], find(/focus\s*metric\s*#?\s*2.*action\s*plan/i)[0]];
  var stopText = /signature|spotlight|recognition|focus\s*metric/i;
  var spotlight = find(/spotlight|recognition/i)[0];
  var comments = find(/overall.*comment|performance\s*comment/i)[0];
  var manager = find(/manager.?s?\s*name/i)[0];
  var hire = find(/hire\s*date/i)[0];
  var labelStop = /^(prior\s*month|goal\s*(at\s*)?end\s*of\s*month|focus\s*metric)/i;
  var valueOf = function (cell) { return cell ? cell.value : ''; };
  return {
    sheet: sheet.name,
    name: nameCell ? text(nameCell) : sheet.name,
    newHire: find(/new\s*hire/i).length > 0,
    hireDate: hire ? excelSerialDate_(valueOf(rightOf(hire))) : '',
    months: monthCells.map(function (cell) { return { text: text(cell), ref: cell.ref }; }),
    metrics: metrics,
    focus: [0, 1].map(function (i) {
      var label = focusLabels[i];
      var plan = plans[i] ? below(plans[i], 14, stopText) : null;
      var prior = priors[i] ? rightOf(priors[i], labelStop) : null;
      var target = goalsEnd[i] ? rightOf(goalsEnd[i], labelStop) : null;
      return { metric: label ? text(rightOf(label, labelStop)) : '', prior: valueOf(prior), goal: valueOf(target), plan: plan ? text(plan) : '' };
    }),
    recognition: spotlight ? text(below(spotlight, 10, /signature/i)) : '',
    comments: comments ? text(below(comments, 10, /signature/i)) : '',
    managerName: manager ? text(rightOf(manager)) : '',
  };
}

function monthIndexFromText_(value) {
  if (typeof value === 'number') {
    var iso = excelSerialDate_(value);
    return iso ? Number(iso.slice(5, 7)) - 1 : -1;
  }
  var lower = String(value || '').toLowerCase();
  var found = -1;
  EVAL_MONTH_NAMES_.forEach(function (name, i) { if (found === -1 && lower.indexOf(name.toLowerCase().slice(0, 3)) !== -1) found = i; });
  return found;
}

/** A workbook cell as a recorded value: numbers stay as reported; blanks and placeholders are Not Available. */
function importedValue_(metric, cell, goalCount) {
  var unit = metric.key === 'rugs' || goalCount ? 'count' : metric.unit;
  var value = cell ? cell.value : null;
  if (typeof value === 'number' && isFinite(value)) {
    if (unit === 'percent' && Math.abs(value) > 1.5) return { status: 'Verified', value: Math.round((value / 100) * 10000) / 10000, unit: unit, note: 'Recorded as ' + value + ' in the workbook; read as a percent.' };
    return { status: 'Verified', value: value, unit: unit, note: '' };
  }
  var textValue = String(value === null || value === undefined ? '' : value).trim();
  var numeric = textValue.replace(/[$,\s]/g, '');
  if (/^-?\d+(\.\d+)?%$/.test(numeric)) return { status: 'Verified', value: Number(numeric.replace('%', '')) / 100, unit: 'percent', note: '' };
  if (/^-?\d+(\.\d+)?$/.test(numeric)) return { status: 'Verified', value: Number(numeric), unit: unit, note: '' };
  return { status: 'Not Available', value: '', unit: unit, note: textValue && textValue !== '$' && textValue !== '%' ? 'Workbook shows "' + textValue + '".' : 'Blank in the workbook.' };
}

function readEvalWorkbook_(base64, fileName) {
  var bytes = Utilities.base64Decode(base64);
  var blobs = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', fileName));
  var files = {};
  blobs.forEach(function (blob) { var name = blob.getName(); if (/\.xml$|\.rels$/i.test(name)) files[name] = blob.getDataAsString('UTF-8'); });
  return { bytes: bytes, sha256: sha256Hex_(bytes), sheets: xlsxCells_(files) };
}

function planEvalImport_(cycle, read) {
  var info = evalCycleInfo_(cycle);
  var warnings = [];
  var parsed = [];
  read.sheets.forEach(function (sheet) {
    if (sheet.hidden) return;
    var result = parseEvalSheet_(sheet);
    if (!result) { warnings.push('Sheet "' + sheet.name + '" is not an associate evaluation and was not read.'); return; }
    if (/template/i.test(sheet.name) && !result.metrics.some(function (metric) { return metric.values.some(function (cell) { return typeof cell.value === 'number'; }); })) {
      warnings.push('Sheet "' + sheet.name + '" is a blank template and was not read.');
      return;
    }
    var monthIdx = result.months.map(function (month) { return monthIndexFromText_(month.text); });
    var expected = info.months.map(function (month) { return EVAL_MONTH_NAMES_.indexOf(month.name); });
    var monthsOk = monthIdx.length === 3 && monthIdx.every(function (value, i) { return value === expected[i]; });
    var match = rosterMatch_('', result.name) || rosterMatch_('', result.sheet);
    result.display = match ? match.name : result.name;
    result.employeeId = match ? match.employeeId : '';
    result.onRoster = !!match;
    result.monthsOk = monthsOk;
    if (!monthsOk) warnings.push(result.sheet + ': the month headers (' + result.months.map(function (month) { return month.text; }).join(', ') + ') are not ' + info.months.map(function (month) { return month.name; }).join(', ') + '.');
    if (!match) warnings.push(result.sheet + ': "' + result.name + '" is not on the roster. Add the person or an alias in Manage Associates first so the history attaches to the right record.');
    parsed.push(result);
  });
  var names = parsed.map(function (entry) { return entry.display; });
  names.forEach(function (name, i) { if (names.indexOf(name) !== i) warnings.push(name + ' appears on more than one worksheet.'); });
  return { info: info, parsed: parsed, warnings: warnings };
}

function importEvalWorkbook_(payload) {
  var cycle = String(payload.cycle || '');
  var fileName = String(payload.fileName || 'evaluation.xlsx').replace(/[\\\/]/g, '_').slice(0, 120);
  if (!/\.xlsx$/i.test(fileName)) throw new Error('Choose the .xlsx evaluation workbook.');
  var read = readEvalWorkbook_(String(payload.base64 || ''), fileName);
  var already = evalArchiveRows_().filter(function (entry) { return entry.sha256 === read.sha256; })[0];
  if (already) throw new Error('This exact workbook was already archived on ' + stampDay_(already.archivedAt) + ' as ' + already.fileName + '. Nothing was changed.');
  var plan = planEvalImport_(cycle, read);
  if (!plan.parsed.length) throw new Error('No associate evaluation worksheets were found in this workbook.');
  var saved = evalSavedRows_();
  plan.parsed.forEach(function (entry) {
    saved.forEach(function (row) { if (row.cycle === cycle && row.name === entry.display) throw new Error(entry.display + ' already has a ' + row.status + ' evaluation for ' + plan.info.label + '. Nothing was changed.'); });
  });
  var blocking = plan.parsed.filter(function (entry) { return !entry.onRoster || !entry.monthsOk; });
  var preview = {
    fileName: fileName, sha256: read.sha256, bytes: read.bytes.length, cycle: cycle, label: plan.info.label,
    covers: plan.info.months.map(function (month) { return month.label + ' (' + month.start + ' to ' + month.end + ')'; }),
    sheets: plan.parsed.map(function (entry) {
      var numbers = 0;
      var blanks = 0;
      entry.metrics.forEach(function (metric) { metric.values.forEach(function (cell) { if (importedValue_(EVAL_METRICS_.filter(function (m) { return m.key === metric.key; })[0], cell, false).status === 'Verified') numbers += 1; else blanks += 1; }); });
      return { sheet: entry.sheet, name: entry.display, onRoster: entry.onRoster, months: entry.months.map(function (month) { return month.text; }), metrics: entry.metrics.length, values: numbers, missing: blanks, focus: entry.focus.map(function (focus) { return focus.metric; }) };
    }),
    warnings: plan.warnings,
    canImport: blocking.length === 0,
  };
  if (payload.confirm !== true) return { confirmed: false, preview: preview };
  if (blocking.length) throw new Error('Fix the warnings first: ' + plan.warnings.join(' '));

  var original = archiveFile_(String(payload.base64), fileName, 'historical original', cycle, '', '', null, 'Uploaded by ' + payload.session.role + '. Sheets: ' + plan.parsed.map(function (entry) { return entry.sheet; }).join(', ') + '. Stored unchanged.');
  var stamp = new Date().toISOString();
  var metricsTab = evalTab_('CC_EvalMetrics', EVAL_METRIC_HEADERS_);
  var evalTab = evalTab_('CC_Evaluations', EVAL_HEADERS_);
  plan.parsed.forEach(function (entry) {
    entry.metrics.forEach(function (metric) {
      var definition = EVAL_METRICS_.filter(function (m) { return m.key === metric.key; })[0];
      var goalCount = typeof metric.goal === 'string' && /per\s*month/i.test(metric.goal);
      metric.values.forEach(function (cell, i) {
        var value = importedValue_(definition, cell, goalCount);
        metricsTab.appendRow([plan.info.months[i].key, entry.display, entry.employeeId, metric.key, value.value, value.unit, value.status, definition.source + ' as recorded in ' + fileName, value.note, stamp, payload.session.role, 'sha256 ' + read.sha256 + ' · ' + entry.sheet + '!' + cell.ref]);
      });
    });
    var volume = entry.metrics.filter(function (metric) { return metric.key === 'volume'; })[0];
    var volumeGoal = volume && typeof volume.goal === 'number' ? volume.goal : '';
    var goals = {};
    entry.metrics.forEach(function (metric) {
      if (metric.key === 'volume') return;
      var count = typeof metric.goal === 'string' ? /(\d+(?:\.\d+)?)\s*per\s*month/i.exec(metric.goal) : null;
      goals[metric.key] = typeof metric.goal === 'number' ? metric.goal : count ? { count: Number(count[1]) } : null;
    });
    var line = {
      cycle: cycle, name: entry.display, employee_id: entry.employeeId, status: 'Approved', revision: 1, template: entry.newHire ? 'newHire' : 'standard', volume_goal: volumeGoal,
      focus1_metric: entry.focus[0].metric, focus1_prior: String(entry.focus[0].prior), focus1_goal: String(entry.focus[0].goal), focus1_plan: entry.focus[0].plan,
      focus2_metric: entry.focus[1].metric, focus2_prior: String(entry.focus[1].prior), focus2_goal: String(entry.focus[1].goal), focus2_plan: entry.focus[1].plan,
      recognition: entry.recognition, comments: entry.comments, manager_name: entry.managerName, approved_at: stamp, approved_by: 'historical workbook', updated_at: stamp,
      source: 'historical workbook ' + fileName,
      note: 'Imported from ' + fileName + ' (sha256 ' + read.sha256 + '), worksheet ' + entry.sheet + '. Approval and delivery happened outside the Command Center; record the date given if it is known.',
      goals_json: JSON.stringify(goals),
    };
    evalTab.appendRow(EVAL_HEADERS_.map(function (key) { return line[key] === undefined ? '' : line[key]; }));
  });
  var context = evalContext_(cycle, todayNy_());
  var archiveTab = evalTab_('CC_EvalArchive', EVAL_ARCHIVE_HEADERS_);
  context.evaluations.forEach(function (evaluation) {
    if (!plan.parsed.some(function (entry) { return entry.display === evaluation.name; })) return;
    delete evaluation.draft;
    archiveTab.appendRow([stamp, cycle, evaluation.name, 1, 'approved evaluation (historical)', original.fileId, fileName, original.sha256, read.bytes.length, JSON.stringify(evaluation), 'Snapshot read from the archived original workbook.']);
  });
  var result = evals_({ session: payload.session, cycle: cycle });
  result.confirmed = true;
  result.saved = 'Archived ' + fileName + ' unchanged and recorded ' + plan.parsed.length + ' evaluation' + (plan.parsed.length === 1 ? '' : 's') + ' for ' + plan.info.label + '.';
  result.preview = preview;
  return result;
}
