var KPI_ALIASES_ = {
  'RENZO DEL SOLAR': ['RDELSO', 'Renzo Del Solar'],
  'RENZO DELSOLAR': ['RDELSO', 'Renzo Del Solar'],
  'DELSOLAR, RENZO': ['RDELSO', 'Renzo Del Solar'],
  'PRAKASH GANDHI': ['PGANDH', 'Prakash Gandhi'],
  'PRAKASH B GANDHI': ['PGANDH', 'Prakash Gandhi'],
  'GANDHI, PRAKASH': ['PGANDH', 'Prakash Gandhi'],
  'ERIC MONTES': ['EMON0904', 'Eric Montes Rodriguez'],
  'ERIC MONTES RODRIGUEZ': ['EMON0904', 'Eric Montes Rodriguez'],
  'MONTES, ERIC': ['EMON0904', 'Eric Montes Rodriguez'],
  'TARIK NASSIF': ['TNASSI', 'Ricky Nassif'],
  'RICKY NASSIF': ['TNASSI', 'Ricky Nassif'],
  'NASSIF, TARIK': ['TNASSI', 'Ricky Nassif'],
  'BRENDA SANCHEZ': ['', 'Brenda Sanchez'],
  'CAROLINE AMARO': ['', 'Caroline Amaro'],
  'CORDELL PRIMOUS': ['CPRI0909', 'Cordell Primous'],
  'PRIMOUS, CORDELL': ['CPRI0909', 'Cordell Primous'],
  'JAMES MEYERS': ['JMEYERS', 'Kelly Meyers'],
  'KELLY MEYERS': ['JMEYERS', 'Kelly Meyers'],
  'MEYERS, JAMES': ['JMEYERS', 'Kelly Meyers'],
  'ELIZABETH PEREZ': ['EPEREZ', 'Elizabeth Perez'],
  'PEREZ, ELIZABETH': ['EPEREZ', 'Elizabeth Perez'],
  'VALENTINA LOPEZ': ['', 'Valentina Lopez'],
  /** Display-only. GM does not recognize Maria Rafalik — leave unmatched on purpose (no roster row). */
  'MARIA RAFALIK': ['', 'Maria Rafalik'],
  'MUKHTAR JUNAID': ['', 'Mukhtar Junaid'],
  'MUKHTAR, JUNAID': ['', 'Mukhtar Junaid'],
  'JUNAID, MUKHTAR': ['', 'Mukhtar Junaid'],
  'JUNAID MUKHTAR': ['', 'Mukhtar Junaid'],
  'CHAVES FELIPE': ['', 'Filepe Chaves'],
  'CHAVES, FELIPE': ['', 'Filepe Chaves'],
  'FELIPE CHAVES': ['', 'Filepe Chaves'],
  'FILEPE CHAVES': ['', 'Filepe Chaves'],
  'CHAVES, FILEPE': ['', 'Filepe Chaves'],
  'FILIPE CHAVES': ['', 'Filepe Chaves']
};

function importKpiAttachment_(sha, attachment) {
  var name = attachment.getName();
  var match = name.match(/DATA_ANALYSIS_KPI_(17|ASL)_(WRITTEN|DELIVERED)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i);
  if (!match) {
    recordImport_(sha, name, 'logged-not-daily', 'The spreadsheet is on record. Store totals were not changed.');
    return true;
  }
  var family = match[1].toLowerCase() === 'asl' ? 'asl' : 'group17';
  var side = match[2].toLowerCase() === 'delivered' ? 'delivered' : 'written';
  var start = match[3];
  var end = match[4];
  var grid;
  try {
    grid = kpiGrid_(attachment.copyBlob().setName(name));
  } catch (error) {
    recordImport_(sha, name, 'needs-review', 'The Data Analysis workbook could not be read. No figure was changed.');
    appendException_('Update Failed', name + ' could not be read.');
    return true;
  }
  if (start !== end) {
    var final = recordKpiFinal_(grid, family, side, start, end, name);
    if (final) {
      recordImport_(sha, name, 'official-final', side + ' ' + start + ' through ' + end + ': official month-end final for the ' + (final.track === 'STORE' ? 'store' : 'salesperson') + ' month, ' + final.rows + ' figures recorded beside the daily record (CC_MonthEnd). Not added to the daily totals.');
      return true;
    }
    var snapshot = recordKpiSnapshot_(grid, family, side, start, end, name);
    if (snapshot) {
      if (typeof refreshStoreKpiQuietly_ === 'function') refreshStoreKpiQuietly_(end);
      recordImport_(sha, name, 'imported', side + ' ' + start + ' through ' + end + ': ' + (snapshot.store ? 'store' : 'salesperson') + ' month-to-date snapshot, ' + snapshot.rows + ' figures. Days inside that snapshot are not added again.');
      return true;
    }
    recordImport_(sha, name, 'cumulative-not-added', side + ' ' + start + ' through ' + end + ' was not added. A month-to-date file has to start on the 2nd for the store or the 1st for salespeople, and end before today.');
    return true;
  }
  var records = kpiRecords_(grid, family, side, start, end, name);
  if (!records.length) {
    recordImport_(sha, name, 'needs-review', 'No Store 17 Data Analysis rows were found. No figure was changed.');
    return true;
  }
  upsertKpiRecords_(records);
  records.forEach(function (record) {
    if (record[0] === 'BEDDING_STORE' && record[14] !== '') upsertDailyBedding_(start, side, record[14], name);
  });
  var grain = start === end ? 'daily' : 'cumulative';
  recordImport_(sha, name, grain === 'daily' ? 'imported' : 'cumulative-not-added', side + ' ' + start + ' through ' + end + '. Store NWDSR totals were not changed.');
  return true;
}

function kpiGrid_(blob) {
  var created = Drive.Files.insert({ title: 'CC kpi ' + new Date().getTime(), mimeType: MimeType.GOOGLE_SHEETS }, blob, { convert: true });
  try {
    return SpreadsheetApp.openById(created.id).getSheets()[0].getDataRange().getValues();
  } finally {
    DriveApp.getFileById(created.id).setTrashed(true);
  }
}

function kpiIdentity_(name) {
  var key = String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!key || key === 'TOTAL' || key === 'ASL TOTAL' || /^\d+$/.test(key)) return null;
  var known = KPI_ALIASES_[key];
  if (known) return { code: known[0], display: known[1] };
  var match = typeof rosterMatch_ === 'function' ? rosterMatch_('', name) : null;
  if (match) return { code: match.employeeId, display: match.name, roster: true };
  return { code: '', display: String(name).trim().replace(/\s+/g, ' '), unmatched: true };
}

function kpiBlankZero_(qualified, sold, dollars) {
  if (sold === null && qualified !== null && qualified !== 0) return { sold: 0, dollars: dollars === null ? 0 : dollars };
  return { sold: sold, dollars: dollars };
}

function kpiRate_(sold, qualified) {
  if (sold === null || qualified === null || qualified === 0) return null;
  return Math.round((sold / qualified) * 1000) / 1000;
}

/** Order count is printed sales ÷ printed average ticket. Only a whole number is trusted. */
function kpiOrders_(sales, average) {
  if (sales === null || sales === 0) return 0;
  if (!average) return null;
  var count = sales / average;
  return Math.abs(count - Math.round(count)) < 0.02 ? Math.round(count) : null;
}

function kpiPrinted_(value) {
  var number = kpiNumber_(value);
  return number === null ? null : Math.round(number * 10) / 1000;
}

// A daily report is complete for its date, so a blank figure there is zero and a blank rate is 0%.
function kpiZeroFill_(grid, columns) {
  var sub = grid[1] || [];
  return grid.map(function (row, r) {
    if (r < 2) return row;
    return sub.map(function (label, i) {
      var blank = row[i] === '' || row[i] === null || row[i] === undefined;
      return blank && i !== columns.name && String(label || '').trim() ? 0 : row[i];
    });
  });
}

function kpiColumns_(grid) {
  var groups = [];
  var current = '';
  var header = grid[0] || [];
  var sub = grid[1] || [];
  var i;
  for (i = 0; i < header.length; i += 1) {
    if (String(header[i] || '').trim()) current = String(header[i]).trim().toUpperCase();
    groups[i] = current;
  }
  var mapped = { name: 0, sales: 1, average: 2, finance: 3, groups: {} };
  for (i = 0; i < sub.length; i += 1) {
    var label = String(sub[i] || '').trim().toUpperCase();
    var group = groups[i] || '';
    if (label === 'SALES PERSON' || label === 'STORE') mapped.name = i;
    if (group === 'WRITTEN ORDERS' || group === 'DELIVERED ORDERS' || group === 'STORE 17' || group.indexOf('GROUP') === 0) {
      if (label === 'SALES') mapped.sales = i;
      if (label === 'AVG SALES') mapped.average = i;
      if (label === 'FIN %') mapped.finance = i;
      continue;
    }
    if (!mapped.groups[group]) mapped.groups[group] = {};
    mapped.groups[group][label] = i;
  }
  return mapped;
}

function kpiCell_(row, index) {
  if (index === undefined || index === null) return null;
  var value = row[index];
  if (value === '' || value === null || value === undefined) return null;
  return value;
}

function kpiMoney_(value) {
  var number = kpiNumber_(value);
  return number === null ? null : Math.round(number * 100) / 100;
}

function kpiNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var number = Number(String(value).replace(/,/g, ''));
  return isFinite(number) ? number : null;
}

function kpiQty_(row, group) {
  if (!group) return null;
  var qualified = kpiNumber_(kpiCell_(row, group['QUAL QTY']));
  var counted = kpiBlankZero_(qualified, kpiNumber_(kpiCell_(row, group['SOLD QTY'])), kpiMoney_(kpiCell_(row, group['SOLD $'])));
  if (qualified === null && counted.sold === null && counted.dollars === null) return null;
  var rate = kpiRate_(counted.sold, qualified);
  return { qual: qualified, sold: counted.sold, dollars: counted.dollars, percent: rate === null ? kpiPrinted_(kpiCell_(row, group['ATTACH %'])) : rate };
}

/** ADJ PWR % is printed on a 0–100 scale, same as the other attachment percents. */
function kpiPwr_(row, group) {
  if (!group || group['PWR %'] === undefined) return null;
  return kpiPrinted_(kpiCell_(row, group['PWR %']));
}

function kpiRecords_(source, family, side, start, end, filename) {
  var columns = kpiColumns_(source);
  var daily = start === end;
  var grid = daily ? kpiZeroFill_(source, columns) : source;
  var records = [];
  var r;
  for (r = 2; r < grid.length; r += 1) {
    var row = grid[r];
    var name = String(kpiCell_(row, columns.name) || '').trim();
    if (!name) continue;
    var upper = name.toUpperCase();
    var storeLine = family === 'asl' ? name === '17' : upper === 'TOTAL';
    var identity = storeLine ? null : kpiIdentity_(name);
    if (!storeLine && !identity) continue;
    if (family === 'asl' && !storeLine) continue;
    var scope = storeLine ? 'STORE' : 'PERSON';
    var code = identity ? identity.code : '';
    var display = identity ? identity.display : '';
    var beddingGroup = columns.groups['WRITTEN BEDDING'] || columns.groups['DELIVERED BEDDING'] || {};
    var beddingDollars = kpiMoney_(kpiCell_(row, beddingGroup.SALES));
    var sales = kpiMoney_(kpiCell_(row, columns.sales));
    var beddingPercent = sales && beddingDollars !== null ? kpiRate_(beddingDollars, sales) : kpiPrinted_(kpiCell_(row, beddingGroup['%']));
    if (family === 'group17') {
      if (sales !== null) {
        records.push(kpiRecord_(daily, start, end, 'DA_SALES_' + scope, code, display, side, sales, kpiOrders_(sales, kpiMoney_(kpiCell_(row, columns.average))), null, null, null, filename));
      }
      if (beddingDollars !== null || beddingPercent !== null) {
        records.push(kpiRecord_(daily, start, end, 'BEDDING_' + scope, code, display, side, beddingDollars, null, null, null, beddingPercent, filename));
      }
      [
        ['FABW_' + scope, columns.groups.FABRIC],
        ['PWAR_' + scope, columns.groups['POWER FURNITURE'] || columns.groups.POWER],
        ['LTHW_' + scope, columns.groups.LEATHER],
        ['MPPA_' + scope, columns.groups['MATTRESS PADS']],
        ['ATTACH_' + scope, columns.groups['TOTAL ATTACHMENTS %'] || columns.groups['TOTAL ATTACHMENTS']],
        ['PILLOWS_' + scope, columns.groups.PILLOWS],
        ['BASES_' + scope, columns.groups.ADJ],
        ['FP_' + scope, columns.groups['FURNITURE PROTECTION']],
        ['PET_' + scope, columns.groups['PET PROTECTIONS']]
      ].forEach(function (spec) {
        var qty = kpiQty_(row, spec[1]);
        if (!qty) return;
        records.push(kpiRecord_(daily, start, end, spec[0], code, display, side, qty.dollars, qty.sold, qty.qual, qty.sold, qty.percent, filename));
      });
      var rugsGroup = columns.groups.RUGS;
      if (rugsGroup) {
        var personRugsQty = kpiNumber_(kpiCell_(row, rugsGroup['SOLD QTY']));
        var personRugsDollars = kpiMoney_(kpiCell_(row, rugsGroup['SOLD $']));
        if (personRugsQty !== null || personRugsDollars !== null) records.push(kpiRecord_(daily, start, end, 'RUGS_' + scope, code, display, side, personRugsDollars, personRugsQty, null, personRugsQty, null, filename));
      }
      var personPwr = kpiPwr_(row, columns.groups.ADJ);
      if (personPwr !== null) records.push(kpiRecord_(daily, start, end, 'PWRBASE_' + scope, code, display, side, null, null, null, null, personPwr, filename));
      var finance = kpiNumber_(kpiCell_(row, columns.finance));
      if (finance !== null) {
        records.push(kpiRecord_(daily, start, end, 'FINANCE_' + scope, code, display, side, null, null, null, null, Math.round(finance * 10) / 1000, filename));
      }
      var average = kpiMoney_(kpiCell_(row, columns.average));
      if (average !== null) {
        records.push(kpiRecord_(daily, start, end, 'AVERAGE_' + scope, code, display, side, average, null, null, null, null, filename));
      }
    }
    if (family === 'asl' && storeLine) {
      var pillows = kpiQty_(row, columns.groups.PILLOWS);
      var bases = kpiQty_(row, columns.groups.ADJ);
      var protection = kpiQty_(row, columns.groups['FURNITURE PROTECTION']);
      var rugsQty = columns.groups.RUGS ? kpiNumber_(kpiCell_(row, columns.groups.RUGS['SOLD QTY'])) : null;
      var rugsDollars = columns.groups.RUGS ? kpiMoney_(kpiCell_(row, columns.groups.RUGS['SOLD $'])) : null;
      var pet = kpiQty_(row, columns.groups['PET PROTECTIONS']);
      var pwr = kpiPwr_(row, columns.groups.ADJ);
      if (pillows) records.push(kpiRecord_(daily, start, end, 'PILLOWS_STORE', '', '', side, pillows.dollars, pillows.sold, pillows.qual, pillows.sold, pillows.percent, filename));
      if (bases) records.push(kpiRecord_(daily, start, end, 'BASES_STORE', '', '', side, bases.dollars, bases.sold, bases.qual, bases.sold, bases.percent, filename));
      if (protection) records.push(kpiRecord_(daily, start, end, 'FP_STORE', '', '', side, protection.dollars, protection.sold, protection.qual, protection.sold, protection.percent, filename));
      if (pet) records.push(kpiRecord_(daily, start, end, 'PET_STORE', '', '', side, pet.dollars, pet.sold, pet.qual, pet.sold, pet.percent, filename));
      if (rugsQty !== null || rugsDollars !== null) records.push(kpiRecord_(daily, start, end, 'RUGS_STORE', '', '', side, rugsDollars, rugsQty, null, rugsQty, null, filename));
      if (pwr !== null) records.push(kpiRecord_(daily, start, end, 'PWRBASE_STORE', '', '', side, null, null, null, null, pwr, filename));
    }
  }
  return records;
}

/**
 * A month-to-date Data Analysis file that starts on its track's first day and ends before today is the catch-up
 * snapshot. The store track starts on the 2nd; the salesperson track starts on the 1st. Days inside the snapshot
 * are never added again. A file that includes today is not a finished snapshot.
 */
function recordKpiSnapshot_(grid, family, side, start, end, filename) {
  var today = typeof todayNy_ === 'function' ? todayNy_() : '';
  if (!today || !start || !end || end >= today) return null;
  var storePeriod = storePeriodContaining_(start);
  var personPeriod = individualPeriodContaining_(start);
  var storeFit = storePeriod.start === start && end <= storePeriod.end;
  var personFit = personPeriod.start === start && end <= personPeriod.end;
  var records = kpiRecords_(grid, family, side, start, end, filename).filter(function (record) {
    return /_STORE$/.test(record[0]) ? storeFit : personFit;
  });
  if (!records.length) return null;
  return { store: storeFit, person: personFit, rows: records.length, outcome: upsertKpiRecords_(records), end: end };
}

/**
 * A Data Analysis workbook printed for exactly one finished month is that month's official final. A store-month file
 * keeps its Store 17 lines, a salesperson-month file its salesperson lines: each track only takes its own scope.
 * Returns null when the period is not a finished month or the file has no line for that track.
 */
function recordKpiFinal_(grid, family, side, start, end, filename) {
  var track = officialFinalTrack_(start, end, todayNy_());
  if (!track) return null;
  var suffix = track === 'STORE' ? /_STORE$/ : /_PERSON$/;
  var records = kpiRecords_(grid, family, side, start, end, filename).filter(function (record) { return suffix.test(record[0]); });
  if (!records.length) return null;
  return { track: track, rows: records.length, outcome: upsertKpiRecords_(records) };
}

function kpiRecord_(daily, start, end, view, code, display, side, sales, units, eligible, attachments, percent, filename) {
  var grain = daily ? 'daily' : 'cumulative';
  var reportDate = daily ? start : '';
  var keyName = code || display || 'STORE';
  return [
    view,
    grain,
    reportDate,
    start,
    end,
    daily ? start : end,
    '17',
    code,
    display,
    side,
    sales === null ? '' : sales,
    units === null ? '' : units,
    eligible === null ? '' : eligible,
    attachments === null ? '' : attachments,
    percent === null ? '' : percent,
    filename,
    new Date().toISOString(),
    [view, grain, start, end, reportDate, side, keyName].join('|')
  ];
}

function upsertDailyBedding_(date, side, percent, filename) {
  var tab = kpiSheet_();
  var values = tab.getDataRange().getValues();
  var column = side === 'delivered' ? 3 : 2;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) !== 'Daily Bedding' || isoDate_(values[r][4]) !== date || isoDate_(values[r][5]) !== date) continue;
    var recorded = fineNumber_(values[r][column - 1]);
    if (recorded === null) {
      tab.getRange(r + 1, column).setValue(percent);
      tab.getRange(r + 1, 7).setValue(date);
    } else if (recorded !== fineNumber_(percent)) holdBackDay_('CC_Kpi', 'Daily Bedding|' + date + '|' + side, values[r], String(percent), filename);
    return;
  }
  var row = ['Daily Bedding', '', '', 'Group 17 TOTAL bedding dollars ÷ sales. ' + filename, date, date, date];
  row[column - 1] = percent;
  tab.appendRow(row);
}

/** Returns how many rows were added, already on file with the same figures, held back, or replaced. */
function upsertKpiRecords_(records) {
  var tab = ledgerSheet_();
  var values = tab.getDataRange().getValues();
  var index = {};
  var outcome = { added: 0, same: 0, heldBack: [], replaced: 0, addedKeys: [] };
  var appends = [];
  var r;
  for (r = 1; r < values.length; r += 1) index[String(values[r][17] || '')] = r + 1;
  records.forEach(function (record) {
    var key = record[17];
    if (index[key]) {
      var previous = values[index[key] - 1];
      if (previous && record[1] === 'daily') {
        if (sameLedgerFigures_(previous, record)) outcome.same += 1;
        else {
          holdBackDay_('CC_Ledger', key, previous, ledgerFigureText_(record), record[15]);
          outcome.heldBack.push(key);
        }
        return;
      }
      // Columns A–P are the report figures; Q is the import time.
      if (previous && sameRowValues_(previous, record, 16)) { outcome.same += 1; return; }
      if (previous) archiveReplaced_('CC_Ledger', key, previous, record[15], 'A newer store-period snapshot replaced this row.');
      tab.getRange(index[key], 1, 1, record.length).setValues([record]);
      values[index[key] - 1] = record;
      outcome.replaced += 1;
      return;
    }
    appends.push(record);
    values.push(record);
    index[key] = values.length;
    outcome.added += 1;
    outcome.addedKeys.push(key);
  });
  if (appends.length) tab.getRange(values.length - appends.length + 1, 1, appends.length, appends[0].length).setValues(appends);
  return outcome;
}
