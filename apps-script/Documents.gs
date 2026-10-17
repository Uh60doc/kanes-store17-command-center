/**
 * DOCUMENTS RESOURCE CENTER. Store 17 resources (tools, training, new hire, policies, CSR) kept in a private
 * Drive folder owned by the Command Center account and listed in CC_Documents. Files never get a sharing link:
 * every view, download and print goes through dispatch, which checks the login's role first. A replacement keeps
 * the earlier version (status "replaced") under the same family_id; removing a document moves its file to the
 * Removed folder so it can be restored. Nothing here reads or writes sales, delivery, KPI or evaluation tabs.
 */

var DOC_MAX_BYTES_ = 15 * 1024 * 1024;
var DOC_CHUNK_BYTES_ = 4 * 1024 * 1024;
var DOC_HEADERS_ = ['doc_id', 'family_id', 'version', 'status', 'title', 'category', 'subcategory', 'source', 'audience', 'file_name', 'mime_type', 'doc_type', 'size_bytes', 'sha256', 'drive_file_id', 'print_file_id', 'print_note', 'document_date', 'doc_revision', 'uploaded_at', 'uploaded_by', 'updated_at', 'updated_by', 'replaces_doc_id', 'note'];
var DOC_EVENT_HEADERS_ = ['at', 'doc_id', 'family_id', 'action', 'role'];
var DOC_PACKET_HEADERS_ = ['position', 'family_id', 'title', 'saved_at', 'saved_by'];
var DOC_SOURCES_ = ['Store 17', "Kane's company"];
var DOC_AUDIENCES_ = { managers: 'Managers and Admin only', all: 'All staff (Sales login included)' };
var DOC_PACKET_CATEGORY_ = 'New Hire';

/** Suggested subcategories. Any other subcategory typed at upload is kept as entered, so new ones need no code. */
var DOC_CATEGORIES_ = [
  { name: 'Tools', subcategories: ['Maintenance and Protection Tools', 'Sales Order Checklists', 'Reference Documents', 'Store Forms'] },
  { name: 'Training', subcategories: ['Sales Training', 'Role-Play Materials', 'Training Attendance Forms', 'Product Training', 'Certifications'] },
  { name: 'New Hire', subcategories: ['New Hire Training Manuals', 'Day 1–5 Training Materials', 'Sales Order Completion Checklist', 'Training Quizzes', 'Manager Training Resources', 'Onboarding Documents'] },
  { name: 'Store Policies', subcategories: ['Store 17 Floor Rules', 'Attendance and Employee Expectations', 'Sales Floor Procedures', 'Opening and Closing Procedures', 'Security Procedures', 'Other Store and Company Policies'] },
  { name: 'Customer Service / CSR', subcategories: ['Customer Service Procedures', 'Delivery Reference Guides', 'Returns and Exchanges', 'Order Corrections', 'Customer Follow-Up', 'CSR Training and Reference Materials'] },
];

var DOC_TYPES_ = [
  { ext: ['pdf'], type: 'PDF', mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  { ext: ['docx'], type: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [[0x50, 0x4b, 0x03, 0x04]], zipEntry: /^word\/document\.xml$/ },
  { ext: ['doc'], type: 'Word', mime: 'application/msword', magic: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] },
  { ext: ['xlsx'], type: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: [[0x50, 0x4b, 0x03, 0x04]], zipEntry: /^xl\/workbook\.xml$/ },
  { ext: ['xls'], type: 'Excel', mime: 'application/vnd.ms-excel', magic: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] },
  { ext: ['png'], type: 'Image', mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  { ext: ['jpg', 'jpeg'], type: 'Image', mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  { ext: ['gif'], type: 'Image', mime: 'image/gif', magic: [[0x47, 0x49, 0x46, 0x38]] },
  { ext: ['webp'], type: 'Image', mime: 'image/webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
];

function docCategory_(name) {
  var text = String(name || '').trim().toLowerCase();
  return DOC_CATEGORIES_.filter(function (category) { return category.name.toLowerCase() === text; })[0] || null;
}

function docTab_(name, headers) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName(name);
  if (tab) return tab;
  tab = spreadsheet.insertSheet(name);
  tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  return tab;
}

// Free text is written with a leading apostrophe so Sheets keeps it as typed: never a formula, number or date.
function docCell_(value) {
  var text = String(value === null || value === undefined ? '' : value);
  return text ? "'" + text : '';
}

function docText_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/^'/, '');
}

function docClean_(value, max) {
  return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function docFolder_(key, name, parent) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(key);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (error) { id = ''; }
  }
  var folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
  props.setProperty(key, folder.getId());
  return folder;
}

function docRootFolder_() {
  return docFolder_('docs_root_folder', 'Store 17 Documents Library', null);
}

function docCategoryFolder_(category) {
  return docFolder_('docs_folder_' + category.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase(), category.replace(/\//g, '-'), docRootFolder_());
}

function docPrintFolder_() {
  return docFolder_('docs_print_folder', 'Print copies (made by Google from Word and Excel files)', docRootFolder_());
}

function docRemovedFolder_() {
  return docFolder_('docs_removed_folder', 'Removed (admin can restore)', docRootFolder_());
}

/** Every CC_Documents row with its sheet row number, newest last. */
function docRows_() {
  var tab = SpreadsheetApp.openById(SPREADSHEET_ID_).getSheetByName('CC_Documents');
  if (!tab) return [];
  var values = tab.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  var header = values[0].map(function (cell) { return String(cell || '').trim(); });
  var rows = [];
  values.slice(1).forEach(function (line, index) {
    if (String(line[0] || '') === '') return;
    var row = { _row: index + 2 };
    header.forEach(function (key, col) { row[key] = line[col]; });
    rows.push(row);
  });
  return rows;
}

function docUpdate_(row, changes) {
  var tab = docTab_('CC_Documents', DOC_HEADERS_);
  Object.keys(changes).forEach(function (key) {
    var col = DOC_HEADERS_.indexOf(key);
    if (col === -1) throw new Error('Unknown document field ' + key);
    tab.getRange(row._row, col + 1).setValue(changes[key]);
    row[key] = changes[key];
  });
}

function docLogin_(session) {
  var name = '';
  Object.keys(USER_ROLES_).forEach(function (user) { if (!name && USER_ROLES_[user] === session.role) name = user; });
  var label = session.role.charAt(0).toUpperCase() + session.role.slice(1);
  return label + (name ? ' (' + name + ')' : '');
}

function docRow_(id) {
  var text = String(id || '');
  return docRows_().filter(function (row) { return docText_(row.doc_id) === text; })[0] || null;
}

function docView_(row) {
  var audience = docText_(row.audience) === 'all' ? 'all' : 'managers';
  var type = docText_(row.doc_type);
  return {
    id: docText_(row.doc_id),
    familyId: docText_(row.family_id),
    version: Number(row.version) || 1,
    status: docText_(row.status),
    title: docText_(row.title),
    category: docText_(row.category),
    subcategory: docText_(row.subcategory),
    source: docText_(row.source),
    audience: audience,
    fileName: docText_(row.file_name),
    mime: docText_(row.mime_type),
    type: type,
    size: Number(row.size_bytes) || 0,
    hasPrintCopy: !!docText_(row.print_file_id),
    printNote: docText_(row.print_note),
    documentDate: isoDate_(row.document_date) || docText_(row.document_date),
    revision: docText_(row.doc_revision),
    uploadedAt: docText_(row.uploaded_at),
    uploadedBy: docText_(row.uploaded_by),
    updatedAt: docText_(row.updated_at),
    updatedBy: docText_(row.updated_by),
    printable: type === 'PDF' || type === 'Image' || !!docText_(row.print_file_id),
  };
}

function docVisible_(view, role) {
  return role === 'manager' || role === 'admin' || view.audience === 'all';
}

function docPacketEligible_(view) {
  return view.status === 'active' && view.category === DOC_PACKET_CATEGORY_ && view.audience === 'all' && view.printable;
}

function docPacketFamilies_() {
  return sheet_('CC_DocumentPacket').slice().sort(function (left, right) { return Number(left.position) - Number(right.position); }).map(function (row) { return docText_(row.family_id); });
}

/** The library as the login may see it. */
function documents_(payload) {
  var role = payload.session.role;
  var views = docRows_().map(docView_);
  var active = views.filter(function (view) { return view.status === 'active' && docVisible_(view, role); });
  var byFamily = {};
  active.forEach(function (view) { byFamily[view.familyId] = view; });
  var events = sheet_('CC_DocumentEvents');
  var uses = {};
  var since = '';
  events.forEach(function (event) {
    var at = docText_(event.at);
    if (!since || at < since) since = at;
    var action = docText_(event.action);
    if (action !== 'view' && action !== 'download' && action !== 'print') return;
    var family = docText_(event.family_id);
    uses[family] = (uses[family] || 0) + 1;
  });
  var frequent = Object.keys(uses).filter(function (family) { return byFamily[family]; }).map(function (family) {
    return { id: byFamily[family].id, uses: uses[family] };
  }).sort(function (left, right) { return right.uses - left.uses; }).slice(0, 6);
  var recent = active.slice().sort(function (left, right) { return left.uploadedAt < right.uploadedAt ? 1 : -1; }).slice(0, 6).map(function (view) { return view.id; });
  var result = {
    categories: DOC_CATEGORIES_,
    sources: DOC_SOURCES_,
    audiences: DOC_AUDIENCES_,
    docs: active,
    recent: recent,
    frequent: frequent,
    trackingSince: since,
    canUpload: role === 'manager' || role === 'admin',
    isAdmin: role === 'admin',
    maxBytes: DOC_MAX_BYTES_,
    kanesLogo: 'data:image/jpeg;base64,' + KANES_LOGO_JPEG_,
  };
  if (role === 'manager' || role === 'admin') {
    var configured = docPacketFamilies_();
    result.packet = configured.filter(function (family) { return byFamily[family] && docPacketEligible_(byFamily[family]); }).map(function (family) { return byFamily[family].id; });
  }
  if (role === 'admin') {
    result.packetCandidates = active.filter(docPacketEligible_).map(function (view) { return view.id; });
    result.removed = views.filter(function (view) { return view.status === 'removed'; });
    result.versions = {};
    views.filter(function (view) { return view.status === 'replaced'; }).forEach(function (view) {
      (result.versions[view.familyId] = result.versions[view.familyId] || []).push(view);
    });
  }
  return result;
}

function docTypeFor_(fileName, bytes) {
  var ext = (String(fileName).match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  var spec = DOC_TYPES_.filter(function (item) { return item.ext.indexOf(ext) !== -1; })[0];
  if (!spec) return { problem: 'Only PDF, Word (.doc, .docx), Excel (.xls, .xlsx) and image (.png, .jpg, .gif, .webp) files can be added.' };
  var matches = spec.magic.some(function (codes) { return bytesStartWith_(bytes, codes); });
  if (matches && ext === 'webp') matches = Utilities.newBlob(bytes.slice(8, 12)).getDataAsString() === 'WEBP';
  if (matches && spec.zipEntry) {
    try {
      matches = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', fileName)).some(function (blob) { return spec.zipEntry.test(blob.getName()); });
    } catch (error) {
      matches = false;
    }
  }
  if (!matches) return { problem: fileName + ' is named .' + ext + ' but its contents are not a ' + spec.type + ' file.' };
  return spec;
}

function docSame_(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

/** Why an active document would clash with this title / file / contents, or '' when nothing does. */
function docClash_(views, check) {
  var reason = '';
  views.forEach(function (view) {
    if (reason || view.status !== 'active' || view.familyId === check.familyId) return;
    if (check.sha && view.sha === check.sha) reason = 'This exact file is already in the library as "' + view.title + '" (' + view.category + ').';
    else if (view.category === check.category && docSame_(view.title, check.title)) reason = 'A document titled "' + view.title + '" is already in ' + view.category + '.';
    else if (check.fileName && view.category === check.category && docSame_(view.fileName, check.fileName)) reason = 'A file named ' + view.fileName + ' is already in ' + view.category + ' as "' + view.title + '".';
  });
  return reason;
}

function docViewsWithSha_() {
  return docRows_().map(function (row) {
    var view = docView_(row);
    view.sha = docText_(row.sha256);
    return view;
  });
}

function docPrintCopy_(blob, spec, title) {
  if (spec.type !== 'Word' && spec.type !== 'Excel') return { id: '', note: '' };
  var temp = null;
  try {
    temp = Drive.Files.insert({ title: 'CC doc convert ' + new Date().getTime(), mimeType: spec.type === 'Word' ? MimeType.GOOGLE_DOCS : MimeType.GOOGLE_SHEETS }, blob, { convert: true });
    var pdf = DriveApp.getFileById(temp.id).getAs(MimeType.PDF).setName(title.replace(/[\\\/]/g, '-') + ' (print copy).pdf');
    var file = docPrintFolder_().createFile(pdf);
    return { id: file.getId(), note: 'Print copy made by Google from the ' + spec.type + ' file; the layout can differ slightly from ' + spec.type + '.' };
  } catch (error) {
    return { id: '', note: 'Google could not make a print copy of this ' + spec.type + ' file. Download it and print from ' + spec.type + '.' };
  } finally {
    if (temp && temp.id) {
      try { DriveApp.getFileById(temp.id).setTrashed(true); } catch (error) { /* temporary conversion only */ }
    }
  }
}

function docLock_() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    throw new Error('Another change to the library is being saved. Wait a moment and try again.');
  }
  return lock;
}

function docFields_(payload, current) {
  var category = docCategory_(payload.category === undefined && current ? current.category : payload.category);
  if (!category) throw new Error('Choose the category first: ' + DOC_CATEGORIES_.map(function (item) { return item.name; }).join(', ') + '.');
  var title = docClean_(payload.title === undefined && current ? current.title : payload.title, 140);
  if (!title) throw new Error('Enter the document title.');
  var source = docClean_(payload.source === undefined && current ? current.source : payload.source, 40);
  if (DOC_SOURCES_.indexOf(source) === -1) throw new Error("Choose who issued it: Store 17 or Kane's company.");
  var audience = String(payload.audience === undefined && current ? current.audience : payload.audience || '');
  if (!DOC_AUDIENCES_[audience]) throw new Error('Choose who can see it.');
  var date = payload.documentDate === undefined && current ? current.documentDate : String(payload.documentDate || '');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('The document date must be a date.');
  if (date && date > todayNy_()) throw new Error('The document date cannot be after today.');
  var subcategory = docClean_(payload.subcategory === undefined && current ? current.subcategory : payload.subcategory, 80);
  category.subcategories.forEach(function (name) { if (docSame_(name, subcategory)) subcategory = name; });
  return {
    category: category.name,
    title: title,
    subcategory: subcategory,
    source: source,
    audience: audience,
    documentDate: date,
    revision: docClean_(payload.revision === undefined && current ? current.revision : payload.revision, 40),
  };
}

function uploadDocument_(payload) {
  var session = payload.session;
  var replacing = String(payload.replaceId || '');
  if (replacing && session.role !== 'admin') throw new Error('Only Admin can replace a document.');
  if (payload.noPersonalInfo !== true) throw new Error('Confirm the file is a blank form or general resource, not a completed HR form or a personal employee or customer record.');
  var fileName = docClean_(String(payload.fileName || '').replace(/[\\\/]/g, '_'), 160);
  if (!fileName) throw new Error('Choose a file.');
  var base64 = String(payload.base64 || '');
  if (!base64) throw new Error(fileName + ' is empty.');
  var bytes = Utilities.base64Decode(base64);
  if (!bytes.length) throw new Error(fileName + ' is empty.');
  if (bytes.length > DOC_MAX_BYTES_) throw new Error(fileName + ' is larger than 15 MB.');
  var spec = docTypeFor_(fileName, bytes);
  if (spec.problem) throw new Error(spec.problem);
  var sha = sha256Hex_(bytes);
  var lock = docLock_();
  var created;
  try {
    var views = docViewsWithSha_();
    var previous = null;
    if (replacing) {
      previous = views.filter(function (view) { return view.id === replacing; })[0];
      if (!previous || previous.status !== 'active') throw new Error('That document is no longer in the library, so it cannot be replaced.');
    }
    var fields = docFields_(payload, previous);
    if (previous) fields.category = previous.category;
    var clash = docClash_(views, { familyId: previous ? previous.familyId : '', category: fields.category, title: fields.title, fileName: fileName, sha: sha });
    if (previous && previous.sha === sha) clash = 'This is the same file as the current version, so nothing was replaced.';
    if (clash) throw new Error(clash + (previous ? '' : ' Nothing was uploaded. To put in a new version, Admin can open that document and choose Replace.'));
    var blob = Utilities.newBlob(bytes, spec.mime, fileName);
    var file = docCategoryFolder_(fields.category).createFile(blob);
    var print = docPrintCopy_(blob, spec, fields.title);
    var now = new Date().toISOString();
    var id = 'D' + now.replace(/\D/g, '').slice(0, 14) + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
    var uploader = docLogin_(session) + (docClean_(payload.uploaderName, 60) ? ' · ' + docClean_(payload.uploaderName, 60) : '');
    docTab_('CC_Documents', DOC_HEADERS_).appendRow([
      id, previous ? previous.familyId : id, previous ? previous.version + 1 : 1, 'active',
      docCell_(fields.title), fields.category, docCell_(fields.subcategory), fields.source, fields.audience,
      docCell_(fileName), spec.mime, spec.type, bytes.length, sha, file.getId(), print.id, docCell_(print.note),
      fields.documentDate, docCell_(fields.revision), docCell_(now), docCell_(uploader), docCell_(now), docCell_(uploader), previous ? previous.id : '', '',
    ]);
    if (previous) {
      var old = docRow_(previous.id);
      docUpdate_(old, { status: 'replaced', updated_at: docCell_(now), updated_by: docCell_(uploader) });
    }
    created = { id: id, title: fields.title, category: fields.category, version: previous ? previous.version + 1 : 1, printNote: print.note };
  } finally {
    lock.releaseLock();
  }
  var library = documents_(payload);
  var message = previous
    ? '"' + created.title + '" is now version ' + created.version + ' in ' + created.category + '. Version ' + (created.version - 1) + ' is kept in its history.'
    : '"' + created.title + '" was added to ' + created.category + '.';
  return { ok: true, id: created.id, message: message + (created.printNote ? ' ' + created.printNote : ''), library: library };
}

/** One file (or a 4 MB part of it) after the role check. purpose: original | print | packet. */
function docFile_(payload) {
  var role = payload.session.role;
  var row = docRow_(payload.id);
  if (!row) throw new Error('That document is not in the library.');
  var view = docView_(row);
  if (view.status !== 'active' && role !== 'admin') throw new Error('That document is not in the library.');
  if (view.status === 'deleted') throw new Error('That document was deleted.');
  if (!docVisible_(view, role)) throw new Error('That document is not available for this login.');
  var purpose = String(payload.purpose || 'original');
  var fileId = docText_(row.drive_file_id);
  var mime = view.mime;
  var fileName = view.fileName;
  if (purpose === 'packet') {
    if (role === 'sales') throw new Error('That document is not available for this login.');
    if (!docPacketEligible_(view) || docPacketFamilies_().indexOf(view.familyId) === -1) throw new Error('"' + view.title + '" is not approved for the New Hire packet.');
  }
  if ((purpose === 'print' || purpose === 'packet') && (view.type === 'Word' || view.type === 'Excel')) {
    fileId = docText_(row.print_file_id);
    if (!fileId) throw new Error('"' + view.title + '" has no print copy. Download it and print from ' + view.type + '.');
    mime = 'application/pdf';
    fileName = view.title + ' (print copy).pdf';
  } else if (purpose !== 'original' && purpose !== 'print' && purpose !== 'packet') {
    throw new Error('That request is not available.');
  }
  var file = DriveApp.getFileById(fileId);
  var bytes = file.getBlob().getBytes();
  var offset = Math.max(0, Math.floor(Number(payload.offset) || 0));
  var part = bytes.slice(offset, offset + DOC_CHUNK_BYTES_);
  if (offset === 0) {
    var action = String(payload.action || purpose);
    if (['view', 'download', 'print', 'packet'].indexOf(action) === -1) action = 'view';
    docTab_('CC_DocumentEvents', DOC_EVENT_HEADERS_).appendRow([docCell_(new Date().toISOString()), view.id, view.familyId, action, role]);
  }
  var result = { id: view.id, fileName: fileName, mime: mime, size: bytes.length, offset: offset, base64: Utilities.base64Encode(part), done: offset + part.length >= bytes.length };
  if (role === 'admin' && offset === 0) {
    try { result.sharing = String(file.getSharingAccess()); } catch (error) { result.sharing = ''; }
  }
  return result;
}

function editDocument_(payload) {
  var lock = docLock_();
  var message;
  try {
    var row = docRow_(payload.id);
    if (!row || docText_(row.status) !== 'active') throw new Error('That document is not in the library.');
    var view = docView_(row);
    var fields = docFields_(payload, view);
    var clash = docClash_(docViewsWithSha_(), { familyId: view.familyId, category: fields.category, title: fields.title, fileName: fields.category !== view.category ? view.fileName : '', sha: '' });
    if (clash) throw new Error(clash + ' Nothing was changed.');
    var now = new Date().toISOString();
    if (fields.category !== view.category) DriveApp.getFileById(docText_(row.drive_file_id)).moveTo(docCategoryFolder_(fields.category));
    docUpdate_(row, {
      title: docCell_(fields.title), category: fields.category, subcategory: docCell_(fields.subcategory), source: fields.source, audience: fields.audience,
      document_date: fields.documentDate, doc_revision: docCell_(fields.revision), updated_at: docCell_(now), updated_by: docCell_(docLogin_(payload.session)),
    });
    message = '"' + fields.title + '" was saved.';
    if (docPacketFamilies_().indexOf(view.familyId) !== -1 && !docPacketEligible_(docView_(row))) {
      docSavePacket_(docPacketFamilies_().filter(function (family) { return family !== view.familyId; }), payload.session);
      message += ' It was taken out of the New Hire packet, which holds only New Hire documents visible to all staff.';
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, message: message, library: documents_(payload) };
}

/** action: remove | restore | delete. Remove and restore move the Drive file; delete moves it to Drive's trash. */
function removeDocument_(payload) {
  var action = String(payload.action || 'remove');
  var lock = docLock_();
  var message;
  try {
    var row = docRow_(payload.id);
    if (!row) throw new Error('That document is not in the library.');
    var view = docView_(row);
    var now = new Date().toISOString();
    var who = docCell_(docLogin_(payload.session));
    var file = DriveApp.getFileById(docText_(row.drive_file_id));
    if (action === 'remove') {
      if (view.status !== 'active') throw new Error('That document is not in the library.');
      file.moveTo(docRemovedFolder_());
      docUpdate_(row, { status: 'removed', updated_at: docCell_(now), updated_by: who });
      if (docPacketFamilies_().indexOf(view.familyId) !== -1) docSavePacket_(docPacketFamilies_().filter(function (family) { return family !== view.familyId; }), payload.session);
      message = '"' + view.title + '" was removed from the library. Admin can restore it from Removed documents.';
    } else if (action === 'restore') {
      if (view.status !== 'removed') throw new Error('Only a removed document can be restored.');
      var views = docViewsWithSha_();
      var clash = docClash_(views, { familyId: view.familyId, category: view.category, title: view.title, fileName: view.fileName, sha: docText_(row.sha256) });
      if (!clash && views.some(function (other) { return other.familyId === view.familyId && other.status === 'active'; })) clash = 'A newer version of "' + view.title + '" is in the library.';
      if (clash) throw new Error(clash + ' It was not restored.');
      file.moveTo(docCategoryFolder_(view.category));
      docUpdate_(row, { status: 'active', updated_at: docCell_(now), updated_by: who });
      message = '"' + view.title + '" is back in ' + view.category + '.';
    } else if (action === 'delete') {
      if (view.status !== 'removed') throw new Error('Remove the document first; only removed documents can be deleted.');
      file.setTrashed(true);
      if (docText_(row.print_file_id)) {
        try { DriveApp.getFileById(docText_(row.print_file_id)).setTrashed(true); } catch (error) { /* print copy already gone */ }
      }
      docUpdate_(row, { status: 'deleted', updated_at: docCell_(now), updated_by: who });
      message = '"' + view.title + '" was deleted. Its file is in the Command Center Drive trash for 30 days.';
    } else {
      throw new Error('That request is not available.');
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true, message: message, library: documents_(payload) };
}

function docSavePacket_(families, session) {
  var tab = docTab_('CC_DocumentPacket', DOC_PACKET_HEADERS_);
  var byFamily = {};
  docRows_().map(docView_).forEach(function (view) { if (view.status === 'active') byFamily[view.familyId] = view; });
  var now = new Date().toISOString();
  var rows = families.map(function (family, index) { return [index + 1, family, docCell_(byFamily[family] ? byFamily[family].title : ''), docCell_(now), docCell_(docLogin_(session))]; });
  var last = tab.getLastRow();
  if (last > 1) tab.getRange(2, 1, last - 1, DOC_PACKET_HEADERS_.length).setValues(Array.apply(null, Array(last - 1)).map(function () { return DOC_PACKET_HEADERS_.map(function () { return ''; }); }));
  if (rows.length) tab.getRange(2, 1, rows.length, DOC_PACKET_HEADERS_.length).setValues(rows);
}

/** Admin's approved New Hire packet: document ids in print order. */
function saveDocPacket_(payload) {
  var ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
  var lock = docLock_();
  try {
    var views = docRows_().map(docView_);
    var families = [];
    ids.forEach(function (id) {
      var view = views.filter(function (item) { return item.id === id; })[0];
      if (!view || view.status !== 'active') throw new Error('A chosen document is no longer in the library. Reload the page.');
      if (!docPacketEligible_(view)) {
        throw new Error('"' + view.title + '" cannot go in the associate packet. Only New Hire documents visible to all staff that are PDFs, images, or Word/Excel files with a print copy can; manager answer keys stay Managers only.');
      }
      if (families.indexOf(view.familyId) === -1) families.push(view.familyId);
    });
    docSavePacket_(families, payload.session);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, message: families.length ? 'The New Hire packet now holds ' + families.length + ' approved document' + (families.length === 1 ? '' : 's') + ' in the order shown.' : 'The New Hire packet has no approved documents.', library: documents_(payload) };
}
