/* ------------------------------------------------------------------ *
 * Response Consolidator view keys.
 *
 * The app switches views on one `selected` string (see App.jsx), where
 * bucket names and the utility pages ("Changelog", "Benchmark", …)
 * share the same namespace. Bucket names are user-chosen, so the
 * Consolidator's keys carry a prefix no sensible tag name would use —
 * a bucket called "Raw Sessions" must never open this module instead.
 *
 * Every view is tagged with the data layer it shows. RAW views show the
 * imported records or a structured reading of them; DERIVED views show
 * AI-generated candidates. The sidebar groups by this, so the
 * distinction is visible wherever the user navigates.
 * ------------------------------------------------------------------ */

export const LAYER_RAW = "RAW";
export const LAYER_DERIVED = "DERIVED";

export const RC_IMPORT = "responses:import";
export const RC_RAW_SESSIONS = "responses:raw-sessions";
export const RC_EXTRACTED_QA = "responses:extracted-qa";
export const RC_QUESTIONS = "responses:question-consolidation";

// Ordered as the workflow runs. Later phases append here.
export const RESPONSE_VIEWS = [
  { key: RC_IMPORT, label: "Import Responses", layer: null },
  { key: RC_RAW_SESSIONS, label: "Raw Sessions", layer: LAYER_RAW },
  // A deterministic reading of the raw sessions — wording unchanged, no
  // AI — so it sits with the raw layer, not with the derived one.
  { key: RC_EXTRACTED_QA, label: "Extracted Q&A", layer: LAYER_RAW },
  // The main output: real questions consolidated into clean ones.
  { key: RC_QUESTIONS, label: "Question Consolidation", layer: LAYER_DERIVED },
];

export const isResponseView = (key) => typeof key === "string" && key.startsWith("responses:");
