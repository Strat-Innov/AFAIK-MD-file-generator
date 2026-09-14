/* ------------------------------------------------------------------ *
 * KNOWLEDGE BUILD — a reproducible generated state of the knowledge
 * base at one build.
 *
 * The registry used to answer "may this corpus be built?". That was the
 * wrong question. SharePoint rewrites volatile per-export metadata on
 * every page of every export, so the same unedited knowledge base yields
 * a different content digest each time it is exported. Gating on that
 * digest meant an unchanged knowledge base could be refused, and the
 * only way through was to register bytes nobody had characterised —
 * which is worse than not gating at all.
 *
 * So the direction is reversed. The uploaded corpus IS the knowledge
 * base. A build validates it, produces artifacts, and RECORDS what it
 * produced. The record is the output.
 *
 *   upload -> validate -> build -> record
 *
 * What this does not change: every validation that decides whether the
 * artifacts are trustworthy still runs, and still blocks. Coverage
 * failure, unassigned pages, missing or invented units, duplicate
 * filenames — those are statements about whether the build is sound,
 * and they still stop it. What no longer blocks is the question of
 * whether anyone has seen these exact bytes before.
 *
 * `contentSha256` survives the change, with its meaning altered: it was
 * an authorisation key, and is now the fingerprint of what was built.
 * That is what makes two builds comparable, and what makes any build
 * re-derivable from its source.
 * ------------------------------------------------------------------ */

import { sha256 } from "./digest.js";
import { GENERATOR_VERSION } from "./version.js";

/**
 * Record one completed build.
 *
 * `builtAt` is wall-clock and therefore the one field that changes
 * between two identical builds. It describes the build; it is never
 * stamped into the artifacts, which carry a fixed clock so the same
 * corpus always produces the same bytes.
 */
export async function knowledgeBuild({
  identity,
  orderPolicy,
  master,
  ai,
  questions,
  coverage,
  snapshot = null,
  builtAt = new Date(),
  generator = GENERATOR_VERSION,
}) {
  const record = {
    snapshotId: await buildId({ identity, orderPolicy, master, ai, questions }),
    builtAt: new Date(builtAt).toISOString(),
    generator,
    orderPolicy: orderPolicy ?? null,
    pageCount: identity?.sourceFiles ?? null,
    fileSetSha256: identity?.fileSetSha256 ?? null,
    contentSha256: identity?.contentSha256 ?? null,
    masterSha256: master?.sha256 ?? null,
    aiSha256: ai?.sha256 ?? null,
    questionCount: questions?.count ?? null,
    coreSha: questions?.coreSha ?? null,
    sourceCoverage: {
      pages: coverage?.pages ?? null,
      sourceUnits: coverage?.sourceUnits ?? null,
      represented: coverage?.represented ?? null,
      missing: coverage?.missing ?? null,
      unmatched: coverage?.unmatched ?? null,
    },
    /* Lineage, so a build is traceable to a frozen snapshot when it is
     * one. `null` means the corpus is new to the registry — a fact about
     * the registry, not a defect in the build. */
    lineage: snapshot
      ? { snapshot: snapshot.name, label: snapshot.label ?? null, status: snapshot.status ?? null }
      : null,
  };
  return record;
}

/**
 * A build's id, derived from what was built rather than from when.
 *
 * Two builds of the same corpus under the same policy producing the same
 * artifacts are the same build and share an id; that is what makes
 * "deterministic rebuild" checkable rather than asserted. A wall clock
 * here would make every rebuild look novel.
 */
export async function buildId({ identity, orderPolicy, master, ai, questions }) {
  const digest = await sha256([
    identity?.contentSha256 ?? "",
    identity?.fileSetSha256 ?? "",
    orderPolicy ?? "",
    master?.sha256 ?? "",
    ai?.sha256 ?? "",
    questions?.coreSha ?? "",
  ].join("\n"));
  return `build-${digest.slice(0, 16)}`;
}

/** Do two records describe the same built state? `builtAt` is excluded. */
export function sameBuild(a, b) {
  if (!a || !b) return false;
  return a.snapshotId === b.snapshotId;
}

/**
 * What changed between two builds of the knowledge base.
 *
 * Source movement and artifact movement are reported separately: a fresh
 * SharePoint export moves `contentSha256` while leaving the artifacts
 * untouched, and telling those apart is the whole point of keeping the
 * digest as metadata.
 */
export function compareBuilds(previous, next) {
  if (!previous) return { first: true };
  return {
    first: false,
    sourceChanged: previous.contentSha256 !== next.contentSha256,
    fileSetChanged: previous.fileSetSha256 !== next.fileSetSha256,
    masterChanged: previous.masterSha256 !== next.masterSha256,
    aiChanged: previous.aiSha256 !== next.aiSha256,
    questionsChanged: previous.coreSha !== next.coreSha,
    orderPolicyChanged: previous.orderPolicy !== next.orderPolicy,
    pageCountDelta: (next.pageCount ?? 0) - (previous.pageCount ?? 0),
    questionCountDelta: (next.questionCount ?? 0) - (previous.questionCount ?? 0),
    /* The case this architecture exists to name: the export moved but
     * nothing we generate from it did. */
    sourceOnlyChurn:
      previous.contentSha256 !== next.contentSha256 &&
      previous.masterSha256 === next.masterSha256 &&
      previous.aiSha256 === next.aiSha256 &&
      previous.coreSha === next.coreSha,
  };
}
