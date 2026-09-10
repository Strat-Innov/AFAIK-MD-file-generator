import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNAPSHOTS, ACTIVE_SNAPSHOT, SUPERSEDED_SNAPSHOTS,
  corpusIdentity, detectSnapshot, snapshotIdentityOf, UNREGISTERED_ID,
} from "../src/lib/snapshots.js";
import { buildBenchmarkArtifacts, CANONICAL, SNAPSHOT, fileSetSignature } from "../src/lib/benchmarkExport.js";
import { stagedKey, fileId } from "../src/lib/stagedKey.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const has = (rel) => fs.existsSync(path.join(root, rel)) &&
  fs.readdirSync(path.join(root, rel)).some((f) => f.endsWith(".aspx"));
const load = (rel) => {
  const d = path.join(root, rel);
  return fs.readdirSync(d).filter((f) => f.endsWith(".aspx")).sort()
    .map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(d, name), "utf8") }));
};
const AUG = "benchmark/corpora/august-2026";
const SEP = "benchmark/corpora/september-2026";

describe("the registry", () => {
  it("holds exactly one frozen snapshot", () => {
    expect(SNAPSHOTS.filter((s) => s.status === "frozen")).toHaveLength(1);
    expect(ACTIVE_SNAPSHOT.name).toBe("SEPTEMBER-2026-CORPUS");
  });

  it("gives every snapshot a distinct content identity", () => {
    const ids = SNAPSHOTS.map((s) => s.contentSha256);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The whole reason detection keys on content: a corpus whose pages
  // changed but whose filenames did not hashes identically under the
  // names-only digest.
  it("keeps the content digest separate from the file-set digest", () => {
    for (const s of SNAPSHOTS) {
      expect(s.contentSha256).not.toBe(s.fileSetSha256);
      expect(s.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.fileSetSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is the only source of the active snapshot's constants", () => {
    expect(SNAPSHOT).toBe(ACTIVE_SNAPSHOT.name);
    expect(CANONICAL.pages).toBe(ACTIVE_SNAPSHOT.sourceFiles);
    expect(CANONICAL.filesSha256).toBe(ACTIVE_SNAPSHOT.fileSetSha256);
    expect(CANONICAL.armBSha256).toBe(ACTIVE_SNAPSHOT.armBSha256);
    expect(CANONICAL.armCSha256).toBe(ACTIVE_SNAPSHOT.armCSha256);
    expect(CANONICAL.sourceUnits).toBe(ACTIVE_SNAPSHOT.sourceUnits);
  });

  it("records superseded snapshots without treating them as active", () => {
    expect(SUPERSEDED_SNAPSHOTS.map((s) => s.name)).toContain("AUGUST-2026-CORPUS");
    for (const s of SUPERSEDED_SNAPSHOTS) expect(s.name).not.toBe(ACTIVE_SNAPSHOT.name);
  });
});

describe("identity is content, not the calendar", () => {
  const page = (name, body) => ({ name, path: name, raw: `<html>${body}</html>` });
  const base = [page("a.aspx", "one"), page("b.aspx", "two")];

  it("does not depend on the order files arrived in", async () => {
    const a = await corpusIdentity(base);
    const b = await corpusIdentity([...base].reverse());
    expect(b.contentSha256).toBe(a.contentSha256);
    expect(b.fileSetSha256).toBe(a.fileSetSha256);
  });

  it("changes when a file is added", async () => {
    const a = await corpusIdentity(base);
    const b = await corpusIdentity([...base, page("c.aspx", "three")]);
    expect(b.contentSha256).not.toBe(a.contentSha256);
  });

  it("changes when a file is removed", async () => {
    const a = await corpusIdentity(base);
    const b = await corpusIdentity(base.slice(1));
    expect(b.contentSha256).not.toBe(a.contentSha256);
  });

  // The defect this design exists to close.
  it("changes when content changes but the filenames do not", async () => {
    const a = await corpusIdentity(base);
    const b = await corpusIdentity([page("a.aspx", "one EDITED"), page("b.aspx", "two")]);
    expect(b.fileSetSha256, "names-only digest cannot see the edit").toBe(a.fileSetSha256);
    expect(b.contentSha256, "content digest must see it").not.toBe(a.contentSha256);
  });

  it("reports a duplicate filename instead of collapsing it", async () => {
    const id = await corpusIdentity([...base, base[0]]);
    expect(id.duplicates).toEqual(["a.aspx"]);
    expect(id.sourceFiles).toBe(3);
    const clean = await corpusIdentity(base);
    expect(id.contentSha256).not.toBe(clean.contentSha256);
  });

  it("is deterministic across repeated calls", async () => {
    expect((await corpusIdentity(base)).contentSha256).toBe((await corpusIdentity(base)).contentSha256);
  });
});

describe("unregistered corpora", () => {
  const unknown = [{ name: "mystery.aspx", path: "mystery.aspx", raw: "<html>x</html>" }];

  it("are reported as unregistered, not guessed", async () => {
    const d = await detectSnapshot(unknown);
    expect(d.status).toBe("unregistered");
    expect(d.snapshot).toBeNull();
    expect(d.identity.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never borrow a registered snapshot's identity", async () => {
    const d = await detectSnapshot(unknown);
    const id = snapshotIdentityOf(d);
    expect(id.registered).toBe(false);
    expect(id.name).toBe(UNREGISTERED_ID);
    for (const s of SNAPSHOTS) expect(id.name).not.toBe(s.name);
  });

  it("cannot be silently stamped as a frozen snapshot", async () => {
    const built = await buildBenchmarkArtifacts(unknown);
    expect(built.snapshot).toBe(UNREGISTERED_ID);
    expect(built.manifest.snapshotRegistered).toBe(false);
    expect(built.armB.md).not.toContain("AUGUST-2026-CORPUS");
    expect(built.armB.md).not.toContain("SEPTEMBER-2026-CORPUS");
  });
});

describe.skipIf(!has(AUG) || !has(SEP))("detection against the real corpora", () => {
  it("identifies the August corpus as August", async () => {
    const d = await detectSnapshot(load(AUG));
    expect(d.status).toBe("registered");
    expect(d.snapshot.name).toBe("AUGUST-2026-CORPUS");
    expect(d.identity.sourceFiles).toBe(133);
    expect(d.identity.fileSetSha256).toBe(d.snapshot.fileSetSha256);
  }, 120000);

  it("identifies the September corpus as September", async () => {
    const d = await detectSnapshot(load(SEP));
    expect(d.status).toBe("registered");
    expect(d.snapshot.name).toBe("SEPTEMBER-2026-CORPUS");
    expect(d.identity.sourceFiles).toBe(134);
  }, 120000);

  it("identifies the same corpus regardless of load order", async () => {
    const files = load(AUG);
    const a = await detectSnapshot(files);
    const b = await detectSnapshot([...files].reverse());
    expect(b.snapshot.name).toBe(a.snapshot.name);
  }, 120000);

  it("does not confuse the two, which differ by one file and 62 edits", async () => {
    const a = await detectSnapshot(load(AUG));
    const s = await detectSnapshot(load(SEP));
    expect(a.identity.contentSha256).not.toBe(s.identity.contentSha256);
    expect(a.snapshot.name).not.toBe(s.snapshot.name);
  }, 120000);

  // Artifact metadata must agree with what detection reports, or the
  // UI and the file on disk would tell different stories.
  it("stamps artifacts with the detected snapshot, for each corpus", async () => {
    for (const [rel, name] of [[AUG, "AUGUST-2026-CORPUS"], [SEP, "SEPTEMBER-2026-CORPUS"]]) {
      const built = await buildBenchmarkArtifacts(load(rel));
      expect(built.snapshot).toBe(name);
      expect(built.manifest.snapshot).toBe(name);
      expect(built.manifest.snapshotRegistered).toBe(true);
      expect(built.armB.filename).toBe(`${name}_Master_File.md`);
      expect(built.armB.md).toContain(`# ${name} — ASPx Codebase Master File`);
    }
  }, 900000);

  // Detection must not have moved a single byte of either snapshot.
  it("reproduces both snapshots' recorded digests", async () => {
    for (const s of SNAPSHOTS) {
      const rel = s.archive;
      if (!has(rel)) continue;
      const built = await buildBenchmarkArtifacts(load(rel));
      expect(built.armB.sha256, `${s.name} Arm B`).toBe(s.armBSha256);
      expect(built.armC.sha256, `${s.name} Arm C`).toBe(s.armCSha256);
      expect(built.filesSha256, `${s.name} file set`).toBe(s.fileSetSha256);
      expect(built.armC.validation.sourceUnits).toBe(s.sourceUnits);
    }
  }, 900000);
});

/* ---- the screen has to react to the same thing detection keys on ----
 *
 * Detection is only as good as the trigger that re-runs it. The UI holds
 * a detection result in state and recomputes it when its key changes, so
 * if that key is names-only the whole content-hash apparatus is bypassed
 * for the one case it exists to catch: a corpus swap that revises page
 * content and keeps every filename. This was a real defect — the
 * September corpus loaded over the August one left AUGUST-2026-CORPUS on
 * screen, with August's content hash, over September's bytes.
 */
describe("the staged key the UI reacts to", () => {
  const page = (name, body) => ({ name, path: name, raw: body });

  it("changes when content changes but every filename stays the same", () => {
    const before = [page("a.aspx", "one"), page("b.aspx", "two")];
    const after = [page("a.aspx", "ONE"), page("b.aspx", "two")];
    // The names-only signature is blind to this, by design.
    expect(fileSetSignature(after)).toBe(fileSetSignature(before));
    expect(stagedKey(after)).not.toBe(stagedKey(before));
  });

  it("is stable across renders while the same objects stay loaded", () => {
    const files = [page("a.aspx", "one"), page("b.aspx", "two")];
    expect(stagedKey(files)).toBe(stagedKey([...files]));
  });

  it("is order-independent, so re-sorting alone never re-detects", () => {
    const files = [page("a.aspx", "one"), page("b.aspx", "two")];
    expect(stagedKey([...files].reverse())).toBe(stagedKey(files));
  });

  it("changes when a page is added or removed", () => {
    const a = page("a.aspx", "one");
    const b = page("b.aspx", "two");
    expect(stagedKey([a, b])).not.toBe(stagedKey([a]));
    expect(stagedKey([a])).not.toBe(stagedKey([a, b]));
  });

  it("keeps one id per staged object", () => {
    const f = page("a.aspx", "one");
    expect(fileId(f)).toBe(fileId(f));
    expect(fileId(page("a.aspx", "one"))).not.toBe(fileId(f));
  });

  it("changes when a real corpus is swapped for another with the same names",
    () => {
      if (!has(AUG) || !has(SEP)) return;
      const sep = load(SEP);
      // Same filenames, re-read: what a fresh load of a revised snapshot
      // looks like to the component.
      const reread = sep.map((f) => ({ ...f }));
      expect(fileSetSignature(reread)).toBe(fileSetSignature(sep));
      expect(stagedKey(reread)).not.toBe(stagedKey(sep));
    });
});
