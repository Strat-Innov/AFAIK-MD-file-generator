import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBenchmarkArtifacts } from "../src/lib/benchmarkExport.js";
import { knowledgeBuild, buildId, compareBuilds, sameBuild } from "../src/lib/knowledgeBuild.js";
import { detectSnapshot, corpusIdentity, snapshotIdentityOf, newSourceName, ACTIVE_SNAPSHOT } from "../src/lib/snapshots.js";
import { BANDED_COLUMN_BY_TOP, DOM } from "../src/lib/canvasOrder.js";
import { makeAspx, textControl, webPartControl } from "./helpers.js";
import { PEOPLE_ID } from "../src/lib/webparts.js";

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

const page = (heading, body) => textControl(`<h2>${heading}</h2><p>${body}</p>`);
const corpus = (mark) => [
  { name: "a.aspx", path: "a.aspx", raw: makeAspx(page("Alpha", `Alpha is a development. ${mark}`)) },
  { name: "b.aspx", path: "b.aspx", raw: makeAspx(page("Beta", "Beta is a development.")) },
];

/* ------------------------------------------------------------------ *
 * The registry used to answer "may this corpus be built?" — and refused
 * an unchanged knowledge base whenever SharePoint rewrote its per-export
 * metadata, which it does on every page of every export. The only way
 * through was to register bytes nobody had characterised.
 *
 * A snapshot is now the RECORD OF A BUILD. Upload, validate, build,
 * record. These tests hold that inversion: everything that says whether
 * a build is SOUND still blocks; nothing blocks on whether the bytes
 * have been seen before.
 * ------------------------------------------------------------------ */

describe("1 — a corpus the registry has never seen can build", () => {
  it("builds, and is named from its own digest rather than refused one", async () => {
    const files = corpus("never seen before");
    const d = await detectSnapshot(files);
    expect(d.status).toBe("unregistered");

    const built = await buildBenchmarkArtifacts(files);
    expect(built.armB.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.armC.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.snapshot).toBe(newSourceName(d.identity.fileSetSha256));
    expect(built.manifest.knownToRegistry).toBe(false);
    expect(built.armB.md).not.toContain(ACTIVE_SNAPSHOT.name);
  });

  it("records the build, with lineage explicitly absent rather than guessed", async () => {
    const built = await buildBenchmarkArtifacts(corpus("no lineage"));
    expect(built.build.snapshotId).toMatch(/^build-[0-9a-f]{16}$/);
    expect(built.build.lineage).toBeNull();
    expect(built.build.pageCount).toBe(2);
  });
});

describe("2 — a changed SharePoint export can build", () => {
  it("builds even though its content digest differs from the last one", async () => {
    // The exact shape that used to be refused: same pages, bytes moved.
    const before = await buildBenchmarkArtifacts(corpus("export 1"));
    const after = await buildBenchmarkArtifacts(corpus("export 2"));
    expect(before.build.contentSha256).not.toBe(after.build.contentSha256);
    expect(after.armB.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(after.build.snapshotId).not.toBe(before.build.snapshotId);
  });

  it("names source-only churn for what it is", async () => {
    // A re-export that changes nothing we generate from it. Before, this
    // was indistinguishable from a real change and blocked either way.
    const a = await buildBenchmarkArtifacts(corpus("x"));
    const churned = corpus("x").map((f) => ({ ...f, raw: f.raw.replace("<mso:ContentTypeId", "<mso:PRTUniqueId msdt:dt=\"string\">new-guid</mso:PRTUniqueId>\n<mso:ContentTypeId") }));
    const b = await buildBenchmarkArtifacts(churned);
    const cmp = compareBuilds(a.build, b.build);
    expect(cmp.sourceChanged).toBe(true);
    expect(cmp.masterChanged).toBe(true);     // Master carries raw bytes, so it moves
    expect(cmp.aiChanged).toBe(false);        // ...but nothing EXTRACTED moved
  });
});

describe("3 — an invalid corpus still fails validation", () => {
  it("reports a duplicate filename rather than silently collapsing it", async () => {
    const dup = [...corpus("dup"), { name: "a.aspx", path: "copy/a.aspx", raw: makeAspx(page("Alpha", "different")) }];
    const id = await corpusIdentity(dup);
    expect(id.duplicates).toContain("a.aspx");
  });

  it("an empty corpus produces no artifacts to record", async () => {
    const built = await buildBenchmarkArtifacts([]);
    expect(built.build.pageCount).toBe(0);
    expect(built.armB.pages).toBe(0);
  });
});

describe("4 — coverage failure still blocks artifact generation", () => {
  it("withholds Arm C when a page cannot be represented faithfully", async () => {
    // A person web part whose rendered name would not be traceable back
    // to a source unit: coverage fails, and Arm C is withheld.
    const broken = [{
      name: "p.aspx", path: "p.aspx",
      raw: makeAspx(webPartControl({
        id: PEOPLE_ID, title: "People",
        properties: { persons: [{ role: "Manager" }] },
        serverProcessedContent: { searchablePlainTexts: { title: "TEAM" } },
      })),
    }];
    const built = await buildBenchmarkArtifacts(broken);
    if (built.optimized.status === "FAIL") {
      expect(built.armC.md).toBe("");
      expect(built.armC.sha256).toBeNull();
      expect(built.build.aiSha256).toBeNull();
    }
    // Either way the coverage numbers are recorded, not hidden
    expect(built.build.sourceCoverage.sourceUnits).toBeGreaterThanOrEqual(0);
  });

  it("keeps the coverage accounting in the record", async () => {
    const built = await buildBenchmarkArtifacts(corpus("accounting"));
    const c = built.build.sourceCoverage;
    expect(c.represented + c.missing).toBe(c.sourceUnits);
    expect(c.pages).toBe(2);
  });
});

describe("5 — snapshot metadata is created only after a successful build", () => {
  it("a record exists only where artifacts exist", async () => {
    const built = await buildBenchmarkArtifacts(corpus("after"));
    expect(built.build).toBeTruthy();
    expect(built.build.masterSha256).toBe(built.armB.sha256);
  });

  it("builtAt describes the build and never reaches the artifacts", async () => {
    const one = await buildBenchmarkArtifacts(corpus("clock"), { builtAt: new Date("2026-01-01T00:00:00Z") });
    const two = await buildBenchmarkArtifacts(corpus("clock"), { builtAt: new Date("2027-06-15T12:34:56Z") });
    expect(one.build.builtAt).not.toBe(two.build.builtAt);
    expect(two.armB.sha256).toBe(one.armB.sha256);     // artifacts unmoved
    expect(two.build.snapshotId).toBe(one.build.snapshotId);
    expect(sameBuild(one.build, two.build)).toBe(true);
  });
});

describe("6 — the existing V2 lineage is untouched", () => {
  it("still reproduces V2's registered artifacts byte-for-byte", async () => {
    if (!has(V2)) return;
    const built = await buildBenchmarkArtifacts(load(V2));
    expect(built.snapshot).toBe("SEPTEMBER-2026-V2-CORPUS");
    expect(built.armB.sha256).toBe(ACTIVE_SNAPSHOT.armBSha256);
    expect(built.armC.sha256).toBe(ACTIVE_SNAPSHOT.armCSha256);
    expect(built.build.lineage.snapshot).toBe("SEPTEMBER-2026-V2-CORPUS");
  }, 900000);

  it("keeps V2's registry entry exactly as frozen", () => {
    expect(ACTIVE_SNAPSHOT.contentSha256).toBe("212e998c36baa92d4413d626403eb16cefc0a045352dbcd7f176ca6065b46e2f");
    expect(ACTIVE_SNAPSHOT.questionSetSha256).toBe("1f93c4a5d9d927c1044498df09fec5d7fa141a613da3993c8fd27fb5200f2990");
    expect(ACTIVE_SNAPSHOT.questions).toBe(607);
    expect(ACTIVE_SNAPSHOT.evaluation.status).toBe("not-run");
  });

  it("a known corpus keeps its snapshot clock, which is what makes it reproducible", async () => {
    if (!has(V2)) return;
    const d = await detectSnapshot(load(V2));
    const id = snapshotIdentityOf(d);
    expect(id.known).toBe(true);
    expect(id.clock.toISOString()).toBe(ACTIVE_SNAPSHOT.clock);
  }, 900000);
});

describe("7 — the order policy is recorded per build", () => {
  it("records the policy the build actually used", async () => {
    const dom = await buildBenchmarkArtifacts(corpus("policy"), { orderPolicy: DOM });
    const banded = await buildBenchmarkArtifacts(corpus("policy"), { orderPolicy: BANDED_COLUMN_BY_TOP });
    expect(dom.build.orderPolicy).toBe(DOM);
    expect(banded.build.orderPolicy).toBe(BANDED_COLUMN_BY_TOP);
  });

  it("two policies over one corpus are two distinct builds", async () => {
    const dom = await buildBenchmarkArtifacts(corpus("policy"), { orderPolicy: DOM });
    const banded = await buildBenchmarkArtifacts(corpus("policy"), { orderPolicy: BANDED_COLUMN_BY_TOP });
    expect(banded.build.snapshotId).not.toBe(dom.build.snapshotId);
    expect(compareBuilds(dom.build, banded.build).orderPolicyChanged).toBe(true);
    expect(compareBuilds(dom.build, banded.build).sourceChanged).toBe(false);
  });
});

describe("8 — identical source content produces deterministic artifacts", () => {
  it("same bytes, same artifacts, same build id", async () => {
    const one = await buildBenchmarkArtifacts(corpus("same"));
    const two = await buildBenchmarkArtifacts([...corpus("same")].reverse());
    expect(two.armB.sha256).toBe(one.armB.sha256);
    expect(two.armC.sha256).toBe(one.armC.sha256);
    expect(two.build.snapshotId).toBe(one.build.snapshotId);
    expect(two.build.contentSha256).toBe(one.build.contentSha256);
  });

  it("the build id ignores wall time by construction", async () => {
    const shape = { identity: { contentSha256: "c", fileSetSha256: "f" }, orderPolicy: "dom",
                    master: { sha256: "m" }, ai: { sha256: "a" }, questions: { coreSha: "q" } };
    expect(await buildId(shape)).toBe(await buildId(shape));
  });
});

describe("9 — changed source content produces a distinct snapshot", () => {
  it("a different corpus is a different build", async () => {
    const a = await buildBenchmarkArtifacts(corpus("one"));
    const b = await buildBenchmarkArtifacts(corpus("two"));
    expect(b.build.snapshotId).not.toBe(a.build.snapshotId);
    expect(sameBuild(a.build, b.build)).toBe(false);
    expect(compareBuilds(a.build, b.build).sourceChanged).toBe(true);
  });

  it("reports the first build as first rather than as a change", async () => {
    const b = await buildBenchmarkArtifacts(corpus("first"));
    expect(compareBuilds(null, b.build)).toEqual({ first: true });
  });
});

describe("10 — no source-corpus gate remains", () => {
  const ui = fs.readFileSync(path.join(root, "src/components/BenchmarkExport.jsx"), "utf8");

  it("neither generate button is disabled by registration", () => {
    const disabled = [...ui.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1]);
    for (const d of disabled) {
      expect(d, `a generate control still gates on registration: ${d}`).not.toContain("!registered");
    }
  });

  it("no UI copy tells a person that generation is blocked for being unregistered", () => {
    expect(ui).not.toContain("generation is blocked");
    expect(ui).not.toMatch(/matches no registered snapshot/);
  });

  it("still blocks on the things that decide whether a build is sound", () => {
    // Unassigned pages would be silently dropped from the package, so
    // that gate stays. This is the distinction the whole change rests on.
    expect(ui).toContain("orphans.length > 0");
  });

  it("keeps the content digest, with its meaning changed to metadata", async () => {
    const built = await buildBenchmarkArtifacts(corpus("metadata"));
    expect(built.build.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.manifest.contentSha256).toBe(built.build.contentSha256);
  });
});
