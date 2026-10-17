import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { appsScriptServices, blob } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';

const FILES = ['Code.gs', 'Data.gs', 'Auth.gs', 'Logos.gs', 'Upload.gs', 'Evaluations.gs', 'Documents.gs'];
const sales = { role: 'sales' };
const manager = { role: 'manager' };
const admin = { role: 'admin' };

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.concat([local, nameBytes, data]);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(entry);
    central.push(Buffer.concat([header, nameBytes]));
    offset += entry.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
const docx = (text: string) => zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>` });
const xlsx = (text: string) => zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': `<workbook><!--${text}--></workbook>` });
const png = (salt: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(salt)]);

/** Drive with folders, moves, trash and Google conversion, recording where every file lives. */
function drive(services: ReturnType<typeof appsScriptServices>, convertFails = false) {
  type FileRecord = { name: string; bytes: Uint8Array; type: string; parent: string; trashed: boolean; converted?: string };
  const files: Record<string, FileRecord> = {};
  const folders: Record<string, { name: string; parent: string }> = {};
  let next = 1;
  const unsigned = (bytes: ArrayLike<number>) => Uint8Array.from(Array.from(bytes, (b) => (b < 0 ? b + 256 : b)));
  const addFile = (input: ReturnType<typeof blob>, parent: string, converted?: string) => {
    const id = `file-${next++}`;
    files[id] = { name: input.getName(), bytes: unsigned(input.getBytes()), type: input.getContentType(), parent, trashed: false, converted };
    return file(id);
  };
  const file = (id: string) => {
    if (!files[id]) throw new Error('no such file');
    const record = files[id]!;
    return {
      getId: () => id,
      getBlob: () => blob(record.bytes, record.type, record.name),
      moveTo: (target: { getId: () => string }) => { record.parent = target.getId(); },
      setTrashed: (value: boolean) => { record.trashed = value; },
      getSharingAccess: () => 'PRIVATE',
      getAs: (type: string) => {
        if (!record.converted) throw new Error('not a Google file');
        let name = `${record.name}.pdf`;
        const out = { ...blob(Buffer.from(`%PDF-1.4\nconverted ${record.converted}\n%%EOF`), type, name), setName: (value: string) => { name = value; return out; }, getName: () => name };
        return out;
      },
    };
  };
  const folder = (id: string): any => ({
    getId: () => id,
    createFile: (input: ReturnType<typeof blob>) => addFile(input, id),
    createFolder: (name: string) => { const child = `folder-${next++}`; folders[child] = { name, parent: id }; return folder(child); },
  });
  Object.assign(services.services, {
    DriveApp: {
      createFolder: (name: string) => { const id = `folder-${next++}`; folders[id] = { name, parent: '' }; return folder(id); },
      getFolderById: (id: string) => { if (!folders[id]) throw new Error('no such folder'); return folder(id); },
      getFileById: file,
    },
    Drive: {
      Files: {
        insert: (meta: { title: string }, input: ReturnType<typeof blob>) => {
          if (convertFails) throw new Error('conversion failed');
          return { id: addFile(input, 'root', new TextDecoder().decode(unsigned(input.getBytes())).slice(0, 400)).getId(), title: meta.title };
        },
      },
    },
    MimeType: { GOOGLE_DOCS: 'application/vnd.google-apps.document', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet', PDF: 'application/pdf' },
  });
  const folderOf = (id: string) => folders[files[id]!.parent]?.name ?? files[id]!.parent;
  return { files, folders, folderOf };
}

function salesTabs(): Record<string, Grid> {
  return {
    CC_Config: [['key', 'value'], ['store_period_start', '2026-10-02']],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-13', 900, 900, 400]],
    CC_Ledger: [['view', 'grain', 'report_date'], ['DA_SALES_STORE', 'cumulative', '']],
    CC_Kpi: [['metric', 'written', 'delivered'], ['attach', 0.5, 0.4]],
    CC_People: [['name', 'role'], ['Ricky Nassif', 'associate']],
  };
}

function boot(options: { convertFails?: boolean } = {}) {
  const tabs = salesTabs();
  const services = appsScriptServices();
  const store = drive(services, options.convertFails);
  const gs = loadAppsScript(FILES, tabs, '2026-10-17', services.services) as any;
  const before = JSON.stringify(tabs);
  const upload = (session: object, bytes: Buffer, fields: Record<string, unknown>) =>
    plain(gs.uploadDocument_({ base64: bytes.toString('base64'), source: 'Store 17', audience: 'managers', noPersonalInfo: true, session, ...fields }));
  const library = (session: object) => plain(gs.documents_({ session }));
  const file = (session: object, id: string, extra: Record<string, unknown> = {}) => plain(gs.docFile_({ id, session, ...extra }));
  const salesUnchanged = () => {
    const now = JSON.parse(JSON.stringify(tabs));
    for (const name of Object.keys(now)) if (name.startsWith('CC_Document')) delete now[name];
    return JSON.stringify(now) === before;
  };
  return { gs, tabs, store, upload, library, file, salesUnchanged };
}

const header = (tabs: Record<string, Grid>) => tabs.CC_Documents![0] as string[];
const cell = (tabs: Record<string, Grid>, row: unknown[], key: string) => row[header(tabs).indexOf(key)];

test('a PDF uploaded to Tools is kept privately in the Tools folder and listed in Tools with its original details', () => {
  const { upload, library, store, tabs, salesUnchanged } = boot();
  const result = upload(manager, pdf('Protection plan claim steps'), { fileName: 'Protection Claim Steps.pdf', title: 'Protection Claim Steps', category: 'tools', subcategory: 'maintenance and protection TOOLS', uploaderName: 'Pat' });
  assert.equal(result.ok, true);
  assert.match(result.message, /added to Tools/);
  const doc = result.library.docs.find((item: any) => item.id === result.id);
  assert.equal(doc.category, 'Tools');
  assert.equal(doc.subcategory, 'Maintenance and Protection Tools');
  assert.equal(doc.fileName, 'Protection Claim Steps.pdf');
  assert.equal(doc.type, 'PDF');
  assert.equal(doc.uploadedBy, 'Manager (store17) · Pat');
  assert.match(doc.uploadedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(doc.version, 1);
  const row = tabs.CC_Documents!.at(-1)!;
  const driveId = String(cell(tabs, row, 'drive_file_id'));
  assert.equal(store.folderOf(driveId), 'Tools');
  assert.equal(store.folders[store.files[driveId]!.parent]!.parent, Object.keys(store.folders).find((id) => store.folders[id]!.name === 'Store 17 Documents Library'));
  assert.equal(cell(tabs, row, 'sha256'), createHash('sha256').update(pdf('Protection plan claim steps')).digest('hex'));
  assert.deepEqual(library(manager).recent, [result.id]);
  assert.ok(salesUnchanged(), 'uploading a document must not touch any sales, KPI or roster tab');
});

test('the category is required, the no-personal-records confirmation is required, and only the supported types are accepted', () => {
  const { upload, gs } = boot();
  assert.throws(() => upload(manager, pdf('x'), { fileName: 'a.pdf', title: 'A', category: '' }), /Choose the category first/);
  assert.throws(() => upload(manager, pdf('x'), { fileName: 'a.pdf', title: 'A', category: 'Payroll' }), /Choose the category first/);
  assert.throws(() => upload(manager, pdf('x'), { fileName: 'a.pdf', title: 'A', category: 'Tools', noPersonalInfo: false }), /not a completed HR form/);
  assert.throws(() => upload(manager, pdf('x'), { fileName: 'a.pdf', title: '', category: 'Tools' }), /Enter the document title/);
  assert.throws(() => upload(manager, pdf('x'), { fileName: 'a.pdf', title: 'A', category: 'Tools', source: 'Somebody' }), /Store 17 or Kane's company/);
  assert.throws(() => upload(manager, Buffer.from('MZ\x90\x00 program'), { fileName: 'setup.exe', title: 'A', category: 'Tools' }), /Only PDF, Word/);
  assert.throws(() => upload(manager, pdf('not really word'), { fileName: 'a.docx', title: 'A', category: 'Tools' }), /contents are not a Word file/);
  assert.throws(() => upload(manager, xlsx('workbook'), { fileName: 'a.docx', title: 'A', category: 'Tools' }), /contents are not a Word file/);
  assert.throws(() => upload(manager, Buffer.from('<html>'), { fileName: 'a.pdf', title: 'A', category: 'Tools' }), /contents are not a PDF file/);
  assert.throws(() => upload(manager, Buffer.alloc(15 * 1024 * 1024 + 1, 0x25), { fileName: 'big.pdf', title: 'Big', category: 'Tools' }), /larger than 15 MB/);
  assert.throws(() => upload(manager, pdf('x'), { fileName: 'a.pdf', title: 'A', category: 'Tools', documentDate: '2026-12-01' }), /cannot be after today/);
  assert.equal(gs.sheet_('CC_Documents').length, 0);
});

test('the five library sections and their suggested subcategories are offered, and a new subcategory needs no code', () => {
  const { upload, library } = boot();
  const sections = library(manager).categories;
  assert.deepEqual(sections.map((entry: any) => entry.name), ['Tools', 'Training', 'New Hire', 'Store Policies', 'Customer Service / CSR']);
  assert.deepEqual(sections[3].subcategories, ['Store 17 Floor Rules', 'Attendance and Employee Expectations', 'Sales Floor Procedures', 'Opening and Closing Procedures', 'Security Procedures', 'Other Approved Store and Company Policies']);
  assert.deepEqual(sections[4].subcategories, ['Customer Service Procedures', 'Delivery Reference Guides', 'Returns and Exchanges', 'Order Corrections', 'Customer Follow-Up', 'CSR Training and Reference Materials']);
  const typed = upload(manager, pdf('returns'), { fileName: 'Returns.pdf', title: 'Returns Guide', category: 'Customer Service / CSR', subcategory: 'returns and exchanges' });
  const fresh = upload(manager, pdf('holiday'), { fileName: 'Holiday.pdf', title: 'Holiday Hours', category: 'Store Policies', subcategory: 'Holiday Schedules' });
  const docs = library(manager).docs;
  assert.equal(docs.find((doc: any) => doc.id === typed.id).subcategory, 'Returns and Exchanges');
  assert.equal(docs.find((doc: any) => doc.id === fresh.id).subcategory, 'Holiday Schedules');
});

test('identical titles, file names or contents never replace a document by accident', () => {
  const { upload, library } = boot();
  upload(manager, pdf('one'), { fileName: 'Floor Rules.pdf', title: 'Floor Rules', category: 'Store Policies' });
  assert.throws(() => upload(manager, pdf('two'), { fileName: 'other.pdf', title: 'floor rules ', category: 'Store Policies' }), /already in Store Policies.*Nothing was uploaded.*Replace/);
  assert.throws(() => upload(manager, pdf('three'), { fileName: 'FLOOR RULES.pdf', title: 'Different', category: 'Store Policies' }), /A file named Floor Rules.pdf is already in Store Policies/);
  assert.throws(() => upload(manager, pdf('one'), { fileName: 'copy.pdf', title: 'Copy', category: 'Training' }), /This exact file is already in the library as "Floor Rules"/);
  upload(manager, pdf('four'), { fileName: 'Floor Rules.pdf', title: 'Floor Rules', category: 'Training' });
  assert.equal(library(manager).docs.length, 2);
});

test('only Admin can replace, and the replaced version stays in the history', () => {
  const { upload, library, file, gs } = boot();
  const first = upload(manager, pdf('v1'), { fileName: 'Day 1.pdf', title: 'Day 1 Manual', category: 'New Hire', subcategory: 'New Hire Training Manuals' });
  assert.throws(() => upload(manager, pdf('v2'), { fileName: 'Day 1 rev.pdf', replaceId: first.id }), /Only Admin can replace/);
  assert.throws(() => upload(admin, pdf('v1'), { fileName: 'again.pdf', replaceId: first.id }), /same file as the current version/);
  const second = upload(admin, pdf('v2'), { fileName: 'Day 1 rev.pdf', replaceId: first.id, revision: 'Rev. 2' });
  assert.match(second.message, /now version 2 in New Hire\. Version 1 is kept/);
  const current = library(manager).docs;
  assert.equal(current.length, 1);
  assert.equal(current[0].id, second.id);
  assert.equal(current[0].title, 'Day 1 Manual');
  assert.equal(current[0].subcategory, 'New Hire Training Manuals');
  assert.equal(current[0].revision, 'Rev. 2');
  assert.equal(current[0].familyId, first.id);
  const versions = library(admin).versions[first.id];
  assert.equal(versions.length, 1);
  assert.equal(versions[0].id, first.id);
  assert.equal(versions[0].status, 'replaced');
  assert.equal(Buffer.from(file(admin, first.id).base64, 'base64').toString(), pdf('v1').toString());
  assert.throws(() => file(manager, first.id), /not in the library/);
  assert.throws(() => gs.uploadDocument_({ base64: pdf('v3').toString('base64'), fileName: 'v3.pdf', noPersonalInfo: true, replaceId: first.id, session: admin }), /no longer in the library/);
});

test('Word and Excel files get a Google print copy; the original is still what Download returns', () => {
  const { upload, file, store, tabs } = boot();
  const word = upload(manager, docx('Role play script'), { fileName: 'Role Play.docx', title: 'Role Play Script', category: 'Training', subcategory: 'Role-Play Materials' });
  assert.match(word.message, /Print copy made by Google from the Word file/);
  const doc = word.library.docs.find((item: any) => item.id === word.id);
  assert.equal(doc.type, 'Word');
  assert.equal(doc.hasPrintCopy, true);
  assert.equal(doc.printable, true);
  const original = file(manager, word.id, { purpose: 'original', action: 'download' });
  assert.equal(original.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual(Buffer.from(original.base64, 'base64'), docx('Role play script'));
  const print = file(manager, word.id, { purpose: 'print', action: 'print' });
  assert.equal(print.mime, 'application/pdf');
  assert.match(Buffer.from(print.base64, 'base64').toString(), /^%PDF-1\.4\nconverted /);
  assert.equal(print.fileName, 'Role Play Script (print copy).pdf');
  const printId = String(cell(tabs, tabs.CC_Documents!.at(-1)!, 'print_file_id'));
  assert.equal(store.folderOf(printId), 'Print copies (made by Google from Word and Excel files)');
  assert.ok(Object.values(store.files).filter((item) => item.converted).every((item) => item.trashed), 'the temporary Google conversion is trashed');
});

test('when Google cannot convert a Word file the library says so instead of offering a print copy', () => {
  const { upload, file } = boot({ convertFails: true });
  const result = upload(manager, xlsx('order checklist'), { fileName: 'Checklist.xlsx', title: 'Order Checklist', category: 'Tools' });
  const doc = result.library.docs.find((item: any) => item.id === result.id);
  assert.equal(doc.hasPrintCopy, false);
  assert.equal(doc.printable, false);
  assert.match(doc.printNote, /could not make a print copy.*print from Excel/);
  assert.throws(() => file(manager, result.id, { purpose: 'print' }), /has no print copy/);
});

test('the Sales login sees only documents shared with all staff, and cannot fetch the others', () => {
  const { upload, library, file } = boot();
  const key = upload(manager, pdf('answers'), { fileName: 'Quiz key.pdf', title: 'Day 1 Quiz Answer Key', category: 'New Hire', subcategory: 'Training Quizzes', audience: 'managers' });
  const open = upload(manager, pdf('floor'), { fileName: 'Floor.pdf', title: 'Floor Rules', category: 'Store Policies', audience: 'all', source: "Kane's company" });
  const seen = library(sales);
  assert.deepEqual(seen.docs.map((doc: any) => doc.title), ['Floor Rules']);
  assert.equal(seen.docs[0].source, "Kane's company");
  assert.equal(seen.canUpload, false);
  assert.equal(seen.packet, undefined);
  assert.equal(seen.removed, undefined);
  assert.throws(() => file(sales, key.id), /not available for this login/);
  assert.equal(Buffer.from(file(sales, open.id).base64, 'base64').toString(), pdf('floor').toString());
  assert.equal(library(manager).docs.length, 2);
});

test('the routes keep uploads to Manager and Admin and library changes to Admin', () => {
  const { gs } = boot();
  const routes = plain(gs.ROUTES_) as unknown as Record<string, string[]>;
  assert.deepEqual(routes.documents, ['sales', 'manager', 'admin']);
  assert.deepEqual(routes.docFile, ['sales', 'manager', 'admin']);
  assert.deepEqual(routes.uploadDocument, ['manager', 'admin']);
  assert.deepEqual(routes.editDocument, ['admin']);
  assert.deepEqual(routes.removeDocument, ['admin']);
  assert.deepEqual(routes.saveDocPacket, ['admin']);
});

test('the New Hire packet holds only approved, associate-facing New Hire documents in the Admin order', () => {
  const { upload, library, file, gs } = boot();
  const manual = upload(manager, pdf('manual'), { fileName: 'Manual.pdf', title: 'New Hire Manual', category: 'New Hire', audience: 'all' });
  const day2 = upload(manager, docx('day 2'), { fileName: 'Day 2.docx', title: 'Day 2 Materials', category: 'New Hire', audience: 'all' });
  const badge = upload(manager, png('badge'), { fileName: 'badge.png', title: 'Welcome Card', category: 'New Hire', audience: 'all' });
  const key = upload(manager, pdf('key'), { fileName: 'Key.pdf', title: 'Quiz Answer Key', category: 'New Hire', audience: 'managers' });
  const tools = upload(manager, pdf('tool'), { fileName: 'Tool.pdf', title: 'Tool Sheet', category: 'Tools', audience: 'all' });
  assert.deepEqual(library(admin).packetCandidates.sort(), [manual.id, day2.id, badge.id].sort());
  assert.throws(() => gs.saveDocPacket_({ ids: [manual.id, key.id], session: admin }), /"Quiz Answer Key" cannot go in the associate packet/);
  assert.throws(() => gs.saveDocPacket_({ ids: [tools.id], session: admin }), /cannot go in the associate packet/);
  assert.deepEqual(library(manager).packet ?? [], []);
  assert.throws(() => file(manager, manual.id, { purpose: 'packet' }), /not approved for the New Hire packet/);
  const saved = plain(gs.saveDocPacket_({ ids: [day2.id, manual.id], session: admin }));
  assert.match(saved.message, /holds 2 approved documents/);
  assert.deepEqual(library(manager).packet, [day2.id, manual.id]);
  assert.match(Buffer.from(file(manager, day2.id, { purpose: 'packet' }).base64, 'base64').toString(), /^%PDF-1\.4\nconverted /);
  assert.throws(() => file(manager, badge.id, { purpose: 'packet' }), /not approved/);
  assert.throws(() => file(sales, manual.id, { purpose: 'packet' }), /not available for this login/);
  const edited = plain(gs.editDocument_({ id: manual.id, audience: 'managers', session: admin }));
  assert.match(edited.message, /taken out of the New Hire packet/);
  assert.deepEqual(library(manager).packet, [day2.id]);
});

test('Admin edits move the file to its new category folder and refuse a title clash', () => {
  const { upload, gs, store, tabs, library } = boot();
  const one = upload(manager, pdf('a'), { fileName: 'Returns.pdf', title: 'Returns Guide', category: 'Tools' });
  upload(manager, pdf('b'), { fileName: 'Other.pdf', title: 'Returns Steps', category: 'Customer Service / CSR' });
  assert.throws(() => gs.editDocument_({ id: one.id, title: 'Returns Steps', category: 'Customer Service / CSR', session: admin }), /already in Customer Service \/ CSR.*Nothing was changed/);
  const result = plain(gs.editDocument_({ id: one.id, category: 'Customer Service / CSR', subcategory: 'Returns and Exchanges', documentDate: '2026-09-30', session: admin }));
  assert.match(result.message, /was saved/);
  const doc = library(manager).docs.find((item: any) => item.id === one.id);
  assert.equal(doc.category, 'Customer Service / CSR');
  assert.equal(doc.subcategory, 'Returns and Exchanges');
  assert.equal(doc.documentDate, '2026-09-30');
  assert.equal(doc.updatedBy, 'Admin (kelly)');
  const row = tabs.CC_Documents!.find((line) => line[0] === one.id)!;
  assert.equal(store.folderOf(String(cell(tabs, row, 'drive_file_id'))), 'Customer Service - CSR');
});

test('Admin removes, restores and deletes; removed files move to the Removed folder and leave the packet', () => {
  const { upload, gs, store, tabs, library } = boot();
  const manual = upload(manager, pdf('manual'), { fileName: 'Manual.pdf', title: 'New Hire Manual', category: 'New Hire', audience: 'all' });
  gs.saveDocPacket_({ ids: [manual.id], session: admin });
  const driveId = String(cell(tabs, tabs.CC_Documents!.at(-1)!, 'drive_file_id'));
  assert.throws(() => gs.removeDocument_({ id: manual.id, action: 'delete', session: admin }), /Remove the document first/);
  const removed = plain(gs.removeDocument_({ id: manual.id, action: 'remove', session: admin }));
  assert.match(removed.message, /removed from the library/);
  assert.equal(store.folderOf(driveId), 'Removed (admin can restore)');
  assert.equal(library(manager).docs.length, 0);
  assert.deepEqual(library(manager).packet, []);
  assert.deepEqual(library(admin).removed.map((doc: any) => doc.id), [manual.id]);
  upload(manager, pdf('other manual'), { fileName: 'Manual2.pdf', title: 'New Hire Manual', category: 'New Hire' });
  assert.throws(() => gs.removeDocument_({ id: manual.id, action: 'restore', session: admin }), /already in New Hire.*not restored/);
  const clashing = library(manager).docs[0];
  gs.removeDocument_({ id: clashing.id, action: 'remove', session: admin });
  gs.removeDocument_({ id: manual.id, action: 'restore', session: admin });
  assert.equal(store.folderOf(driveId), 'New Hire');
  assert.deepEqual(library(manager).docs.map((doc: any) => doc.id), [manual.id]);
  gs.removeDocument_({ id: clashing.id, action: 'delete', session: admin });
  const deletedRow = tabs.CC_Documents!.find((line) => line[0] === clashing.id)!;
  assert.equal(cell(tabs, deletedRow, 'status'), 'deleted');
  assert.equal(store.files[String(cell(tabs, deletedRow, 'drive_file_id'))]!.trashed, true);
  assert.equal(library(admin).removed.length, 0);
});

test('Frequently used counts only real opens of documents the login can see', () => {
  const { upload, library, file } = boot();
  const a = upload(manager, pdf('a'), { fileName: 'a.pdf', title: 'Alpha', category: 'Tools', audience: 'all' });
  const b = upload(manager, pdf('b'), { fileName: 'b.pdf', title: 'Bravo', category: 'Tools', audience: 'managers' });
  assert.deepEqual(library(manager).frequent, []);
  assert.equal(library(manager).trackingSince, '');
  file(manager, a.id, { action: 'view' });
  file(manager, b.id, { action: 'view' });
  file(manager, b.id, { action: 'download' });
  file(manager, b.id, { action: 'print', purpose: 'print' });
  assert.deepEqual(library(manager).frequent, [{ id: b.id, uses: 3 }, { id: a.id, uses: 1 }]);
  assert.deepEqual(library(sales).frequent, [{ id: a.id, uses: 1 }]);
  assert.match(library(manager).trackingSince, /^\d{4}-/);
});

test('a large file comes back in parts that join to the original, and text that looks like a formula stays text', () => {
  const { upload, file, tabs } = boot();
  const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(9 * 1024 * 1024, 0x41)]);
  const result = upload(manager, bytes, { fileName: '=cmd.pdf', title: '=HYPERLINK("http://x","y")', category: 'Training' });
  const parts: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const part = file(manager, result.id, { offset });
    parts.push(Buffer.from(part.base64, 'base64'));
    offset += parts.at(-1)!.length;
    if (part.done) break;
  }
  assert.equal(parts.length, 3);
  assert.deepEqual(Buffer.concat(parts), bytes);
  const row = tabs.CC_Documents!.at(-1)!;
  assert.equal(cell(tabs, row, 'title'), '\'=HYPERLINK("http://x","y")');
  assert.equal(result.library.docs[0].title, '=HYPERLINK("http://x","y")');
  assert.equal(result.library.docs[0].fileName, '=cmd.pdf');
});
