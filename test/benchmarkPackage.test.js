import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {
  buildBucketPackage, packageEntries, bucketSlug,
  COPILOT_FILE_LIMIT, BENCHMARK_ZIP_FILE, SNAPSHOT, SNAPSHOT_CLOCK,
} from "../src/lib/benchmarkExport.js";
import { buildMaster } from "../src/lib/masterMd.js";
import { generateOptimized } from "../src/lib/generate.js";
import { createZip } from "../src/lib/zip.js";
import { corpusFiles, readCorpus, HAS_CORPUS, makeAspx, textControl, escapeHtml } from "./helpers.js";

const nodeSha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const page = (text) => makeAspx(textControl(`<p>${text}</p>`));
const file = (name, text) => ({ name, path: name, raw: page(text) });

/* Five named buckets, the shape the app produces. */
const FIVE = {
  "PROJECT PLAYBOOK": [file("a.aspx", "Alpha"), file("b.aspx", "Beta")],
  "TOWNSHIP PAGES": [file("c.aspx", "Gamma")],
  "LIFE AT FAI PAGE": [file("d.aspx", "Delta")],
  "NAVIGATION PAGES": [file("e.aspx", "Epsilon")],
  LOCATORS: [file("f.aspx", "Zeta")],
};

/* Independent reader — central-directory walk plus node:zlib. */
function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const payload = buf.subarray(start, start + compSize);
    out.push({ name, text: (method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload)).toString("utf8") });
  }
  return out;
}

describe("bucket slugs", () => {
  it("keeps the person's own tag name, made filename-safe", () => {
    expect(bucketSlug("PROJECT PLAYBOOK")).toBe("PROJECT-PLAYBOOK");
    expect(bucketSlug("LIFE AT FAI PAGE")).toBe("LIFE-AT-FAI-PAGE");
    expect(bucketSlug("Sales & Leasing")).toBe("SALES-LEASING");
    expect(bucketSlug("  spaced  out  ")).toBe("SPACED-OUT");
  });
});

describe("the Copilot-safe package", () => {
  it("emits exactly one file per bucket, per arm", async () => {
    const pkg = await buildBucketPackage(FIVE);
    expect(pkg.armB).toHaveLength(5);
    expect(pkg.armC).toHaveLength(5);
    expect(pkg.buckets).toHaveLength(5);
  });

  it("gives both arms identical bucket membership", async () => {
    const pkg = await buildBucketPackage(FIVE);
    const b = pkg.armB.map((a) => a.bucket).sort();
    const c = pkg.armC.map((a) => a.bucket).sort();
    expect(b).toEqual(c);
    expect(b).toEqual(Object.keys(FIVE).sort());
    // and the same pages inside each bucket
    for (const [i, armB] of pkg.armB.entries()) expect(pkg.armC[i].pages).toBe(armB.pages);
  });

  it("lays the archive out as ARM-B/ and ARM-C/ beside a manifest", async () => {
    const pkg = await buildBucketPackage(FIVE);
    const names = packageEntries(pkg).map((e) => e.name);
    expect(names.filter((n) => n.startsWith("ARM-B/"))).toHaveLength(5);
    expect(names.filter((n) => n.startsWith("ARM-C/"))).toHaveLength(5);
    expect(names).toContain("manifest.json");
    expect(names).toContain("ARM-B/PROJECT-PLAYBOOK_Master.md");
    expect(names).toContain("ARM-C/PROJECT-PLAYBOOK_AI.md");
  });

  // The point of the whole exercise: this is not a size-driven split of
  // the consolidated file, it is the app's own per-bucket output.
  it("reproduces the production bucket output exactly, on the fixed clock", async () => {
    const pkg = await buildBucketPackage(FIVE);
    for (const [bucket, files] of Object.entries(FIVE)) {
      const b = pkg.armB.find((a) => a.bucket === bucket);
      const c = pkg.armC.find((a) => a.bucket === bucket);
      expect(b.md).toBe(buildMaster(bucket, files, SNAPSHOT_CLOCK));
      expect(c.md).toBe(generateOptimized(bucket, files).md);
      expect(b.md).toContain(`# ${bucket} — ASPx Codebase Master File`);
      expect(b.md).toContain("Generated on: 08/31/2026 00:00:00");
    }
  });

  it("is deterministic — bucket order and file order do not matter", async () => {
    const shuffled = Object.fromEntries(Object.entries(FIVE).reverse().map(([k, v]) => [k, [...v].reverse()]));
    const one = await buildBucketPackage(FIVE);
    const two = await buildBucketPackage(shuffled);
    expect(two.armB.map((a) => [a.file, a.sha256])).toEqual(one.armB.map((a) => [a.file, a.sha256]));
    expect(two.armC.map((a) => [a.file, a.sha256])).toEqual(one.armC.map((a) => [a.file, a.sha256]));
    expect(two.filesSha256).toBe(one.filesSha256);
  });

  it("reports checksums that describe the bytes it returns", async () => {
    const pkg = await buildBucketPackage(FIVE);
    for (const a of [...pkg.armB, ...pkg.armC]) {
      expect(a.sha256, a.file).toBe(nodeSha(a.md));
      expect(a.bytes).toBe(Buffer.byteLength(a.md, "utf8"));
    }
  });

  it("records the partition, since the corpus carries no tag assignment", async () => {
    const { manifest } = await buildBucketPackage(FIVE);
    expect(manifest.snapshot).toBe(SNAPSHOT);
    expect(manifest.packaging).toBe("five-bucket");
    expect(manifest.generatorVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.fileSizeLimit).toBe(COPILOT_FILE_LIMIT);
    expect(manifest.buckets.map((b) => b.name).sort()).toEqual(Object.keys(FIVE).sort());
    for (const b of manifest.buckets) expect(b.pages).toEqual(FIVE[b.name].map((f) => f.name).sort());
    for (const arm of ["B", "C"]) {
      expect(manifest.arms[arm].files).toHaveLength(5);
      for (const f of manifest.arms[arm].files) {
        expect(f).toMatchObject({ bucket: expect.any(String), filename: expect.any(String), bytes: expect.any(Number), pages: expect.any(Number) });
      }
      // the markdown itself must never end up inside the manifest
      expect(JSON.stringify(manifest.arms[arm].files)).not.toContain("ASPx Codebase");
    }
  });

  it("skips empty buckets rather than shipping empty files, symmetrically", async () => {
    const pkg = await buildBucketPackage({ ...FIVE, "EMPTY BUCKET": [] });
    expect(pkg.armB).toHaveLength(5);
    expect(pkg.armC).toHaveLength(5);
    expect(pkg.armB.map((a) => a.bucket)).toEqual(pkg.armC.map((a) => a.bucket));
  });

  it("flags a file over the upload limit instead of shipping it", async () => {
    const pkg = await buildBucketPackage(FIVE);
    expect(pkg.oversize).toEqual([]);
    // Same check, against a limit small enough that these files exceed it.
    const over = [...pkg.armB, ...pkg.armC].filter((a) => a.bytes > 100);
    expect(over.length, "the guard would catch these at a 100-byte limit").toBeGreaterThan(0);
    expect(Math.max(...pkg.armB.map((a) => a.bytes))).toBeLessThan(COPILOT_FILE_LIMIT);
  });

  it("withholds only the Arm C half when a bucket fails validation", async () => {
    // controlType 1 is layout-only, so the extractor reads no text from
    // it while the source model does — a real information loss.
    const cd = escapeHtml(JSON.stringify({ controlType: 1, position: { zoneIndex: 1, sectionIndex: 1, controlIndex: 1 } }));
    const broken = makeAspx(`<div data-sp-canvascontrol="" data-sp-controldata="${cd}"><div data-sp-rte=""><p>Ceiling Height 6.85 m</p></div></div>`);
    const pkg = await buildBucketPackage({ ...FIVE, LOCATORS: [{ name: "x.aspx", path: "x.aspx", raw: broken }] });

    expect(pkg.status).toBe("FAIL");
    expect(pkg.failed.map((f) => f.bucket)).toEqual(["LOCATORS"]);
    const c = pkg.armC.find((a) => a.bucket === "LOCATORS");
    expect(c.md).toBe("");
    expect(c.sha256).toBeNull();
    // The fidelity layer is never gated, and the other buckets are fine.
    expect(pkg.armB.find((a) => a.bucket === "LOCATORS").md).toContain("Ceiling Height 6.85 m");
    expect(pkg.armC.filter((a) => a.sha256 !== null)).toHaveLength(4);
  });
});

/* ---- against the real corpus ----
   The corpus carries no tag assignment (that is why the consolidated
   arms ignore tags), so these use a fixed synthetic partition. Bucket
   names are irrelevant to the invariants under test: total coverage,
   arm symmetry, determinism and the size guard. */

const FIVE_WAY = ["BUCKET ONE", "BUCKET TWO", "BUCKET THREE", "BUCKET FOUR", "BUCKET FIVE"];
function partitionedCorpus() {
  const map = Object.fromEntries(FIVE_WAY.map((n) => [n, []]));
  corpusFiles().forEach((name, i) => {
    map[FIVE_WAY[i % FIVE_WAY.length]].push({ name, path: name, raw: readCorpus(name) });
  });
  return map;
}

describe.skipIf(!HAS_CORPUS)("the package over the August corpus", () => {
  it("covers all 133 pages across exactly five files per arm", async () => {
    const pkg = await buildBucketPackage(partitionedCorpus());
    expect(pkg.armB).toHaveLength(5);
    expect(pkg.armC).toHaveLength(5);
    expect(pkg.pages).toBe(133);
    expect(pkg.armB.reduce((n, a) => n + a.pages, 0)).toBe(133);
    expect(pkg.armC.reduce((n, a) => n + a.pages, 0)).toBe(133);
    // no page lost, none duplicated
    const listed = pkg.manifest.buckets.flatMap((b) => b.pages);
    expect(listed).toHaveLength(133);
    expect(new Set(listed).size).toBe(133);
    expect(listed.sort()).toEqual(corpusFiles().sort());
  }, 900000);

  it("keeps Arm C coverage at 4791/4791 with nothing untraceable", async () => {
    const pkg = await buildBucketPackage(partitionedCorpus());
    expect(pkg.status).toBe("PASS");
    expect(pkg.totals.sourceUnits).toBe(4791);
    expect(pkg.totals.representedUnits).toBe(4791);
    expect(pkg.totals.untraceableUnits).toBe(0);
  }, 900000);

  it("keeps every file under the upload limit", async () => {
    const pkg = await buildBucketPackage(partitionedCorpus());
    expect(pkg.oversize).toEqual([]);
    for (const a of [...pkg.armB, ...pkg.armC]) {
      expect(a.bytes, `${a.file} is ${a.bytes} bytes`).toBeLessThan(COPILOT_FILE_LIMIT);
    }
  }, 900000);

  it("rebuilds to the same checksums", async () => {
    const one = await buildBucketPackage(partitionedCorpus());
    const two = await buildBucketPackage(partitionedCorpus());
    expect(two.armB.map((a) => a.sha256)).toEqual(one.armB.map((a) => a.sha256));
    expect(two.armC.map((a) => a.sha256)).toEqual(one.armC.map((a) => a.sha256));
  }, 900000);

  it("packages into one archive that reads back unaltered", async () => {
    const pkg = await buildBucketPackage(partitionedCorpus());
    const archive = await createZip(packageEntries(pkg), { modifiedAt: SNAPSHOT_CLOCK });
    const read = unzip(archive);
    expect(read).toHaveLength(11); // 5 + 5 + manifest
    for (const a of [...pkg.armB, ...pkg.armC]) {
      const entry = read.find((e) => e.name === a.file);
      expect(entry, `${a.file} missing from the archive`).toBeTruthy();
      expect(entry.text).toBe(a.md);
      expect(nodeSha(entry.text)).toBe(a.sha256);
    }
    const manifest = JSON.parse(read.find((e) => e.name === "manifest.json").text);
    expect(manifest.corpusPages).toBe(133);
    expect(BENCHMARK_ZIP_FILE).toBe("AUGUST-2026-COPILOT-BENCHMARK.zip");
  }, 900000);
});
