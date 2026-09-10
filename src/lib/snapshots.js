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
    status: "superseded",
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
    name: "SEPTEMBER-2026-CORPUS",
    status: "frozen",
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
