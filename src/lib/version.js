/* ------------------------------------------------------------------ *
 * Frozen generator contract.
 *
 * The version below identifies the extraction + validation behaviour
 * that produced a given AI file. It is stamped into each document's
 * "## Source" block so a knowledge base can be traced back to the
 * build that made it — which matters once retrieval is being measured,
 * because a benchmark result is only meaningful against a known
 * generator.
 *
 * Bump MINOR when extraction or rendering changes what a correct
 * document contains. Bump PATCH for fixes that cannot change the
 * output of an already-passing page. Either way, re-run the full
 * corpus and the mutation suites before the bump lands — see
 * GENERATOR-CONTRACT.md.
 * ------------------------------------------------------------------ */

export const GENERATOR_VERSION = "1.0.0";
export const GENERATOR_FROZEN_ON = "2026-08-28";
