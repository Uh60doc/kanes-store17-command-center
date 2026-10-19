/**
 * The ZIP opener lives in the upload page. These cases run that same function: one day, two days,
 * PDF and Excel together, duplicates, a bad entry, an unsupported file, and a nested PERQ zip.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';

const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('/* ZIP_BATCH_START */'), html.indexOf('/* ZIP_BATCH_END */'));
const sandbox: Record<string, unknown> = {
  Uint8Array, DataView, TextDecoder, Blob, Response, DecompressionStream, Promise, File,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'Index.html' });
const unzip = sandbox.unzipStoreReports as (buffer: Uint8Array) => { error?: string; files: { name: string; method: number; rawSize: number; compressed: Uint8Array }[]; skipped: { name: string; status: string; message: string }[] };
const inflate = sandbox.inflateZipEntry as (entry: { name: string; method: number; rawSize: number; compressed: Uint8Array }) => Promise<Uint8Array>;

function zip(entries: { name: string; data: Buffer; method?: number; storeRaw?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const stored = method === 8 && !entry.storeRaw ? deflateRawSync(entry.data) : entry.data;
    const nameBytes = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const body = Buffer.concat([local, nameBytes, stored]);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(stored.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(body);
    central.push(Buffer.concat([header, nameBytes]));
    offset += body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('a ZIP of PDF and Excel files across two days opens, and unsafe entries do not', async () => {
  const names = [
    ...Array.from({ length: 10 }, (_, i) => `day17/report-${i}.pdf`),
    ...Array.from({ length: 10 }, (_, i) => `day18/report-${i}.xlsx`),
  ];
  const entries = names.map((name, i) => ({ name, data: Buffer.from(`report ${i} ${name}`) }));
  entries.push({ name: '__MACOSX/._report-0.pdf', data: Buffer.from('junk') });
  entries.push({ name: 'notes.txt', data: Buffer.from('ignore me') });
  entries.push({ name: '../secret.pdf', data: Buffer.from('nope') });
  entries.push({ name: 'day17/broken.pdf', data: Buffer.from('short'), method: 8, storeRaw: true });
  const archive = zip(entries);
  // The broken entry claims deflate but the bytes are plain text. Inflating it fails; the others still open.
  const opened = unzip(archive);
  assert.equal(opened.error, undefined);
  assert.equal(opened.files.length, 21);
  assert.ok(opened.skipped.some((item) => item.name === 'notes.txt' && item.status === 'Ignored'));
  assert.ok(opened.skipped.some((item) => item.name === 'secret.pdf' && /not safe/.test(item.message)));
  assert.equal(opened.skipped.some((item) => item.name.startsWith('._')), false);
  const first = await inflate(opened.files[0]!);
  assert.equal(new TextDecoder().decode(first), 'report 0 day17/report-0.pdf');
  const excel = opened.files.find((file) => file.name === 'report-0.xlsx')!;
  assert.equal(new TextDecoder().decode(await inflate(excel)), 'report 10 day18/report-0.xlsx');
  await assert.rejects(inflate(opened.files.find((file) => file.name === 'broken.pdf')!));
});

test('a deflated workbook and a nested ZIP both expand to the original bytes', async () => {
  const inner = zip([{ name: 'Performance Stats by Salesperson.xlsx', data: Buffer.from('perq-bytes') }]);
  const outer = zip([
    { name: 'SNAP.pdf', data: Buffer.from('%PDF-1.4 snap'), method: 8 },
    { name: 'Performance Stats by Salesperson.zip', data: inner },
    { name: 'SNAP.pdf', data: Buffer.from('%PDF-1.4 snap copy') },
  ]);
  const opened = unzip(outer);
  assert.deepEqual(JSON.parse(JSON.stringify(opened.files.map((file) => file.name))), ['SNAP.pdf', 'Performance Stats by Salesperson.zip', 'SNAP.pdf']);
  assert.equal(new TextDecoder().decode(await inflate(opened.files[0]!)), '%PDF-1.4 snap');
  const nested = unzip(await inflate(opened.files[1]!));
  assert.equal(nested.files[0]!.name, 'Performance Stats by Salesperson.xlsx');
  assert.equal(new TextDecoder().decode(await inflate(nested.files[0]!)), 'perq-bytes');
});

test('an incomplete ZIP is refused instead of returning a partial report', () => {
  const archive = zip([{ name: 'one.pdf', data: Buffer.from('%PDF') }]);
  const cut = unzip(archive.subarray(0, 20));
  assert.match(cut.error || '', /could not be opened/);
});
