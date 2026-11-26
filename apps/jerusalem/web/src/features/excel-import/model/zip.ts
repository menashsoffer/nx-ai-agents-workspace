// The two zip operations an .xlsx file needs, on the browser's own DecompressionStream: read the
// entries of an uploaded workbook, and write the downloadable template without compression.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Why an archive was refused; `bomb` is a file that grows far beyond its size when opened. */
export type ZipProblem = 'broken' | 'bomb' | 'compression';
export class ZipError extends Error {
  readonly problem: ZipProblem;
  constructor(problem: ZipProblem) {
    super(`zip: ${problem}`);
    this.problem = problem;
  }
}

/** Limits for an opened workbook: a real supplier file is far below both. */
export const MAX_ENTRIES = 1000;
export const MAX_UNPACKED = 60 * 1024 * 1024;

function endOfDirectory(view: DataView): number {
  const last = Math.max(0, view.byteLength - 65_557);
  for (let at = view.byteLength - 22; at >= last; at -= 1) {
    if (view.getUint32(at, true) === EOCD) return at;
  }
  throw new ZipError('broken');
}

interface Entry {
  method: number;
  size: number;
  unpacked: number;
  offset: number;
}

function centralEntries(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  if (count > MAX_ENTRIES) throw new ZipError('bomb');
  const names = new TextDecoder();
  const entries = new Map<string, Entry>();
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(at, true) !== CENTRAL) throw new ZipError('broken');
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      size: view.getUint32(at + 20, true),
      unpacked: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + skip;
  }
  return entries;
}

/** Inflates one entry, and stops as soon as it grows past what is left of the limit. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  // A reader loop, not `for await`: Safari cannot iterate a stream that way.
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.length;
    if (total > limit) {
      await reader.cancel();
      throw new ZipError('bomb');
    }
    chunks.push(next.value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Every entry name in the archive, to look for parts a supplier file must not carry. */
export function zipNames(bytes: Uint8Array): string[] {
  return [...centralEntries(bytes).keys()];
}

/** Reads the named entries of a zip archive as text; a missing entry is left out. */
export async function readZipText(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  const result = new Map<string, string>();
  const entries = centralEntries(bytes);
  let left = MAX_UNPACKED;
  for (const [name, entry] of entries) {
    if (!wanted(name)) continue;
    if (view.getUint32(entry.offset, true) !== LOCAL) throw new ZipError('broken');
    const start =
      entry.offset +
      30 +
      view.getUint16(entry.offset + 26, true) +
      view.getUint16(entry.offset + 28, true);
    const raw = bytes.subarray(start, start + entry.size);
    if (entry.method !== 0 && entry.method !== 8) throw new ZipError('compression');
    const data = entry.method === 8 ? await inflate(raw, left) : raw;
    left -= data.length;
    if (left < 0) throw new ZipError('bomb');
    result.set(name, text.decode(data));
  }
  return result;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function header(size: number, fields: [number, number, 2 | 4][]): Uint8Array {
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (const [at, value, width] of fields) {
    if (width === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
  }
  return out;
}

/** A zip archive of stored (uncompressed) text files, in the given order. */
export function writeZip(files: [string, string][]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const path = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const sizes: [number, number, 2 | 4][] = [
      [14, crc, 4],
      [18, data.length, 4],
      [22, data.length, 4],
      [26, path.length, 2],
    ];
    const local = header(30, [[0, LOCAL, 4], [4, 20, 2], [6, 0x800, 2], ...sizes]);
    const central = header(46, [
      [0, CENTRAL, 4],
      [4, 20, 2],
      [6, 20, 2],
      [8, 0x800, 2],
      ...sizes.map(([at, v, w]): [number, number, 2 | 4] => [at + 2, v, w]),
      [42, offset, 4],
    ]);
    parts.push(local, path, data);
    directory.push(central, path);
    offset += local.length + path.length + data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = header(22, [
    [0, EOCD, 4],
    [8, files.length, 2],
    [10, files.length, 2],
    [12, size, 4],
    [16, offset, 4],
  ]);
  const all = [...parts, ...directory, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
