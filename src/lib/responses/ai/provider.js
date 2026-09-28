/* ------------------------------------------------------------------ *
 * AI provider abstraction.
 *
 * The consolidation engine (intentPackage.js, and later passes) builds
 * provider-neutral *requests*: a task, structured input, the required
 * output schema. A provider decides how a request reaches a model. The
 * UI talks to the provider interface only, so a different provider can
 * be added later without touching the engine or the views.
 *
 * Contract — an AIProvider is:
 *   {
 *     id:        stable identifier
 *     label:     shown in the UI
 *     automatic: true if it sends data to a service by itself. Such a
 *                provider must be configured and confirmed by the user
 *                before any call (none exists in v1).
 *     render(request) -> { promptText }   what the model is given
 *   }
 * Parsing and validating the model's reply is Phase 8 and will be added
 * to this contract then.
 *
 * v1 ships one provider: a manual round-trip. The app produces the
 * prompt; the user decides whether to paste it into Claude. Nothing
 * leaves the browser on the app's initiative, and no API key exists.
 * ------------------------------------------------------------------ */

import { renderIntentPrompt, INTENT_TASK } from "./intentPackage.js";

const RENDERERS = { [INTENT_TASK]: renderIntentPrompt };

export const manualClaudeProvider = Object.freeze({
  id: "manual-claude",
  label: "Claude — manual copy and paste",
  automatic: false,
  render(request) {
    const render = RENDERERS[request.task];
    if (!render) throw new Error(`No prompt renderer for task "${request.task}".`);
    return { promptText: render(request) };
  },
});

export const PROVIDERS = Object.freeze([manualClaudeProvider]);
export const DEFAULT_PROVIDER = manualClaudeProvider;
