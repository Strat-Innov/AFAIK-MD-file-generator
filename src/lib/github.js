/* ------------------------------------------------------------------ *
 * Pushes one Minecraft-style changelog entry per bucket to
 * changelogs/{TAG}_Master_Changelog.md in this same repo, prepending
 * newest-first. Only called when a diff was actually found — see
 * snapshot.js. No fallback auth path: if there's no token, this
 * throws rather than silently skipping the publish.
 * ------------------------------------------------------------------ */

const OWNER = "Strat-Innov";
const REPO = "AFAIK-MD-file-generator";
const BRANCH = "main";
const TOKEN_KEY = "afaik-github-token-v1";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  const t = token.trim();
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export function hasToken() {
  return !!getToken();
}

// UTF-8-safe base64 encode/decode (plain btoa/atob mishandle non-ASCII).
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function formatDate(d) {
  return d.toLocaleString(undefined, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function changelogPath(tag) {
  return `changelogs/${tag.replace(/[^\w.-]+/g, "_")}_Master_Changelog.md`;
}

export function buildEntry(tag, fileVersionChanges, when = new Date()) {
  let s = `## ${tag} Master Changelog\nPosted: ${formatDate(when)}\n\nChanges since the previous generation:\n\n`;
  for (const fv of fileVersionChanges) {
    s += `### ${fv.filename} — Version ${fv.version}\n`;
    if (fv.modifiedAt != null) s += `<!-- modifiedAt:${fv.modifiedAt} -->\n`;
    for (const c of fv.changes) {
      s += `${c.label}\n`;
      if (c.kind === "list") {
        for (const a of c.added) s += `* ${a.label} (New)\n`;
        for (const r of c.removed) s += `* ${r.label} (Removed)\n`;
      } else if (c.kind === "fields") {
        for (const fc of c.fieldChanges) {
          s += fc.from == null ? `* ${fc.field}: ${fc.to} (New)\n` : `* ${fc.field}: changed from "${fc.from}" to "${fc.to}"\n`;
        }
      } else {
        s += `* Content changed\n`;
      }
    }
    s += `\n`;
  }
  return s.trim();
}

// Reads the published changelog itself as the authoritative record of each
// file's last known version + modification time — not local storage, which
// can be cleared or simply absent on a different browser/device. Only the
// topmost (most recent) mention of a filename counts, since entries are
// prepended newest-first.
export function parseFileRecords(changelogText) {
  const records = {};
  const re = /### (.+?) — Version (\d+)\n(?:<!-- modifiedAt:(\d+) -->\n)?/g;
  let m;
  while ((m = re.exec(changelogText))) {
    const [, filename, version, modifiedAt] = m;
    if (!(filename in records)) {
      records[filename] = { version: Number(version), modifiedAt: modifiedAt ? Number(modifiedAt) : null };
    }
  }
  return records;
}

// Fetches and parses a tag's published changelog. Returns {} if it doesn't
// exist yet (nothing published = nothing to compare against, not an error).
export async function fetchFileRecords(tag) {
  const token = getToken();
  if (!token) return {};
  const existing = await getFile(changelogPath(tag), token);
  return existing ? parseFileRecords(existing.content) : {};
}

// Fetches the full raw published changelog text for a tag — used by the
// detailed Changelog view. Returns null if nothing's published yet.
export async function fetchChangelogText(tag) {
  const token = getToken();
  if (!token) throw new Error("No GitHub token saved — add one in Manage Tags first.");
  const existing = await getFile(changelogPath(tag), token);
  return existing ? existing.content : null;
}

async function githubFetch(path, token, options = {}) {
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(options.headers || {}) },
  });
}

// `cache: "no-store"` matters more than it looks. The Contents API sits
// behind a cache that can serve a blob sha a few seconds out of date, and
// a conditional revalidation would happily hand back the very sha that
// just lost a write — turning the conflict retry below into a no-op.
async function getFile(path, token) {
  const res = await githubFetch(`${path}?ref=${BRANCH}`, token, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return { sha: data.sha, content: fromBase64(data.content) };
}

async function putFile(path, content, message, sha, token) {
  const res = await githubFetch(path, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: toBase64(content), branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) {
    const err = new Error(`GitHub publish failed (${res.status}): ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Returns the entry text that was published, so the caller can cache it
// for display without another round trip.
//
// The Contents API is optimistically concurrent: a write carries the sha
// the writer believes the file is at, and GitHub rejects it if the file
// has moved on. That check is the only thing stopping this app from
// clobbering a changelog entry written by another tab, another device or
// a person editing on github.com, so it is never bypassed — no blind
// retry, no write without a sha, no force.
//
// Losing the race is recoverable: re-read the file, prepend this entry to
// whatever is there NOW, and write again. The other party's entry is
// preserved below ours.
//
// Three things make that reliable which the first version got wrong:
//
//   - Reads bypass the cache (see getFile). Without that, a re-read can
//     return the stale sha that just lost, and the retry re-loses.
//   - Attempts are spaced. GitHub needs a moment to become consistent
//     after someone else's write; retrying inside the same millisecond
//     burns every attempt against the same stale read.
//   - 422 counts as a conflict too. GitHub answers a sha mismatch with
//     409 or 422 depending on the path taken, and treating 422 as fatal
//     meant the common case never retried at all.
const CONFLICT_STATUSES = new Set([409, 422]);
const RETRY_DELAYS_MS = [250, 750, 1500, 3000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Our entry is prepended, so if it is already at the top of the remote
// file this publish has already landed. That happens when a write
// succeeds but its response never arrives; without this check the retry
// would prepend the same entry a second time.
function alreadyPublished(content, entry) {
  return typeof content === "string" && content.trimStart().startsWith(entry.trim());
}

export async function publishChangelog(tag, fileVersionChanges, { sleep = wait } = {}) {
  const token = getToken();
  if (!token) throw new Error("No GitHub token saved — add one in Manage Tags first.");
  const path = changelogPath(tag);
  const entry = buildEntry(tag, fileVersionChanges);

  let lastConflict = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    // Always reconcile against the file as it is right now, never against
    // what it looked like before the conflict.
    const existing = await getFile(path, token);
    if (existing && alreadyPublished(existing.content, entry)) return entry;

    const nextContent = existing ? `${entry}\n\n---\n\n${existing.content}` : `${entry}\n`;
    try {
      await putFile(path, nextContent, `Update ${tag} changelog`, existing?.sha, token);
      return entry;
    } catch (e) {
      if (!CONFLICT_STATUSES.has(e.status)) throw e;
      lastConflict = e;
    }
  }

  const error = new Error(
    `Couldn't publish the "${tag}" changelog: GitHub reported the file changed underneath us ` +
      `${RETRY_DELAYS_MS.length + 1} times in a row. Nothing was overwritten. ` +
      `The generated files are unaffected — try publishing again, or check whether something else is writing to ${path}.`
  );
  error.status = lastConflict?.status;
  error.cause = lastConflict;
  throw error;
}
