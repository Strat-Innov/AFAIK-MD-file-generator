import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { publishChangelog, buildEntry, setToken, changelogPath } from "../src/lib/github.js";

/* A stand-in for the Contents API, faithful to the part that matters:
   a write carries the sha the writer believes the file is at, and is
   rejected if the file has moved on. It can also serve a stale read,
   which is the condition that made the original retry loop useless. */
function fakeGitHub({ initial = null, staleReads = 0, conflictStatus = 409 } = {}) {
  const state = { content: initial, sha: initial ? "sha-initial" : null, writes: [], reads: 0, putsWithoutSha: 0 };
  let stale = staleReads;
  let servedSha = state.sha;

  const handler = async (url, options = {}) => {
    if (!options.method || options.method === "GET") {
      state.reads++;
      if (state.content === null) return { status: 404, ok: false, text: async () => "Not Found" };
      // A stale read hands back the sha from before the last write.
      const sha = stale > 0 ? (stale--, servedSha) : state.sha;
      return {
        status: 200, ok: true,
        json: async () => ({ sha, content: Buffer.from(state.content, "utf8").toString("base64") }),
      };
    }
    const body = JSON.parse(options.body);
    if (!body.sha) state.putsWithoutSha++;
    const expected = state.sha;
    if ((expected ?? null) !== (body.sha ?? null)) {
      return {
        status: conflictStatus, ok: false,
        text: async () => `${changelogPath("X")} does not match ${expected}`,
      };
    }
    servedSha = state.sha;
    state.content = Buffer.from(body.content, "base64").toString("utf8");
    state.sha = `sha-${state.writes.length + 1}`;
    state.writes.push(state.content);
    return { status: 200, ok: true, json: async () => ({ content: { sha: state.sha } }) };
  };

  // Simulates someone else writing between our read and our write.
  state.othersWrite = (text) => {
    servedSha = state.sha;
    state.content = text;
    state.sha = `sha-other-${Math.random().toString(16).slice(2, 8)}`;
  };
  return { state, handler };
}

const CHANGES = [{ filename: "Home.aspx", version: 2, modifiedAt: 1, changes: [{ label: "Quick links", type: "quicklinks", kind: "list", added: [{ key: "k", label: "Home (/x)" }], removed: [] }] }];
const noSleep = { sleep: async () => {} };

beforeEach(() => {
  globalThis.localStorage = { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = v; }, removeItem(k) { delete this.store[k]; } };
  setToken("test-token");
});
afterEach(() => { vi.restoreAllMocks(); });

describe("changelog publishing under optimistic concurrency", () => {
  it("publishes when nothing exists yet", async () => {
    const { state, handler } = fakeGitHub();
    vi.stubGlobal("fetch", handler);
    const entry = await publishChangelog("NAVIGATION PAGES", CHANGES, noSleep);
    expect(state.writes).toHaveLength(1);
    expect(state.content.startsWith(entry)).toBe(true);
  });

  it("recovers from a 409 by reconciling against the newer file", async () => {
    // The exact reported failure: the file moved on between our read and
    // our write, so the first PUT is rejected with a sha mismatch.
    const { state, handler } = fakeGitHub({ initial: "## OLD ENTRY\n" });
    let intercepted = false;
    vi.stubGlobal("fetch", async (url, options) => {
      if (options?.method === "PUT" && !intercepted) {
        intercepted = true;                       // someone else lands a write first
        state.othersWrite("## SOMEONE ELSE'S ENTRY\n\n---\n\n## OLD ENTRY\n");
      }
      return handler(url, options);
    });

    const entry = await publishChangelog("NAVIGATION PAGES", CHANGES, noSleep);

    expect(state.writes).toHaveLength(1);
    expect(state.content.startsWith(entry)).toBe(true);
    // The other party's entry must survive — that is what the sha check
    // is protecting, and the whole reason we do not simply overwrite.
    expect(state.content).toContain("SOMEONE ELSE'S ENTRY");
    expect(state.content).toContain("OLD ENTRY");
  });

  it("survives a stale read that returns the sha which just lost", async () => {
    // Before the fix this was fatal: every retry re-read the same cached
    // sha and re-lost, inside the same millisecond.
    const { state, handler } = fakeGitHub({ initial: "## OLD\n", staleReads: 2 });
    let first = true;
    vi.stubGlobal("fetch", async (url, options) => {
      if (options?.method === "PUT" && first) { first = false; state.othersWrite("## NEWER\n"); }
      return handler(url, options);
    });
    const entry = await publishChangelog("NAVIGATION PAGES", CHANGES, noSleep);
    expect(state.content.startsWith(entry)).toBe(true);
    expect(state.content).toContain("NEWER");
  });

  it("treats a 422 sha mismatch as a conflict, not a fatal error", async () => {
    const { state, handler } = fakeGitHub({ initial: "## OLD\n", conflictStatus: 422 });
    let first = true;
    vi.stubGlobal("fetch", async (url, options) => {
      if (options?.method === "PUT" && first) { first = false; state.othersWrite("## NEWER\n"); }
      return handler(url, options);
    });
    const entry = await publishChangelog("NAVIGATION PAGES", CHANGES, noSleep);
    expect(state.content.startsWith(entry)).toBe(true);
    expect(state.content).toContain("NEWER");
  });

  it("never writes without a sha, and never overwrites, even when it gives up", async () => {
    const { state, handler } = fakeGitHub({ initial: "## OTHERS\n" });
    vi.stubGlobal("fetch", async (url, options) => {
      if (options?.method === "PUT") state.othersWrite("## OTHERS\n"); // conflict every time
      return handler(url, options);
    });
    await expect(publishChangelog("NAVIGATION PAGES", CHANGES, noSleep)).rejects.toThrow(/changed underneath us/);
    expect(state.writes).toHaveLength(0);
    expect(state.putsWithoutSha).toBe(0);
    expect(state.content).toBe("## OTHERS\n");   // untouched
  });

  it("does not publish the same entry twice if a write landed but its response was lost", async () => {
    const entry = buildEntry("NAVIGATION PAGES", CHANGES);
    const { state, handler } = fakeGitHub({ initial: `${entry}\n\n---\n\n## OLD\n` });
    vi.stubGlobal("fetch", handler);
    const returned = await publishChangelog("NAVIGATION PAGES", CHANGES, noSleep);
    expect(returned).toBe(entry);
    expect(state.writes).toHaveLength(0);                       // nothing rewritten
    expect(state.content.split("Changes since").length - 1).toBe(1); // still exactly one copy
  });

  it("backs off between attempts rather than burning them instantly", async () => {
    const { state, handler } = fakeGitHub({ initial: "## OLD\n" });
    vi.stubGlobal("fetch", async (url, options) => {
      if (options?.method === "PUT") state.othersWrite("## OLD\n");
      return handler(url, options);
    });
    const delays = [];
    await expect(
      publishChangelog("NAVIGATION PAGES", CHANGES, { sleep: async (ms) => { delays.push(ms); } })
    ).rejects.toThrow();
    expect(delays.length).toBeGreaterThan(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b)); // increasing
    expect(delays[0]).toBeGreaterThan(0);
  });

  it("propagates a non-conflict failure immediately", async () => {
    vi.stubGlobal("fetch", async (url, options) =>
      options?.method === "PUT"
        ? { status: 403, ok: false, text: async () => "Forbidden" }
        : { status: 404, ok: false, text: async () => "Not Found" });
    await expect(publishChangelog("NAVIGATION PAGES", CHANGES, noSleep)).rejects.toThrow(/403/);
  });

  it("reads without a cache, so a retry cannot be served the losing sha", async () => {
    const seen = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      if (!options.method || options.method === "GET") seen.push(options);
      return { status: 404, ok: false, text: async () => "Not Found" };
    });
    await publishChangelog("NAVIGATION PAGES", CHANGES, noSleep).catch(() => {});
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].cache).toBe("no-store");
  });
});
