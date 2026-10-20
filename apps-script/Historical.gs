/**
 * Permanent daily historical registers. Year-over-year reads these rows by business date.
 * A later year is added when that day's report is imported. Nothing here writes CC_Daily,
 * the ledger, or a current-year sales total.
 *
 * SNAP_WRITTEN_LY       One Store 17 SNAP Written total per business date.
 * NWDSR_WRITTEN_LY      One Store 17 NWDSR Written total per business date.
 * NWDSR_DELIVERED_LY    One Store 17 NWDSR Delivered total per business date.
 *
 * A blank day is missing. A verified zero is a completed report whose total is $0.
 */

var HISTORICAL_TABS_ = {
  'SNAP Written': {
    tab: 'SNAP_WRITTEN_LY',
    dollars: 'SNAP Written Dollars',
    headers: ['Business Date', 'Store Number', 'SNAP Written Dollars', 'Reporting Month', 'Position Within Reporting Month', 'Source Filename / Report Reference', 'Source Verification Status', 'Last Imported / Updated', 'Record Status', 'Notes'],
  },
  'NWDSR Written': {
    tab: 'NWDSR_WRITTEN_LY',
    dollars: 'NWDSR Written Dollars',
    headers: ['Business Date', 'Store Number', 'NWDSR Written Dollars', 'Reporting Month', 'Position Within Reporting Month', 'Source Filename / Report Reference', 'Source Verification Status', 'Last Imported / Updated', 'Record Status', 'Notes'],
  },
  'NWDSR Delivered': {
    tab: 'NWDSR_DELIVERED_LY',
    dollars: 'NWDSR Delivered Dollars',
    headers: ['Business Date', 'Store Number', 'NWDSR Delivered Dollars', 'Reporting Month', 'Position Within Reporting Month', 'Source Filename / Report Reference', 'Source Verification Status', 'Last Imported / Updated', 'Record Status', 'Notes'],
  },
};

function historicalSpec_(metric) {
  return HISTORICAL_TABS_[metric] || null;
}

function historicalTabName_(metric) {
  var spec = historicalSpec_(metric);
  return spec ? spec.tab : '';
}

function historicalSheet_(metric) {
  var spec = historicalSpec_(metric);
  if (!spec) return null;
  return historyTab_(spec.tab, spec.headers);
}

function historicalRows_(metric) {
  var spec = historicalSpec_(metric);
  if (!spec) return [];
  return sheet_(spec.tab).map(function (row) {
    return {
      date: isoDate_(row['Business Date']),
      store: String(row['Store Number'] || ''),
      dollars: numberOrNull_(row[spec.dollars]),
      month: String(row['Reporting Month'] || ''),
      position: row['Position Within Reporting Month'],
      source: String(row['Source Filename / Report Reference'] || ''),
      verification: String(row['Source Verification Status'] || ''),
      updated: String(row['Last Imported / Updated'] || ''),
      status: String(row['Record Status'] || ''),
      notes: String(row['Notes'] || ''),
    };
  }).filter(function (row) { return row.date; });
}

/** The verified register amount for one business date, or null when that day is not on file. */
function historicalAmount_(metric, date) {
  var found = null;
  historicalRows_(metric).forEach(function (row) {
    if (found || row.date !== date) return;
    if (String(row.store) !== '17') return;
    if (row.dollars === null) return;
    if (row.verification !== 'Verified' && row.verification !== 'Verified zero') return;
    if (row.status && row.status !== 'Canonical') return;
    found = row;
  });
  return found;
}

function historicalReporting_(date) {
  var period = storePeriodContaining_(date);
  return {
    month: period.start + ' through ' + period.end,
    position: historyDayGap_(period.start, date) + 1,
  };
}

function historicalMergeSources_(current, addition) {
  var seen = {};
  String(current || '').split(';').concat(String(addition || '').split(';')).forEach(function (name) {
    var trimmed = String(name || '').trim();
    if (trimmed) seen[trimmed] = true;
  });
  return Object.keys(seen).sort().join('; ');
}

/**
 * Keeps one canonical row per business date. The same total may add its filename.
 * A different total is archived and not applied.
 */
function recordHistoricalDay_(entry) {
  var spec = historicalSpec_(entry.metric);
  if (!spec || !entry.date) return { status: 'ignored' };
  var dollars = numberOrNull_(entry.dollars);
  if (dollars === null) return { status: 'ignored' };
  var tab = historicalSheet_(entry.metric);
  var values = tab.getDataRange().getValues();
  var target = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === entry.date && String(values[r][1]) === '17') target = r + 1;
  }
  var place = historicalReporting_(entry.date);
  var now = historyNow_();
  var verification = entry.verification || 'Verified';
  var note = entry.note || '';
  if (!target) {
    tab.appendRow([entry.date, 17, dollars, place.month, place.position, entry.source || '', verification, now, 'Canonical', note]);
    forgetRead_(spec.tab);
    return { status: 'added', dollars: dollars };
  }
  var current = numberOrNull_(values[target - 1][2]);
  if (current !== null && current !== dollars) {
    holdBackDay_(spec.tab, entry.date, values[target - 1], dollars, entry.source || '');
    var kept = String(values[target - 1][9] || '');
    var disagreement = 'A later file (' + (entry.source || 'unknown') + ') printed ' + dollars + '. The recorded ' + current + ' was kept.';
    if (kept.indexOf(disagreement) === -1) {
      tab.getRange(target, 10).setValue(kept ? kept + ' ' + disagreement : disagreement);
    }
    forgetRead_(spec.tab);
    return { status: 'kept', dollars: current };
  }
  var sources = historicalMergeSources_(values[target - 1][5], entry.source || '');
  tab.getRange(target, 6, 1, 4).setValues([[sources, verification || values[target - 1][6], now, 'Canonical']]);
  if (note && String(values[target - 1][9] || '').indexOf(note) === -1) {
    var existing = String(values[target - 1][9] || '');
    tab.getRange(target, 10).setValue(existing ? existing : note);
  }
  forgetRead_(spec.tab);
  return { status: current === null ? 'filled' : 'same', dollars: dollars };
}

/** Files the imported daily total on the historical register. Does not write CC_Daily. */
function recordHistoricalFromImport_(parsed, fileName) {
  if (!parsed || !parsed.singleDay || !historicalSpec_(parsed.reportType)) return { status: 'ignored' };
  if (parsed.storeTotal === null || parsed.storeTotal === undefined) return { status: 'ignored' };
  return recordHistoricalDay_({
    metric: parsed.reportType,
    date: parsed.start,
    dollars: parsed.storeTotal,
    source: fileName || '',
    verification: 'Verified',
    note: 'Filed when the daily report was imported. The printed business date was kept. Current-year sales were not changed by this register.',
  });
}

function installHistoricalSeed_() {
  if (typeof historicalSeedRows_ !== 'function') return { added: 0, same: 0, kept: 0 };
  var counts = { added: 0, same: 0, kept: 0, filled: 0 };
  historicalSeedRows_().forEach(function (row) {
    var result = recordHistoricalDay_({
      metric: row[0],
      date: row[1],
      dollars: row[2],
      source: row[3],
      verification: row[4],
      note: row[5],
    });
    if (counts[result.status] !== undefined) counts[result.status] += 1;
  });
  return counts;
}
