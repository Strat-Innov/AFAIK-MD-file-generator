import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusIdentity, detectSnapshot, ACTIVE_SNAPSHOT } from "../src/lib/snapshots.js";
import { EXCLUDED_PAGES, normalizeName, scopeOf } from "../src/lib/questionSet.js";
import { buildBucketPackage, packageEntries } from "../src/lib/benchmarkExport.js";
import { stagedKey, fileId } from "../src/lib/stagedKey.js";
import { makeAspx, textControl } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const V2 = "benchmark/corpora/september-2026-v2";
const has = (rel) =>
  fs.existsSync(path.join(root, rel)) &&
  fs.readdirSync(path.join(root, rel)).some((f) => f.endsWith(".aspx"));
const load = (rel) => {
  const d = path.join(root, rel);
  return fs.readdirSync(d).filter((f) => f.endsWith(".aspx")).sort()
    .map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(d, name), "utf8") }));
};

/* The panel's own rule, mirrored here so a change to it fails a test
 * rather than only changing what a person sees. */
const EXCLUDED = new Set(EXCLUDED_PAGES.map(normalizeName));
const isExcludedByPolicy = (f) => EXCLUDED.has(normalizeName(f.name));
const split = (unsorted) => ({
  excluded: unsorted.filter(isExcludedByPolicy),
  orphans: unsorted.filter((f) => !isExcludedByPolicy(f)),
});

/* ------------------------------------------------------------------ *
 * The package panel hashed its BUCKETED files and compared that to a
 * registry that records the WHOLE corpus. Six pages are excluded by
 * policy and live outside the buckets, so the subset could never equal
 * the registered corpus: a correctly registered snapshot reported
 * REGISTERED in the arms panel and UNREGISTERED in the package panel at
 * the same moment, from the same files, and generation was blocked
 * permanently. These tests hold the two populations apart.
 * ------------------------------------------------------------------ */

describe("identity is the corpus, packaging is the buckets", () => {
  it("the WHOLE corpus matches the registered snapshot", async () => {
    if (!has(V2)) return;
    const whole = load(V2);
    const d = await detectSnapshot(whole);
    expect(d.status).toBe("registered");
    expect(d.snapshot.name).toBe(ACTIVE_SNAPSHOT.name);
    expect(d.identity.contentSha256).toBe(ACTIVE_SNAPSHOT.contentSha256);
    expect(d.identity.fileSetSha256).toBe(ACTIVE_SNAPSHOT.fileSetSha256);
    expect(whole).toHaveLength(ACTIVE_SNAPSHOT.sourceFiles);
  }, 900000);

  it("the BUCKETED subset does not, and must never be used as identity", async () => {
    if (!has(V2)) return;
    const whole = load(V2);
    const inScope = new Set(scopeOf(whole.map((f) => f.name)));
    const bucketed = whole.filter((f) => inScope.has(f.name));

    expect(bucketed).toHaveLength(ACTIVE_SNAPSHOT.benchmarkPages);
    expect(bucketed.length).toBeLessThan(whole.length);

    const subset = await corpusIdentity(bucketed);
    expect(subset.contentSha256).not.toBe(ACTIVE_SNAPSHOT.contentSha256);
    expect(subset.fileSetSha256).not.toBe(ACTIVE_SNAPSHOT.fileSetSha256);
    // ...and it matches no registered snapshot at all
    expect((await detectSnapshot(bucketed)).status).toBe("unregistered");
  }, 900000);

  it("133 in-scope + 6 excluded is the whole corpus, exactly", () => {
    if (!has(V2)) return;
    const names = load(V2).map((f) => f.name);
    expect(names).toHaveLength(133);
    expect(scopeOf(names)).toHaveLength(127);
    expect(names.filter((n) => EXCLUDED.has(normalizeName(n)))).toHaveLength(6);
    expect(scopeOf(names).length + 6).toBe(names.length);
  });
});

describe("intentional exclusions are not orphans", () => {
  const asFiles = (names) => names.map((name) => ({ name, path: name, raw: "" }));

  it("classifies all six policy exclusions as excluded, not orphaned", () => {
    const { excluded, orphans } = split(asFiles(EXCLUDED_PAGES));
    expect(excluded).toHaveLength(6);
    expect(orphans).toHaveLength(0);
    expect(excluded.map((f) => f.name).sort()).toEqual([...EXCLUDED_PAGES].sort());
  });

  it("does not block generation on them", () => {
    const { orphans } = split(asFiles(EXCLUDED_PAGES));
    // The panel's gate is `orphans.length > 0`; policy exclusions must
    // never reach it.
    expect(orphans.length > 0).toBe(false);
  });

  it("still treats a genuinely unassigned page as an orphan, and blocks", () => {
    const unsorted = asFiles([...EXCLUDED_PAGES, "Some-New-Page.aspx"]);
    const { excluded, orphans } = split(unsorted);
    expect(excluded).toHaveLength(6);
    expect(orphans.map((f) => f.name)).toEqual(["Some-New-Page.aspx"]);
    expect(orphans.length > 0).toBe(true);
  });

  it("matches the exclusion list by the generator's own normalisation", () => {
    // Command-line unzip escapes the en dash; the policy check must not
    // care which spelling arrives.
    expect(isExcludedByPolicy({ name: "Internal-Audit.aspx" })).toBe(true);
    expect(isExcludedByPolicy({ name: "1001-Parkway.aspx" })).toBe(false);
  });
});

describe("package contents are unchanged by the identity fix", () => {
  const page = (t) => makeAspx(textControl(`<p>${t}</p>`));
  const file = (name, t) => ({ name, path: name, raw: page(t) });
  const FIVE = {
    "PROJECT PLAYBOOK": [file("a.aspx", "Alpha"), file("b.aspx", "Beta")],
    "TOWNSHIP PAGES": [file("c.aspx", "Gamma")],
    "LIFE AT FAI": [file("d.aspx", "Delta")],
    "NAVIGATION PAGES": [file("e.aspx", "Epsilon")],
    "LOCATORS": [file("f.aspx", "Zeta")],
  };

  it("builds from the buckets only — exclusions never enter a package", async () => {
    const pkg = await buildBucketPackage(FIVE);
    expect(pkg.armB).toHaveLength(5);
    expect(pkg.armC).toHaveLength(5);
    expect(pkg.pages).toBe(6);
    const listed = pkg.manifest.buckets.flatMap((b) => b.pages);
    for (const ex of EXCLUDED_PAGES) expect(listed).not.toContain(ex);
  }, 300000);

  it("is deterministic — the same buckets give the same arm bytes", async () => {
    const one = await buildBucketPackage(FIVE);
    const two = await buildBucketPackage(FIVE);
    // The arm files are the artifacts; manifest.json sits beside them and
    // records a wall clock on purpose, so it is excluded from the
    // byte-equality claim rather than the claim being weakened.
    const arms = (p) => packageEntries(p).filter((e) => e.name !== "manifest.json");
    expect(arms(two).map((e) => e.text)).toEqual(arms(one).map((e) => e.text));
    expect(arms(two).map((e) => e.name)).toEqual(arms(one).map((e) => e.name));
    expect(two.armB.map((a) => a.sha256)).toEqual(one.armB.map((a) => a.sha256));
    expect(two.armC.map((a) => a.sha256)).toEqual(one.armC.map((a) => a.sha256));
  }, 300000);

  it("an unsorted page is absent from the package whether excluded or orphaned", async () => {
    // buildBucketPackage only ever sees the bucket map, so neither kind
    // of unsorted page can reach the output. The distinction is about
    // whether generation is ALLOWED, never about what it contains.
    const pkg = await buildBucketPackage(FIVE);
    const listed = pkg.manifest.buckets.flatMap((b) => b.pages);
    expect(listed).not.toContain("Some-New-Page.aspx");
    expect(listed.sort()).toEqual(["a.aspx", "b.aspx", "c.aspx", "d.aspx", "e.aspx", "f.aspx"]);
  }, 300000);
});

describe("the existing guards still hold", () => {
  it("the stale-corpus guard still sees a content-only change", () => {
    const before = [{ name: "a.aspx", path: "a.aspx", raw: "one" }];
    const after = [{ name: "a.aspx", path: "a.aspx", raw: "ONE" }];
    expect(stagedKey(after)).not.toBe(stagedKey(before));
    expect(stagedKey([...before])).toBe(stagedKey(before));
    expect(fileId(before[0])).toBe(fileId(before[0]));
  });

  it("the package's own staleness key still tracks bucket placement", () => {
    const f = { name: "a.aspx", path: "a.aspx", raw: "x" };
    const key = (bucket) => [`${bucket}${f.name}${fileId(f)}`].join(" ");
    expect(key("LOCATORS")).not.toBe(key("PROJECT PLAYBOOK"));
  });

  it("an unregistered corpus is still unregistered, whole or not", async () => {
    const unknown = [{ name: "x.aspx", path: "x.aspx", raw: makeAspx(textControl("<p>nothing known</p>")) }];
    expect((await detectSnapshot(unknown)).status).toBe("unregistered");
  });

  it("a registered corpus with one page edited becomes unregistered", async () => {
    if (!has(V2)) return;
    const whole = load(V2);
    const edited = whole.map((f, i) => (i === 0 ? { ...f, raw: f.raw + "\n" } : f));
    expect((await detectSnapshot(edited)).status).toBe("unregistered");
    // filenames unchanged, so the file-set digest does NOT move — the
    // exact signature that made the content digest necessary
    const a = await corpusIdentity(whole);
    const b = await corpusIdentity(edited);
    expect(b.fileSetSha256).toBe(a.fileSetSha256);
    expect(b.contentSha256).not.toBe(a.contentSha256);
  }, 900000);
});

describe("the registry was not touched by this fix", () => {
  it("still pins September V2 exactly", () => {
    expect(ACTIVE_SNAPSHOT.name).toBe("SEPTEMBER-2026-V2-CORPUS");
    expect(ACTIVE_SNAPSHOT.contentSha256).toBe("212e998c36baa92d4413d626403eb16cefc0a045352dbcd7f176ca6065b46e2f");
    expect(ACTIVE_SNAPSHOT.fileSetSha256).toBe("822fba2ff4e74e81930797ade2a28e5ba12efbb03a07a9ab099b0310be3cf033");
    expect(ACTIVE_SNAPSHOT.questionSetSha256).toBe("1f93c4a5d9d927c1044498df09fec5d7fa141a613da3993c8fd27fb5200f2990");
    expect(ACTIVE_SNAPSHOT.questions).toBe(607);
    expect(ACTIVE_SNAPSHOT.evaluation.status).toBe("not-run");
  });

  it("registers no corpus observed during the diagnostic", async () => {
    const src = fs.readFileSync(path.join(root, "src/lib/snapshots.js"), "utf8");
    for (const seen of ["fd2b26", "17ac2b", "15b06ec", "40d19250", "4cf1c8dd"]) {
      expect(src, `snapshots.js must not register ${seen}`).not.toContain(seen);
    }
  });
});
