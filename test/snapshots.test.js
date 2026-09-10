import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBenchmarkArtifacts, SNAPSHOT_HISTORY, SNAPSHOT, CANONICAL } from "../src/lib/benchmarkExport.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusOf = (rel) => path.join(root, rel);
const has = (rel) => fs.existsSync(corpusOf(rel)) && fs.readdirSync(corpusOf(rel)).some((f) => f.endsWith(".aspx"));
const load = (rel) =>
  fs.readdirSync(corpusOf(rel)).filter((f) => f.endsWith(".aspx")).sort()
    .map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(corpusOf(rel), name), "utf8") }));

/* ------------------------------------------------------------------ *
 * A benchmark result means nothing without the snapshot it was run on.
 * Superseded snapshots are archived rather than discarded, and this
 * asserts the archive actually works: every historical snapshot must
 * rebuild to the digests recorded for it.
 *
 * Corpora are gitignored, so these skip on a fresh checkout. That is
 * the same bargain the corpus suites already make — see
 * benchmark/corpora/README.md.
 * ------------------------------------------------------------------ */

describe("snapshot history", () => {
  it("records a superseded snapshot rather than overwriting it", () => {
    expect(SNAPSHOT_HISTORY.length).toBeGreaterThan(0);
    for (const h of SNAPSHOT_HISTORY) {
      expect(h.snapshot).not.toBe(SNAPSHOT);
      for (const f of ["clock", "corpus", "pages", "filesSha256", "armBSha256", "armCSha256", "reason"]) {
        expect(h[f], `${h.snapshot} is missing ${f}`).toBeTruthy();
      }
    }
  });

  it("keeps the active snapshot out of the history", () => {
    expect(SNAPSHOT_HISTORY.map((h) => h.snapshot)).not.toContain(SNAPSHOT);
  });

  for (const h of SNAPSHOT_HISTORY) {
    describe.skipIf(!has(h.corpus))(`${h.snapshot} is reconstructable`, () => {
      it("rebuilds from its archived corpus to the recorded digests", async () => {
        const files = load(h.corpus);
        expect(files).toHaveLength(h.pages);
        const built = await buildBenchmarkArtifacts(files, { snapshot: h.snapshot, clock: new Date(h.clock) });
        expect(built.filesSha256, "corpus file set").toBe(h.filesSha256);
        expect(built.armB.sha256, "Arm B").toBe(h.armBSha256);
        expect(built.armC.sha256, "Arm C").toBe(h.armCSha256);
        expect(built.armC.validation.sourceUnits).toBe(h.sourceUnits);
        expect(built.armC.validation.status).toBe("PASS");
      }, 900000);

      // The whole point of archiving: rebuilding an old snapshot must
      // not silently produce the current one.
      it("is distinguishable from the active snapshot", () => {
        expect(h.filesSha256).not.toBe(CANONICAL.filesSha256);
        expect(h.armCSha256).not.toBe(CANONICAL.armCSha256);
      });
    });
  }
});
