/* ------------------------------------------------------------------ *
 * SNAPSHOT REGISTRY — which frozen corpus is this, really?
 *
 * A benchmark result is only meaningful against the corpus it was run
 * on, so the corpus has to identify itself. It does that by content,
 * never by the calendar: the month a person happens to be working in
 * says nothing about which export they just loaded, and a corpus loaded
 * in October may well be the September snapshot.
 *
 * The identity chain is:
 *
 *   loaded files -> content-inclusive SHA-256 -> registry -> metadata
 *
 * TWO DIGESTS, TWO JOBS. `fileSetSha256` hashes the sorted FILENAMES
 * only. It is what the existing artifacts and manifests already record,
 * so it is kept and still reported — but it cannot be the identity,
 * because a corpus whose pages changed without any file being added or
 * removed hashes identically. September changed 62 of 133 pages; had it
 * not also added one file, a filename-keyed registry would have
 * confidently labelled it August. `contentSha256` hashes name and file
 * content together and is therefore the identity used for detection.
 *
 * Adding a snapshot means adding one entry here. Nothing else in the
 * codebase should carry a snapshot constant.
 * ------------------------------------------------------------------ */

import { sha256 } from "./digest.js";

export const UNREGISTERED = "UNREGISTERED SNAPSHOT";
// Used when artifacts are built from a corpus that matches no registered
// snapshot. Deliberately not a real snapshot name and not today's date:
// an unregistered corpus must never be mistaken for a frozen one.
export const UNREGISTERED_ID = "UNREGISTERED-SNAPSHOT";
export const UNREGISTERED_CLOCK = new Date(Date.UTC(1970, 0, 1, 0, 0, 0));

/* ---- the registry ---- */
export const SNAPSHOTS = [
  {
    name: "AUGUST-2026-CORPUS",
    label: "August 2026",
    status: "superseded",
    evaluation: { status: "partial", note: "Diagnostic runs only; no full three-arm execution." },
    contentSha256: "96ef74084723c3d35cdf50d95dc7b3f1c62524125d3c7e9942aa13fe39042d7a",
    fileSetSha256: "d76c3e6ccf26e449399cc21078f7a72b224a7bd9b022c7ba053e9ede83d8a610",
    sourceFiles: 133,
    benchmarkPages: 128,
    clock: "2026-08-31T00:00:00.000Z",
    generator: "1.1.0",
    questionSetSha256: "ed410946f7dc284c9693cf9a2925b508e2f22140ec9b7d3722ddbe8d8d9507b6",
    questions: 638,
    armBSha256: "6001b8760126a6e479d75c335e2f7f2af9ebef77ae68d0f92b1873173d011e87",
    armCSha256: "103a6ec97acc6d78b6648d183f1883b25c165188be63f956f39a203b4b7dd124",
    sourceUnits: 4791,
    archive: "benchmark/corpora/august-2026",
    supersededOn: "2026-09-10",
    note:
      "Historical evidence for the Arm C v1.0 and v1.1 diagnostic runs. September changed 62 of " +
      "its 133 pages and added one, so results are not comparable across the boundary.",
  },
  {
    // Historical. Executed in full and independently audited, then
    // superseded when the defective source page was deleted. Its name,
    // digests and results are frozen evidence: the artifacts on disk are
    // stamped with this name, so renaming it would break reproduction.
    name: "SEPTEMBER-2026-CORPUS",
    label: "September 2026 V1",
    status: "historical",
    contentSha256: "b12d87b7e27a087565191e2fd044a910e2f3528339838e161bdc30041c2b80ca",
    fileSetSha256: "69cdbacdd9fb49b4078cc0978e355359e65793683628e7ed1ccb866495090119",
    sourceFiles: 134,
    benchmarkPages: 128,
    clock: "2026-09-09T00:00:00.000Z",
    generator: "1.1.0",
    questionSetSha256: "40befe1d18c3c75bbe6d8e1f502e6dee2437e53ac40cb4871f17920015465d33",
    questions: 641,
    armBSha256: "409af018d1659277f8b5acf04ffe6532802bcee7fda0499137d5d24036ad2ad6",
    armCSha256: "b0408d31751f4f4e964d4dd221ec921809f2944be67ce4587f0b3c4928bc1e5c",
    sourceUnits: 4864,
    archive: "benchmark/corpora/september-2026",
    questionSetArchive: "benchmark/history/september-2026-v1",
    supersededOn: "2026-09-11",
    // Raw evaluator output, preserved exactly as reported. Adjudication
    // lives in benchmark/AUDIT-SEPTEMBER-V1.md and never overwrites this.
    evaluation: {
      status: "complete",
      evaluations: 1923,
      methods: ["general_quality"],
      arms: {
        A: { pass: 317, fail: 323, error: 1, other: 0, questions: 641 },
        B: { pass: 378, fail: 263, error: 0, other: 0, questions: 641 },
        C: { pass: 628, fail: 12, error: 0, other: 1, questions: 641 },
      },
    },
    note:
      "Contaminated source: South-Station-Terminal(test).aspx carried Two Botanika residential " +
      "content under a transport-terminal title, so 34 questions (q0525-q0558) encode that " +
      "contamination as ground truth. Retained as the historical record of a completed, audited " +
      "run; not a valid baseline for future comparison.",
  },
  {
    // Current. The defective page was deleted at source, so it is simply
    // absent from this corpus — it is NOT on an exclusion list, because
    // there is nothing left to exclude.
    name: "SEPTEMBER-2026-V2-CORPUS",
    label: "September 2026 V2 (cleaned)",
    status: "frozen",
    contentSha256: "212e998c36baa92d4413d626403eb16cefc0a045352dbcd7f176ca6065b46e2f",
    fileSetSha256: "822fba2ff4e74e81930797ade2a28e5ba12efbb03a07a9ab099b0310be3cf033",
    sourceFiles: 133,
    benchmarkPages: 127,
    clock: "2026-09-11T00:00:00.000Z",
    generator: "1.1.0",
    questionSetSha256: "1f93c4a5d9d927c1044498df09fec5d7fa141a613da3993c8fd27fb5200f2990",
    questions: 607,
    armBSha256: "bb5f8eda7f364c8868ba5fe7827d26cef6b135dd3cea108be080815674f14aea",
    armCSha256: "65e8001fae11179d2e0808d7b48964f1702f6f31898535fc21b1faf4eb112c75",
    sourceUnits: 4779,
    archive: "benchmark/corpora/september-2026-v2",
    evaluation: { status: "not-run" },
    note:
      "September 2026 with the defective test page deleted at source. Question ids are renumbered " +
      "because the set is regenerated, not edited, so V1 ids do not map onto V2 ids.",
  },
];

// Exactly one snapshot is active. More than one, or none, is a
// registry error rather than something to paper over at runtime.
const frozen = SNAPSHOTS.filter((s) => s.status === "frozen");
if (frozen.length !== 1) {
  throw new Error(`the registry must hold exactly one frozen snapshot, found ${frozen.length}`);
}
export const ACTIVE_SNAPSHOT = frozen[0];
export const SUPERSEDED_SNAPSHOTS = SNAPSHOTS.filter((s) => s.status !== "frozen");

/** Snapshots that carry a completed evaluation. Their numbers are
 *  evidence and must never be recomputed against a newer corpus. */
export const HISTORICAL_SNAPSHOTS = SNAPSHOTS.filter(
  (s) => s.evaluation && s.evaluation.status === "complete"
);

/** Has the active snapshot been evaluated yet? A freshly rebuilt corpus
 *  has artifacts and a question set but no results, and the UI must say
 *  so rather than implying the last run describes it. */
export const evaluationStatusOf = (snapshot) => snapshot?.evaluation?.status ?? "unknown";
export const isEvaluated = (snapshot) => evaluationStatusOf(snapshot) === "complete";

/**
 * The objective identity of a loaded corpus.
 *
 * Sorted by name, so upload order cannot change it. Content is hashed
 * alongside the name, so an edited page changes the identity. A
 * duplicate filename is reported rather than silently collapsed — two
 * copies of a page is not the same corpus as one.
 */
export async function corpusIdentity(files) {
  const rows = await Promise.all(
    [...files].map(async (f) => ({ name: f.name, sha: await sha256(f.raw ?? "") }))
  );
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const names = rows.map((r) => r.name);
  const duplicates = names.filter((n, i) => i > 0 && n === names[i - 1]);
  return {
    sourceFiles: rows.length,
    duplicates: [...new Set(duplicates)],
    fileSetSha256: await sha256(names.join("\n")),
    contentSha256: await sha256(rows.map((r) => `${r.name} ${r.sha}`).join("\n")),
  };
}

/**
 * Which registered snapshot is this? Content decides; nothing else is
 * consulted — not the date, not the filenames alone, not the order the
 * files arrived in.
 */
export async function detectSnapshot(files) {
  const identity = await corpusIdentity(files);
  const snapshot = SNAPSHOTS.find((s) => s.contentSha256 === identity.contentSha256) || null;
  return { status: snapshot ? "registered" : "unregistered", snapshot, identity };
}

// What to display and stamp for a detection result. An unregistered
// corpus gets an explicitly unregistered identity — never a guessed
// month, and never the active snapshot's name.
export function snapshotIdentityOf(detection) {
  if (detection.status === "registered") {
    return {
      name: detection.snapshot.name,
      clock: new Date(detection.snapshot.clock),
      generator: detection.snapshot.generator,
      registered: true,
    };
  }
  return { name: UNREGISTERED_ID, clock: UNREGISTERED_CLOCK, generator: null, registered: false };
}
