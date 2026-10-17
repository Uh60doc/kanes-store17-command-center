import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const signed = (bytes: Uint8Array | number[]) => Array.from(bytes, (b) => (b > 127 ? b - 256 : b));
const unsigned = (bytes: ArrayLike<number>) => Uint8Array.from(Array.from(bytes, (b) => (b < 0 ? b + 256 : b)));

/** Reads a ZIP archive (stored or deflated entries) into { name: bytes }. */
export function unzipEntries(data: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not a zip archive');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i += 1) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = data.subarray(start, start + size);
    out[name] = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

export function blob(bytes: ArrayLike<number>, type = '', name = '') {
  const data = unsigned(bytes);
  const self = {
    getBytes: () => signed(data),
    getName: () => name,
    getContentType: () => type,
    getDataAsString: () => new TextDecoder().decode(data),
    setName: (next: string) => { name = next; return self; },
  };
  return self;
}

/** Utilities, DriveApp and PropertiesService with the calls the evaluation code makes. */
export function appsScriptServices() {
  const files: Record<string, { name: string; bytes: Uint8Array; folder: string; description?: string }> = {};
  const folders: Record<string, { name: string; parent: string }> = {};
  const props: Record<string, string> = {};
  let nextId = 1;
  const folder = (id: string) => ({
    getId: () => id,
    createFolder: (name: string) => {
      const childId = `folder-${++nextId}`;
      folders[childId] = { name, parent: id };
      return folder(childId);
    },
    createFile: (input: ReturnType<typeof blob>) => {
      const fileId = `file-${nextId++}`;
      files[fileId] = { name: input.getName(), bytes: unsigned(input.getBytes()), folder: id };
      const file = { getId: () => fileId, setDescription: (text: string) => { files[fileId]!.description = text; return file; } };
      return file;
    },
  });
  /** "Root/2026/2026-10/2026-10-14" for a folder id. */
  const pathOf = (id: string): string => (folders[id] ? (folders[id]!.parent ? `${pathOf(folders[id]!.parent)}/` : '') + folders[id]!.name : id);
  return {
    files,
    folders,
    pathOf,
    props,
    services: {
      Utilities: {
        formatDate: (date: Date) => date.toISOString().slice(0, 10),
        getUuid: () => Math.random().toString(16).slice(2),
        base64Decode: (text: string) => signed(Buffer.from(text, 'base64')),
        base64Encode: (bytes: number[]) => Buffer.from(unsigned(bytes)).toString('base64'),
        DigestAlgorithm: { SHA_256: 'sha256' },
        computeDigest: (_algorithm: string, bytes: number[]) => signed(createHash('sha256').update(unsigned(bytes)).digest()),
        newBlob: (bytes: number[], type?: string, name?: string) => blob(bytes, type, name),
        unzip: (archive: ReturnType<typeof blob>) => Object.entries(unzipEntries(unsigned(archive.getBytes()))).map(([name, bytes]) => blob(bytes, '', name)),
      },
      PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null, setProperty: (key: string, value: string) => { props[key] = value; } }) },
      DriveApp: {
        createFolder: (name = '') => { folders['folder-1'] = { name, parent: '' }; return folder('folder-1'); },
        getFolderById: (id: string) => folder(id),
        getFileById: (id: string) => {
          if (!files[id]) throw new Error('no such file');
          return { getBlob: () => blob(files[id]!.bytes, '', files[id]!.name) };
        },
      },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
    },
  };
}
