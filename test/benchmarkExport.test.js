import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildBenchmarkArtifacts,
  compareToCanonical,
  CANONICAL,
  SNAPSHOT,
  SNAPSHOT_CLOCK,
  sha256,
} from "../src/lib/benchmarkExport.js";
import { buildMaster } from "../src/lib/masterMd.js";
import { generateOptimized } from "../src/lib/generate.js";
import { corpusFiles, readCorpus, HAS_CORPUS, makeAspx, textControl, escapeHtml } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `bx-${label}-`));
const nodeSha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const loadCorpus = () => corpusFiles().map((name) => ({ name, path: name, raw: readCorpus(name) }));

/* ---- the snapshot identity is frozen; changing it changes what a
       benchmark result means, so it is pinned rather than configurable ---- */

describe("benchmark snapshot identity", () => {
  it("is fixed", () => {
    expect(SNAPSHOT).toBe("AUGUST-2026-CORPUS");
    expect(SNAPSHOT_CLOCK.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("hashes the same way node:crypto does, so CLI and browser agree", async () => {
    for (const s of ["", "abc", "₱25.5M – ₱27.3M\n"]) {
      expect(await sha256(s)).toBe(nodeSha(s));
    }
  });
});

/* ---- the export must not disturb production bucket generation ---- */

describe("benchmark export leaves production packaging alone", () => {
  const page = (heading) => makeAspx(textControl(`<p>${heading}</p>`));
  const files = [
    { name: "b.aspx", path: "TAG/b.aspx", raw: page("Beta") },
    { name: "a.aspx", path: "TAG/a.aspx", raw: page("Alpha") },
  ];
  const clock = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

  it("does not mutate the caller's file list", async () => {
    const order = files.map((f) => f.name);
    await buildBenchmarkArtifacts(files);
    expect(files.map((f) => f.name)).toEqual(order);
  });

  it("produces identical bucket outputs before and after an export", async () => {
    const before = {
      master: buildMaster("TAG", files, clock),
      optimized: generateOptimized("TAG", files).md,
    };
    await buildBenchmarkArtifacts(files);
    expect(buildMaster("TAG", files, clock)).toBe(before.master);
    expect(generateOptimized("TAG", files).md).toBe(before.optimized);
  });

  it("packages under the snapshot name, not the bucket name, on a fixed clock", async () => {
    const { armB, armC } = await buildBenchmarkArtifacts(files);
    expect(armB.md).toContain(`# ${SNAPSHOT} — ASPx Codebase Master File`);
    expect(armB.md).toContain("Generated on: 08/31/2026");
    expect(armC.md.startsWith(`# ${SNAPSHOT}\n`)).toBe(true);
    // ...and the bucket file, built the ordinary way, still carries its
    // own name and its own clock.
    expect(buildMaster("TAG", files, clock)).toContain("# TAG — ASPx Codebase Master File");
  });

  it("is deterministic: two builds of the same files agree byte-for-byte", async () => {
    const one = await buildBenchmarkArtifacts(files);
    const two = await buildBenchmarkArtifacts([...files].reverse());
    expect(two.armB.sha256).toBe(one.armB.sha256);
    expect(two.armC.sha256).toBe(one.armC.sha256);
    expect(two.filesSha256).toBe(one.filesSha256);
  });

  it("reports the checksums that describe the bytes it returns", async () => {
    const { armB, armC } = await buildBenchmarkArtifacts(files);
    expect(armB.sha256).toBe(nodeSha(armB.md));
    expect(armC.sha256).toBe(nodeSha(armC.md));
    expect(armB.bytes).toBe(Buffer.byteLength(armB.md, "utf8"));
  });
});

/* ---- Arm C stays gated: lost source information must block the artifact ---- */

describe("the gate still governs Arm C", () => {
  it("withholds Arm C, but not Arm B, when a page fails validation", async () => {
    // controlType 1 is a layout-only slice, so the extractor reads no
    // text from it — but the source model harvests from the raw markup
    // and does see the words. That is exactly the shape of an
    // information loss the gate exists to catch.
    const cd = escapeHtml(JSON.stringify({ controlType: 1, position: { zoneIndex: 1, sectionIndex: 1, controlIndex: 1 } }));
    const raw = makeAspx(
      `<div data-sp-canvascontrol="" data-sp-controldata="${cd}"><div data-sp-rte=""><p>Ceiling Height 6.85 m</p></div></div>`
    );
    const { armB, armC } = await buildBenchmarkArtifacts([{ name: "x.aspx", path: "x.aspx", raw }]);

    expect(armC.validation.status).toBe("FAIL");
    expect(armC.validation.representedUnits).toBeLessThan(armC.validation.sourceUnits);
    expect(armC.md).toBe("");
    expect(armC.sha256).toBeNull();
    expect(armC.bytes).toBe(0);

    // The fidelity layer is never gated — it is what you audit with when
    // the optimized one has gone wrong.
    expect(armB.md).toContain("Ceiling Height 6.85 m");
    expect(armB.sha256).not.toBeNull();
  });
});

/* ---- against the real corpus ---- */

describe.skipIf(!HAS_CORPUS)("benchmark export over the August corpus", () => {
  it("covers all 133 pages in both arms", async () => {
    const { armB, armC, manifest } = await buildBenchmarkArtifacts(loadCorpus());
    expect(manifest.corpusPages).toBe(CANONICAL.pages);
    expect(armB.pages).toBe(CANONICAL.pages);
    expect(armC.pages).toBe(CANONICAL.pages);
    // every page name appears in each artifact
    for (const name of corpusFiles()) {
      expect(armB.md, `Arm B missing ${name}`).toContain(`## ${name}`);
      expect(armC.md, `Arm C missing ${name}`).toContain(`- Source file: ${name}`);
    }
  }, 600000);

  it("keeps Arm C coverage at 4791/4791 with nothing untraceable", async () => {
    const { armC } = await buildBenchmarkArtifacts(loadCorpus());
    expect(armC.validation.status).toBe("PASS");
    expect(armC.validation.sourceUnits).toBe(CANONICAL.sourceUnits);
    expect(armC.validation.representedUnits).toBe(CANONICAL.sourceUnits);
    expect(armC.validation.untraceableUnits).toBe(0);
  }, 600000);

  it("reproduces the verified artifacts exactly", async () => {
    const built = await buildBenchmarkArtifacts(loadCorpus());
    expect(compareToCanonical(built)).toEqual({ files: true, armB: true, armC: true, pages: true });
  }, 600000);

  // The whole point of the shared recipe: the button and the command
  // cannot drift, because they are the same function.
  it("agrees with `npm run benchmark:arms` byte-for-byte", async () => {
    const out = tmp("cli");
    execFileSync("node", [path.join(root, "scripts/build-arms.mjs"), out], { cwd: root, encoding: "utf8" });
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    const built = await buildBenchmarkArtifacts(loadCorpus());
    expect(built.armB.sha256).toBe(m.arms.B.sha256);
    expect(built.armC.sha256).toBe(m.arms.C.sha256);
    expect(built.filesSha256).toBe(m.filesSha256);
    expect(fs.readFileSync(path.join(out, m.arms.B.file), "utf8")).toBe(built.armB.md);
    expect(fs.readFileSync(path.join(out, m.arms.C.file), "utf8")).toBe(built.armC.md);
  }, 900000);
});
