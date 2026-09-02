/* ------------------------------------------------------------------ *
 * Minimal ZIP writer.
 *
 * The app has always READ zips — readZip() in App.jsx walks the central
 * directory and inflates entries through the browser's native
 * DecompressionStream. Handing someone both benchmark arms as one
 * download needs the mirror of that, and CompressionStream is the same
 * native API in the other direction, so this stays dependency-free in
 * keeping with the rest of the project.
 *
 * Deliberately small: stored or deflated entries, no zip64, no
 * encryption, no directory entries. Sizes are 32-bit, which is correct
 * for two Markdown files (the larger is ~37 MB against a 4 GB ceiling)
 * and would need revisiting for anything approaching that.
 *
 * Deterministic: entry timestamps come from the caller rather than the
 * wall clock, so the same inputs produce the same archive bytes.
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Written straight into the stream and drained with a reader loop
// rather than via Blob.stream()/Response: those are browser-complete but
// only partly implemented under jsdom, and the writer is worth testing.
async function deflateRaw(bytes) {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = stream.readable.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ZIP keeps modification time as packed 16-bit DOS values — the same
// encoding readZip() decodes on the way in.
function dosDateTime(date) {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

class Writer {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  bytes(u8) {
    this.parts.push(u8);
    this.length += u8.length;
  }
  header(fields) {
    // Every ZIP record is a flat run of little-endian 16/32-bit fields.
    const size = fields.reduce((n, [width]) => n + width, 0);
    const out = new DataView(new ArrayBuffer(size));
    let at = 0;
    for (const [width, value] of fields) {
      if (width === 2) out.setUint16(at, value, true);
      else out.setUint32(at, value, true);
      at += width;
    }
    this.bytes(new Uint8Array(out.buffer));
  }
}

/**
 * @param entries [{ name, text }]  — file name and UTF-8 content
 * @param modifiedAt  stamped into every entry; fixed by the caller so
 *                    the archive is reproducible
 * @param compress    false stores entries verbatim (used when
 *                    CompressionStream is unavailable, and by tests)
 * @returns Uint8Array  the archive bytes; the caller decides whether
 *                    they become a Blob, a download, or a file on disk
 */
export async function createZip(entries, { modifiedAt = new Date(0), compress = true } = {}) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modifiedAt);
  const useDeflate = compress && typeof globalThis.CompressionStream === "function";
  const out = new Writer();
  const records = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const raw = encoder.encode(entry.text);
    const body = useDeflate ? await deflateRaw(raw) : raw;
    // Deflate can grow incompressible input; storing is then both
    // smaller and cheaper to read back.
    const stored = body.length >= raw.length;
    const payload = stored ? raw : body;
    const record = {
      name,
      method: stored ? 0 : 8,
      crc: crc32(raw),
      compSize: payload.length,
      rawSize: raw.length,
      offset: out.length,
    };
    // 0x0800 marks the name as UTF-8, which the corpus needs: one page
    // is named with an en dash.
    out.header([
      [4, 0x04034b50], [2, 20], [2, 0x0800], [2, record.method], [2, time], [2, date],
      [4, record.crc], [4, record.compSize], [4, record.rawSize], [2, name.length], [2, 0],
    ]);
    out.bytes(name);
    out.bytes(payload);
    records.push(record);
  }

  const centralStart = out.length;
  for (const r of records) {
    out.header([
      [4, 0x02014b50], [2, 20], [2, 20], [2, 0x0800], [2, r.method], [2, time], [2, date],
      [4, r.crc], [4, r.compSize], [4, r.rawSize], [2, r.name.length], [2, 0], [2, 0],
      [2, 0], [2, 0], [4, 0], [4, r.offset],
    ]);
    out.bytes(r.name);
  }
  const centralSize = out.length - centralStart;

  out.header([
    [4, 0x06054b50], [2, 0], [2, 0], [2, records.length], [2, records.length],
    [4, centralSize], [4, centralStart], [2, 0],
  ]);

  const archive = new Uint8Array(out.length);
  let at = 0;
  for (const part of out.parts) { archive.set(part, at); at += part.length; }
  return archive;
}
