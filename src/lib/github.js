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
    for (const c of fv.changes) {
      s += `${c.label}\n`;
      for (const a of c.added) s += `* ${a.label} (New)\n`;
      for (const r of c.removed) s += `* ${r.label} (Removed)\n`;
    }
    s += `\n`;
  }
  return s.trim();
}

async function githubFetch(path, token, options = {}) {
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(options.headers || {}) },
  });
}

async function getFile(path, token) {
  const res = await githubFetch(`${path}?ref=${BRANCH}`, token);
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
  if (!res.ok) throw new Error(`GitHub publish failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Returns the entry text that was published, so the caller can cache it
// for display without another round trip.
export async function publishChangelog(tag, fileVersionChanges) {
  const token = getToken();
  if (!token) throw new Error("No GitHub token saved — add one in Manage Tags first.");
  const path = changelogPath(tag);
  const existing = await getFile(path, token);
  const entry = buildEntry(tag, fileVersionChanges);
  const nextContent = existing ? `${entry}\n\n---\n\n${existing.content}` : `${entry}\n`;
  await putFile(path, nextContent, `Update ${tag} changelog`, existing?.sha, token);
  return entry;
}
