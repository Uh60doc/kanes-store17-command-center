/** Small XLSX reader. A blank shared string stays blank, never the string index. */

import { inflateRawSync } from 'node:zlib';

/** Sizes come from the central directory: archives written with data descriptors leave them 0 in the local headers. */
export function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 0xffff); at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP archive.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('The ZIP central directory is damaged.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`Unsupported ZIP method ${method} in ${name}`);
    files.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function sharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const block of xml.split(/<si\b/i).slice(1)) {
    const body = block.split(/<\/si>/i)[0] ?? '';
    const texts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => decodeXml(match[1] ?? ''));
    strings.push(texts.join(''));
  }
  return strings;
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '');
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function rowNumber(ref: string): number {
  return Number(ref.replace(/[A-Z]/gi, ''));
}

/** Sheet rows. Missing cells and blank shared strings are null. */
export function sheetRows(xml: string, strings: readonly string[]): (string | null)[][] {
  const rows = new Map<number, (string | null)[]>();
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const ref = /r="([A-Z]+[0-9]+)"/i.exec(attrs)?.[1];
    if (!ref) continue;
    const type = /t="([^"]+)"/i.exec(attrs)?.[1] ?? '';
    const row = rowNumber(ref);
    const column = columnIndex(ref);
    const line = rows.get(row) ?? [];
    let value: string | null = null;
    if (type === 's') {
      const index = Number(/<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? '');
      const text = Number.isInteger(index) ? strings[index] : undefined;
      value = text === undefined || text.trim() === '' ? null : text;
    } else if (type === 'inlineStr') {
      const text = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXml(item[1] ?? '')).join('');
      value = text.trim() === '' ? null : text;
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/i.exec(body)?.[1];
      value = raw === undefined || raw.trim() === '' ? null : decodeXml(raw);
    }
    line[column] = value;
    rows.set(row, line);
  }
  return [...rows.keys()].sort((left, right) => left - right).map((row) => rows.get(row) ?? []);
}

export function firstSheet(files: Map<string, Buffer>): (string | null)[][] {
  const strings = files.has('xl/sharedStrings.xml') ? sharedStrings(files.get('xl/sharedStrings.xml')!.toString('utf8')) : [];
  const name = [...files.keys()].find((item) => item.startsWith('xl/worksheets/sheet'));
  if (!name) throw new Error('Workbook has no worksheet.');
  return sheetRows(files.get(name)!.toString('utf8'), strings);
}
