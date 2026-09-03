/* ------------------------------------------------------------------ *
 * BENCHMARK EXPORT — the canonical Arm B / Arm C recipe.
 *
 * The app's normal output is one Master file per bucket: five files for
 * the August corpus, each stamped with the wall clock at the moment it
 * was generated. That is the right production packaging, and it is not
 * what the retrieval benchmark can use.
 *
 * The benchmark compares REPRESENTATION, so packaging has to be held
 * constant across arms: one consolidated file each, over the identical
 * page set (benchmark/README.md). It also has to be reproducible, so a
 * result can be tied to exactly the bytes that produced it — which the
 * wall-clock header defeats.
 *
 * Hence this module. It adds no extraction or rendering logic; it fixes
 * the three things the benchmark needs fixed:
 *
 *   1. ONE bucket holding every file, named for the snapshot rather
 *      than for a tag  — the corpus carries no tag assignment, and
 *      inventing one would add a second variable.
 *   2. A FIXED clock, so buildMaster()'s header stops changing on every
 *      run and the artifact can be checksummed.
 *   3. A manifest recording what was built and its SHA-256.
 *
 * It is deliberately the ONLY definition of that recipe: both
 * scripts/build-arms.mjs (Node, reads test/corpus) and the in-app
 * Benchmark Export panel (browser, reads the session's files) call this
 * function, so the two front-ends produce identical bytes by
 * construction rather than by coincidence.
 *
 * Production bucket generation does not go through here and is
 * unchanged — see buildOutputs() in App.jsx.
 * ------------------------------------------------------------------ */

import { buildMaster } from "./masterMd.js";
import { generateOptimized } from "./generate.js";
import { GENERATOR_VERSION } from "./version.js";

/* ---- frozen snapshot identity ----
 * Changing any of these changes what a benchmark result means, so they
 * are pinned here rather than passed in. See GENERATOR-CONTRACT.md. */
export const SNAPSHOT = "AUGUST-2026-CORPUS";
export const SNAPSHOT_CLOCK = new Date(Date.UTC(2026, 7, 31, 0, 0, 0));

export const ARM_B_FILE = `${SNAPSHOT}_Master_File.md`;
export const ARM_C_FILE = `${SNAPSHOT}_AI_File.md`;
/* ---- packaging ----
 * Two shapes, both with identical packaging across arms:
 *
 *   the Copilot-safe package  5 files per arm, one per production
 *                             bucket — the recommended package, and the
 *                             only one this tenant's "Add knowledge"
 *                             upload accepts, since it caps a file at
 *                             16 MB and the consolidated Arm B is 37 MB
 *   the consolidated arms     1 file per arm — kept because it is what
 *                             the frozen checksums describe, and it is
 *                             still the right shape wherever a single
 *                             large file can be uploaded
 */
export const BENCHMARK_ZIP_FILE = `${SNAPSHOT.replace(/-CORPUS$/, "")}-COPILOT-BENCHMARK.zip`;
export const CONSOLIDATED_ZIP_FILE = `${SNAPSHOT}_Consolidated-Arms.zip`;

// Observed on the tenant: "Add knowledge" refuses a file above this.
// Microsoft documents 512 MB for an uploaded knowledge source and 16 MB
// for Code Interpreter analysis; the upload path in front of us enforces
// the smaller number, so that is what the package is checked against.
export const COPILOT_FILE_LIMIT = 16 * 1024 * 1024;

// "LIFE AT FAI PAGE" -> "LIFE-AT-FAI-PAGE". The bucket name is the
// person's own tag, so it is carried through rather than renamed.
export function bucketSlug(name) {
  return String(name).trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase();
}

/* ---- the artifacts the pre-flight was verified against ----
 * Hashes only — nothing here reproduces corpus content. They let the
 * export say "this is the same artifact" instead of leaving a silent
 * divergence to be discovered mid-benchmark. A mismatch is not
 * necessarily a defect: it means the input file set differs from the
 * one these were built from, and the export reports which. */
export const CANONICAL = {
  pages: 133,
  filesSha256: "d76c3e6ccf26e449399cc21078f7a72b224a7bd9b022c7ba053e9ede83d8a610",
  armBSha256: "6001b8760126a6e479d75c335e2f7f2af9ebef77ae68d0f92b1873173d011e87",
  armCSha256: "a911dac67115ce08e359df94607fe0c009c063a6a89ded86d65ca7665eabc56a",
  sourceUnits: 4791,
};

// WebCrypto rather than node:crypto so the one implementation runs in
// both front-ends. Present in every browser on a secure context and in
// Node >= 18.
export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const byteLength = (text) => new TextEncoder().encode(text).length;

/**
 * Builds both benchmark arms from one file list.
 *
 * Arm B is never gated — it is the fidelity layer. Arm C is produced
 * only on a validation PASS, exactly as the app's own download is:
 * `armC.md` is empty and `armC.sha256` is null on a FAIL, and
 * `validation` carries the report.
 *
 * `files` are {name, path, raw} — the same shape the app's buckets and
 * the CLI's corpus reader both use. Order is irrelevant: buildMaster()
 * and generateOptimized() each sort by lowercased filename.
 */
export async function buildBenchmarkArtifacts(files, { builtAt = new Date() } = {}) {
  const names = [...files].map((f) => f.name).sort();
  const filesSha256 = await sha256(names.join("\n"));

  const masterMd = buildMaster(SNAPSHOT, files, SNAPSHOT_CLOCK);
  const optimized = generateOptimized(SNAPSHOT, files);
  const pass = optimized.status === "PASS";

  const armB = {
    arm: "B",
    file: `arm-b/${ARM_B_FILE}`,
    filename: ARM_B_FILE,
    md: masterMd,
    bytes: byteLength(masterMd),
    sha256: await sha256(masterMd),
    pages: files.length,
  };
  const armC = {
    arm: "C",
    file: `arm-c/${ARM_C_FILE}`,
    filename: ARM_C_FILE,
    md: optimized.md,
    bytes: pass ? byteLength(optimized.md) : 0,
    sha256: pass ? await sha256(optimized.md) : null,
    pages: optimized.pages.length,
    validation: {
      status: optimized.status,
      sourceUnits: optimized.totals.sourceUnits,
      representedUnits: optimized.totals.representedUnits,
      untraceableUnits: optimized.totals.unmatched,
    },
  };

  const manifest = {
    snapshot: SNAPSHOT,
    generatorVersion: GENERATOR_VERSION,
    snapshotClock: SNAPSHOT_CLOCK.toISOString(),
    builtAt: builtAt.toISOString(), // informational only; not part of any checksum
    corpusPages: files.length,
    arms: {
      B: {
        description: "Consolidated master file — the representation the app shipped before this work",
        file: armB.file,
        bytes: armB.bytes,
        sha256: armB.sha256,
        pages: armB.pages,
      },
      C: {
        description: "AI-optimized file — retrieval representation, published only on a validation PASS",
        file: armC.file,
        bytes: armC.bytes,
        sha256: armC.sha256,
        pages: armC.pages,
        validation: armC.validation,
      },
    },
    // Both arms are built from this exact file set. Arm A supplies none
    // of them; it is the live SharePoint site with no uploaded knowledge.
    files: names,
    filesSha256,
  };

  return { snapshot: SNAPSHOT, generatorVersion: GENERATOR_VERSION, armB, armC, optimized, manifest, filesSha256 };
}

/**
 * Compares a build against the verified artifacts. Reported, never
 * enforced: a benchmark run on a different corpus is a legitimate thing
 * to do, it just is not the run the pre-flight was designed against.
 */
export function compareToCanonical({ armB, armC, filesSha256 }) {
  return {
    files: filesSha256 === CANONICAL.filesSha256,
    armB: armB.sha256 === CANONICAL.armBSha256,
    armC: armC.sha256 === CANONICAL.armCSha256,
    pages: armB.pages === CANONICAL.pages,
  };
}

/**
 * Re-derives each artifact's SHA-256 from the bytes now in hand and
 * checks it two ways: against the digest recorded at build time, and
 * against the frozen canonical digest.
 *
 * The first check is the one worth having. `matchesCanonical` only
 * repeats what compareToCanonical already said; `selfConsistent` proves
 * the number on screen still describes the bytes the download button is
 * about to hand over, which is the claim a person actually relies on
 * when they check the file after saving it.
 */
export async function verifyArtifacts({ armB, armC }) {
  const check = async (artifact, canonicalSha) => {
    if (!artifact.md) return { produced: false, selfConsistent: null, matchesCanonical: null, sha256: null };
    const recomputed = await sha256(artifact.md);
    return {
      produced: true,
      sha256: recomputed,
      selfConsistent: recomputed === artifact.sha256,
      matchesCanonical: recomputed === canonicalSha,
    };
  };
  const B = await check(armB, CANONICAL.armBSha256);
  const C = await check(armC, CANONICAL.armCSha256);
  return { armB: B, armC: C, ok: B.selfConsistent !== false && C.selfConsistent !== false };
}

// Identifies the exact input set a build came from, so a result can be
// marked stale the moment the staged files change underneath it.
export function fileSetSignature(files) {
  return [...files].map((f) => f.name).sort().join("\u0000");
}

/* ------------------------------------------------------------------ *
 * The Copilot-safe package: both arms, split along the SAME production
 * bucket boundaries.
 *
 * This is not a size-driven split of the consolidated file. Each bucket
 * is generated the way the app already generates that bucket —
 * buildMaster(bucket, files, clock) and generateOptimized(bucket, files),
 * the identical calls buildOutputs() makes — so a bucket's Arm B file is
 * the production Master file for that tag, differing only in carrying
 * the fixed snapshot clock instead of the wall clock.
 *
 * Because both arms are cut on the same boundaries and cover the same
 * pages, packaging is held constant and representation remains the only
 * variable, which is the whole point of the experiment.
 *
 * `bucketMap` is { [bucketName]: files[] } — the app's own bucket state,
 * which is the only authoritative record of the boundaries. The corpus
 * carries no tag assignment, so the partition is recorded in the
 * manifest: a result is reproducible only against the partition it was
 * built from.
 * ------------------------------------------------------------------ */
export async function buildBucketPackage(bucketMap, { builtAt = new Date() } = {}) {
  const buckets = Object.entries(bucketMap)
    .map(([name, files]) => ({ name, files: files || [] }))
    .filter((b) => b.files.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const allNames = buckets.flatMap((b) => b.files.map((f) => f.name)).sort();
  const filesSha256 = await sha256(allNames.join("\n"));

  const armB = [];
  const armC = [];
  const failed = [];
  const totals = { sourceUnits: 0, representedUnits: 0, untraceableUnits: 0 };

  for (const bucket of buckets) {
    const slug = bucketSlug(bucket.name);
    const master = buildMaster(bucket.name, bucket.files, SNAPSHOT_CLOCK);
    armB.push({
      arm: "B", bucket: bucket.name, filename: `${slug}_Master.md`, file: `ARM-B/${slug}_Master.md`,
      md: master, bytes: byteLength(master), sha256: await sha256(master), pages: bucket.files.length,
    });

    const optimized = generateOptimized(bucket.name, bucket.files);
    if (optimized.status !== "PASS") failed.push({ bucket: bucket.name, result: optimized });
    totals.sourceUnits += optimized.totals.sourceUnits;
    totals.representedUnits += optimized.totals.representedUnits;
    totals.untraceableUnits += optimized.totals.unmatched;
    armC.push({
      arm: "C", bucket: bucket.name, filename: `${slug}_AI.md`, file: `ARM-C/${slug}_AI.md`,
      md: optimized.md, bytes: optimized.status === "PASS" ? byteLength(optimized.md) : 0,
      sha256: optimized.status === "PASS" ? await sha256(optimized.md) : null,
      pages: optimized.pages.length,
      validation: {
        status: optimized.status,
        sourceUnits: optimized.totals.sourceUnits,
        representedUnits: optimized.totals.representedUnits,
        untraceableUnits: optimized.totals.unmatched,
      },
    });
  }

  const status = failed.length === 0 ? "PASS" : "FAIL";
  // Checked before the package is offered, not after it is uploaded.
  const oversize = [...armB, ...armC].filter((a) => a.bytes > COPILOT_FILE_LIMIT);
  const pages = buckets.reduce((n, b) => n + b.files.length, 0);

  const manifest = {
    snapshot: SNAPSHOT,
    packaging: "five-bucket",
    generatorVersion: GENERATOR_VERSION,
    snapshotClock: SNAPSHOT_CLOCK.toISOString(),
    builtAt: builtAt.toISOString(), // informational only; not part of any checksum
    corpusPages: pages,
    fileSizeLimit: COPILOT_FILE_LIMIT,
    // The boundaries this package was cut on. Without these a result
    // cannot be reproduced, since the corpus carries no tag assignment.
    buckets: buckets.map((b) => ({ name: b.name, slug: bucketSlug(b.name), pages: b.files.map((f) => f.name).sort() })),
    arms: {
      B: {
        description: "Master representation, one file per production bucket",
        files: armB.map(({ arm, md, ...rest }) => rest),
      },
      C: {
        description: "AI-optimized representation, the same buckets — published only on a validation PASS",
        files: armC.map(({ arm, md, ...rest }) => rest),
        validation: { status, ...totals },
      },
    },
    files: allNames,
    filesSha256,
  };

  return { snapshot: SNAPSHOT, generatorVersion: GENERATOR_VERSION, buckets, armB, armC, status, failed, totals, oversize, pages, filesSha256, manifest };
}

// The archive laid out for upload: ARM-B/ and ARM-C/ side by side, plus
// the manifest that says what each file is and what it hashes to.
export function packageEntries(pkg) {
  return [
    ...pkg.armB.map((a) => ({ name: a.file, text: a.md })),
    ...pkg.armC.map((a) => ({ name: a.file, text: a.md })),
    { name: "manifest.json", text: JSON.stringify(pkg.manifest, null, 2) },
  ];
}
