/* ------------------------------------------------------------------ *
 * GENERATION RUN — one corpus, three artifacts, one identity.
 *
 * A snapshot produces the Master file, the AI-optimized file and the
 * question set. They may be produced by different code paths at
 * different moments, but they only mean anything together: a question
 * set is ground truth for the corpus it was generated from, and an arm
 * artifact is only comparable against results gathered on the same one.
 *
 * A run manifest is what ties them. It records the snapshot identity and
 * every artifact digest produced against it, so a later reader can ask
 * "were these three built from the same pages?" and get an answer from
 * the record rather than from filenames and timestamps.
 *
 * WHAT IS NOT IN IT. No artifact's canonical content carries a run id or
 * a wall-clock time — that would make every regeneration produce
 * different bytes and destroy the reproducibility the digests exist for.
 * The manifest sits BESIDE the artifacts and describes them.
 * ------------------------------------------------------------------ */

import { sha256 } from "./digest.js";

/**
 * A run id derived from what the run actually produced, not from a clock
 * or a random source. Two runs over the same corpus with the same
 * generator produce the same id — which is the point: it identifies the
 * inputs, so a rebuild that changes nothing does not look like new work.
 */
export async function newRunId({ snapshot, generatorVersion, masterSha, aiSha, questionSetSha }) {
  const material = [snapshot, generatorVersion, masterSha, aiSha, questionSetSha]
    .map((v) => (v == null ? "-" : String(v)))
    .join("\n");
  return `run-${(await sha256(material)).slice(0, 16)}`;
}

/**
 * Build the manifest for one run.
 *
 * `producedAt` is recorded because it is genuinely useful to a person
 * reading the file — but it is deliberately NOT part of the run id, so
 * it cannot make an otherwise identical run look different.
 */
export async function buildRunManifest({
  snapshot,
  snapshotSha256,
  generatorVersion,
  masterSha = null,
  aiSha = null,
  questionSetSha = null,
  questions = null,
  corpusPages = null,
  validation = null,
  sourceIntegrity = null,
  questionQuality = null,
  producedAt = new Date(),
}) {
  const generationRunId = await newRunId({
    snapshot, generatorVersion, masterSha, aiSha, questionSetSha,
  });
  return {
    generationRunId,
    snapshot,
    snapshotSha256,
    generatorVersion,
    producedAt: producedAt.toISOString(),
    corpusPages,
    artifacts: {
      master: masterSha ? { sha256: masterSha } : null,
      ai: aiSha ? { sha256: aiSha } : null,
      questionSet: questionSetSha ? { sha256: questionSetSha, questions } : null,
    },
    validation,
    sourceIntegrity,
    questionQuality,
  };
}

/**
 * Do these artifacts belong to the same run?
 *
 * The check people actually need: a question set generated against one
 * corpus and an arm artifact generated against another are not a
 * benchmark, however similar their filenames look.
 */
export function sameRun(manifestA, manifestB) {
  if (!manifestA || !manifestB) return false;
  return (
    manifestA.snapshot === manifestB.snapshot &&
    manifestA.snapshotSha256 === manifestB.snapshotSha256 &&
    manifestA.generatorVersion === manifestB.generatorVersion
  );
}

/** Which artifacts of a run are present, and which are still missing. */
export function runCompleteness(manifest) {
  const a = manifest?.artifacts ?? {};
  const present = ["master", "ai", "questionSet"].filter((k) => a[k]?.sha256);
  return {
    present,
    missing: ["master", "ai", "questionSet"].filter((k) => !a[k]?.sha256),
    complete: present.length === 3,
  };
}
