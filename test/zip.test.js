import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { createZip, crc32 } from "../src/lib/zip.js";

/* An independent reader: walks the central directory and inflates with
   node:zlib, sharing no code with the writer under test. If the writer
   and the reader agreed only because they made the same mistake, this
   would not catch it — so CRCs are re-checked with zlib.crc32 too. */
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  expect(eocd, "end-of-central-directory signature").toBeGreaterThanOrEqual(0);

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const rawSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);

    expect(dv.getUint32(lho, true), `local header for ${name}`).toBe(0x04034b50);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const payload = buf.subarray(start, start + compSize);
    const raw = method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload);
    out.push({ name, method, flags, crc, rawSize, compSize, text: raw.toString("utf8"), raw, time, date });
  }
  return out;
}

const CLOCK = new Date(Date.UTC(2026, 7, 31, 0, 0, 0));

describe("zip writer", () => {
  const entries = [
    { name: "AUGUST-2026-CORPUS_Master_File.md", text: "# master\n" + "the quick brown fox. ".repeat(5000) },
    { name: "AUGUST-2026-CORPUS_AI_File.md", text: "# ai\n₱25.5M – ₱27.3M\n97–120 sqm\n" },
  ];

  it("round-trips every entry byte-for-byte", async () => {
    const read = readZip(await createZip(entries, { modifiedAt: CLOCK }));
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, e] of read.entries()) {
      expect(e.text, e.name).toBe(entries[i].text);
      expect(e.rawSize).toBe(Buffer.byteLength(entries[i].text, "utf8"));
    }
  });

  it("records a CRC-32 that an independent implementation agrees with", async () => {
    const read = readZip(await createZip(entries, { modifiedAt: CLOCK }));
    for (const e of read) {
      expect(zlib.crc32(e.raw), `${e.name} vs node:zlib`).toBe(e.crc);
      expect(crc32(new Uint8Array(e.raw)), `${e.name} vs our own`).toBe(e.crc);
    }
  });

  it("deflates compressible content and stores what deflate would grow", async () => {
    const read = readZip(await createZip(entries, { modifiedAt: CLOCK }));
    expect(read[0].method, "repetitive text should deflate").toBe(8);
    expect(read[0].compSize).toBeLessThan(read[0].rawSize / 4);
    // A short, high-entropy entry must never end up larger than stored.
    const tiny = readZip(await createZip([{ name: "t", text: "x" }], { modifiedAt: CLOCK }));
    expect(tiny[0].compSize).toBeLessThanOrEqual(tiny[0].rawSize);
  });

  it("stores verbatim when compression is off, and reads back the same", async () => {
    const read = readZip(await createZip(entries, { modifiedAt: CLOCK, compress: false }));
    expect(read.every((e) => e.method === 0)).toBe(true);
    for (const [i, e] of read.entries()) expect(e.text).toBe(entries[i].text);
  });

  it("flags names as UTF-8 and survives a non-ASCII filename", async () => {
    const name = "PROJECT-DEVELOPMENT-–-PRIMING-&-INNOVATION.md";
    const read = readZip(await createZip([{ name, text: "x" }], { modifiedAt: CLOCK }));
    expect(read[0].name).toBe(name);
    expect(read[0].flags & 0x0800, "UTF-8 name flag").toBe(0x0800);
  });

  it("is deterministic — the same inputs give the same archive bytes", async () => {
    const a = await createZip(entries, { modifiedAt: CLOCK });
    const b = await createZip(entries, { modifiedAt: CLOCK });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("stamps the clock it is given rather than the wall clock", async () => {
    const read = readZip(await createZip(entries, { modifiedAt: CLOCK }));
    const expected = {
      date: ((2026 - 1980) << 9) | (8 << 5) | 31,
      time: 0,
    };
    for (const e of read) {
      expect(e.date).toBe(expected.date);
      expect(e.time).toBe(expected.time);
    }
  });
});
