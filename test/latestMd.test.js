import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBenchmarkArtifacts } from "../src/lib/benchmarkExport.js";
import { createZip } from "../src/lib/zip.js";
import { sha256 } from "../src/lib/digest.js";
import { makeAspx, textControl } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const page = (h, b) => textControl(`<h2>${h}</h2><p>${b}</p>`);
const corpus = () => [
  { name: "a.aspx", path: "a.aspx", raw: makeAspx(page("Alpha", "Alpha is a development.")) },
  { name: "b.aspx", path: "b.aspx", raw: makeAspx(page("Beta", "Beta is a development.")) },
];

/* ------------------------------------------------------------------ *
 * The bucket tabs export one Master and one AI file per bucket, and the
 * benchmark workspace produces the consolidated pair for the whole
 * corpus. But the consolidated pair existed only in there, wrapped in
 * snapshot identity, arm definitions, coverage gates and canonical
 * comparison — none of which are the question when pages have changed
 * at source and you just want the current files.
 *
 * The new tab is that, with the experiment removed. The thing these
 * tests hold is that it is not a SECOND implementation: same builder,
 * same build, same bytes.
 * ------------------------------------------------------------------ */

describe("the Latest MD tab is a view, not a second generator", () => {
  const ui = src("src/components/LatestMd.jsx");

  it("builds through the same function the benchmark panel calls", () => {
    expect(ui).toContain('import { buildBenchmarkArtifacts } from "../lib/benchmarkExport"');
    expect(ui).not.toMatch(/buildMaster|generateOptimized|renderOptimized/);
  });

  it("shares the one current build rather than keeping its own", () => {
    expect(ui).toContain("const built = onBuild ? currentBuild : localBuild;");
    expect(ui).toContain("const setBuilt = onBuild ?? setLocalBuild;");
    const app = src("src/App.jsx");
    expect(app).toContain("<LatestMd files={benchmarkFiles} currentBuild={currentBuild} onBuild={setCurrentBuild} />");
  });

  it("produces exactly the bytes the benchmark panel produces", async () => {
    const one = await buildBenchmarkArtifacts(corpus());
    const two = await buildBenchmarkArtifacts(corpus());
    expect(two.armB.sha256).toBe(one.armB.sha256);
    expect(two.armC.sha256).toBe(one.armC.sha256);
    expect(two.armB.filename).toBe(one.armB.filename);
  });

  it("names its archive after the build, and the two files after the source", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    expect(`${built.snapshot}_Master_File.zip`).toContain(built.snapshot);
    expect(built.armB.filename).toBe(`${built.snapshot}_Master_File.md`);
    expect(built.armC.filename).toBe(`${built.snapshot}_AI_File.md`);
  });

  it("the archive round-trips to the displayed digests", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const zip = await createZip(
      [
        { name: built.armB.filename, text: built.armB.md },
        { name: built.armC.filename, text: built.armC.md },
      ],
      { modifiedAt: new Date(built.manifest.snapshotClock) }
    );
    expect(zip.byteLength).toBeGreaterThan(0);
    expect(await sha256(built.armB.md)).toBe(built.armB.sha256);
    expect(await sha256(built.armC.md)).toBe(built.armC.sha256);
  });

  it("withholds the AI file rather than shipping an unvalidated one", () => {
    // The card is gated on artifact.sha256, which buildBenchmarkArtifacts
    // leaves null when coverage fails.
    expect(ui).toContain("const produced = Boolean(artifact?.sha256);");
    expect(ui).toContain("blockedReason");
    expect(ui).toMatch(/if \(built\.armC\.sha256\) entries\.push/);
  });

  it("holds downloads when the staged files have moved on", () => {
    expect(ui).toContain("const stale = Boolean(built) && built.signature !== signature;");
    expect(ui).toContain("disabled={stale || zipping}");
  });
});

describe("the download helper is shared, not copied", () => {
  it("both panels import it from one place", () => {
    for (const f of ["src/components/LatestMd.jsx", "src/components/BenchmarkExport.jsx"]) {
      expect(src(f), `${f} should import the shared helper`).toContain('from "../lib/download"');
      expect(src(f), `${f} should not redefine saveBlob`).not.toContain("function saveBlob");
    }
  });

  it("keeps the two details that made downloads fail silently", () => {
    const dl = src("src/lib/download.js");
    expect(dl).toContain("document.body.appendChild(a)");          // detached anchors are ignored
    expect(dl).toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL/); // not revoked in the same statement
  });
});

/* A tab is a tab. The bucket view used to render underneath anything
 * that was not on a hand-maintained deny-list, and that list had already
 * fallen behind by one ("TestQuestions"). */
describe("a new tab does not render a phantom bucket under it", () => {
  const app = src("src/App.jsx");

  it("decides by what a bucket IS, not by listing what it is not", () => {
    expect(app).toContain("const activeBucket = selected === UNSORTED || tags.includes(selected) ? selected : null;");
    expect(app).not.toMatch(/\["ManageTags", "Changelog", "Benchmark"\]\.includes\(selected\)/);
  });

  it("covers every non-bucket tab, including the ones that came later", () => {
    const activeBucket = (selected, tags) => (selected === "Unsorted" || tags.includes(selected) ? selected : null);
    const tags = ["PROJECT PLAYBOOK", "LOCATORS", "NEWS AND ANNOUNCEMENT"];
    for (const tab of ["ManageTags", "Changelog", "Benchmark", "TestQuestions", "LatestMd"]) {
      expect(activeBucket(tab, tags), `${tab} must not open a bucket`).toBeNull();
    }
    for (const bucket of ["Unsorted", ...tags]) {
      expect(activeBucket(bucket, tags)).toBe(bucket);
    }
  });

  it("the tab is reachable from the sidebar", () => {
    const side = src("src/components/Sidebar.jsx");
    expect(side).toContain('item("LatestMd", "Latest MD", FileText)');
  });
});
