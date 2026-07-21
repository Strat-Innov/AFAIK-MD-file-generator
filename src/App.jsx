import React, { useState, useCallback, useRef, useEffect } from "react";
import { Upload, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import Sidebar from "./components/Sidebar";
import BucketView from "./components/BucketView";
import TagManager from "./components/TagManager";
import GithubSettings from "./components/GithubSettings";
import { getTags } from "./lib/tags";
import { rememberTag, forgetTag } from "./lib/memory";
import { routeFile, UNSORTED } from "./lib/router";
import { getSnapshot, setSnapshot, diffNames } from "./lib/snapshot";
import { checkFileVersion, commitFileVersion } from "./lib/fileVersions";
import { publishChangelog } from "./lib/github";
import { runExclusive } from "./lib/publishQueue";

/* ------------------------------------------------------------------ *
 * Transform rules — reverse-engineered from JUNE_13_Master_File.md
 * (verified consistent across all 121 sections):
 *   per .aspx: raw fence + ContentTypeId + PageLayoutType +
 *   CanvasContent1 decoded exactly ONE html-entity pass.
 * ------------------------------------------------------------------ */

function decodeOnce(s) {
  if (!s) return "";
  const ta = document.createElement("textarea");
  ta.innerHTML = s;
  return ta.value;
}

function extractTag(raw, tag) {
  const m = raw.match(new RegExp(`<mso:${tag}[^>]*>([\\s\\S]*?)</mso:${tag}>`));
  return m ? m[1] : "";
}

function buildSection(name, path, raw) {
  const ctid = extractTag(raw, "ContentTypeId");
  const layout = extractTag(raw, "PageLayoutType");
  const canvas = decodeOnce(extractTag(raw, "CanvasContent1"));
  return (
    `\n---\n## ${name}\n` +
    `Path: ${path}\n` +
    `Type: aspx-web-file\n` +
    `---\n` +
    "```aspx\n" + raw + "\n```\n" +
    `### Project Specifications\n\n` +
    `### Content Overview\n\n` +
    `${ctid}\n${layout}\n${canvas}\n`
  );
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${p(d.getFullYear())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function buildMaster(bucketName, files) {
  const sorted = [...files].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  let md =
    `# ${bucketName} — ASPx Codebase Master File\n` +
    `Generated on: ${stamp()}\n` +
    `Total Files: ${sorted.length}\n\n` +
    `## Table of Contents\n` +
    sorted.map((f) => `* [${f.name}](__#)`).join("\n") +
    `\n`;
  for (const f of sorted) md += buildSection(f.name, f.path, f.raw);
  return md;
}

/* ---- ZIP reading via native DecompressionStream (no dependency) ---- */
async function inflateRaw(u8) {
  const ds = new DecompressionStream("deflate-raw");
  const ab = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

async function readZip(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, lho });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const out = [];
  for (const e of entries) {
    if (e.name.endsWith("/") || !e.name.toLowerCase().endsWith(".aspx")) continue;
    if (dv.getUint32(e.lho, true) !== 0x04034b50) continue;
    const nLen = dv.getUint16(e.lho + 26, true);
    const xLen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nLen + xLen;
    const comp = u8.subarray(start, start + e.compSize);
    let bytes;
    if (e.method === 0) bytes = comp;
    else if (e.method === 8) bytes = await inflateRaw(comp);
    else continue;
    const raw = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    out.push({ name: e.name.split("/").pop(), path: e.name, raw });
  }
  return out;
}

async function collectFiles(fileList) {
  const collected = [];
  for (const f of fileList) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const buf = await f.arrayBuffer();
      collected.push(...(await readZip(buf)));
    } else if (lower.endsWith(".aspx")) {
      const raw = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await f.arrayBuffer());
      collected.push({ name: f.name, path: f.name, raw }); // loose drop, no folder
    }
  }
  return collected;
}

/* ================================================================== */
export default function App() {
  const [tags, setTags] = useState(() => getTags());
  const [selected, setSelected] = useState(() => getTags()[0]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | done | error
  const [error, setError] = useState("");
  const [buckets, setBuckets] = useState({}); // { [bucket]: files[] }  — session-only, never persisted
  const [mds, setMds] = useState({}); // { [bucket]: md string }       — session-only, never persisted
  const [latestEntries, setLatestEntries] = useState(() => {
    const map = {};
    for (const t of getTags()) {
      const snap = getSnapshot(t);
      if (snap?.latestEntry) map[t] = snap.latestEntry;
    }
    return map;
  });
  const inputRef = useRef(null);

  // Mirrors `buckets` synchronously so handlers can compute the next state
  // in one shot (needed to know exactly which bucket file-lists to check
  // for a changelog-worthy diff) without depending on stale closures.
  const bucketsRef = useRef({});
  useEffect(() => { bucketsRef.current = buckets; }, [buckets]);

  // Publishing to GitHub is secondary to actually getting the generated
  // file — same lesson as the localStorage quota bug: a network/token
  // failure here must surface as a visible warning, never block or
  // overwrite the primary "done" result.
  //
  // The whole read-diff-publish-commit sequence is serialized per tag
  // (runExclusive) — not just the network call — because two overlapping
  // calls for the same tag would otherwise both read the same "before"
  // state, both compute a diff against it, and race on GitHub's sha check
  // (409) and on which one's local commit wins.
  const publishIfChanged = useCallback((tag, files) => {
    if (tag === UNSORTED) return;
    runExclusive(tag, async () => {
      const currentNames = files.map((f) => f.name).sort((a, b) => a.localeCompare(b));
      const prevSnap = getSnapshot(tag);
      const { added, removed } = diffNames(prevSnap ? prevSnap.names : [], currentNames);

      // Per-file content diffing (People/Quick Links/etc.) is independent of
      // whether the bucket's filename set changed — a file can be edited
      // without the bucket gaining or losing any files.
      const fileVersionChanges = [];
      for (const f of files) {
        const result = checkFileVersion(f.name, f.raw);
        if (result) fileVersionChanges.push({ filename: f.name, ...result });
      }

      const bucketFilenamesChanged = !prevSnap || added.length > 0 || removed.length > 0;
      if (!bucketFilenamesChanged && fileVersionChanges.length === 0) return; // truly nothing to report

      try {
        const entry = await publishChangelog(tag, added, removed, fileVersionChanges);
        setSnapshot(tag, { names: currentNames, latestEntry: entry });
        for (const fv of fileVersionChanges) commitFileVersion(fv.filename, fv.version, fv.parts);
        setLatestEntries((prevEntries) => ({ ...prevEntries, [tag]: entry }));
      } catch (e) {
        setError(`Couldn't publish "${tag}" changelog to GitHub: ${e.message}`);
      }
    });
  }, []);

  // One-time cleanup: the old per-entry history store (deprecated — it's
  // what used to overflow the localStorage quota) is no longer read or
  // written anywhere. Reclaim the space if it's still sitting there.
  useEffect(() => {
    localStorage.removeItem("afaik-history-v1");
  }, []);

  const handleFiles = useCallback(async (fileList) => {
    setStatus("working"); setError("");
    try {
      const files = await collectFiles(fileList);
      if (files.length === 0) throw new Error("No .aspx files found in that drop (looked inside .zip too).");

      const currentTags = getTags();
      // Dropping while a real tag tab is open forces every file into that
      // tag and teaches the memory — an explicit placement always wins over
      // auto-detection. Dropping from Unsorted (or any non-tag view) still
      // auto-routes by folder/memory, since there's no explicit target.
      const forcedBucket = currentTags.includes(selected) ? selected : null;

      const newByBucket = {};
      for (const f of files) {
        const bucket = forcedBucket ?? routeFile(f, currentTags);
        if (forcedBucket) rememberTag(f.name, forcedBucket);
        (newByBucket[bucket] ??= []).push(f);
      }

      const prevBuckets = bucketsRef.current;
      const nextBuckets = { ...prevBuckets };
      const touchedMd = {};
      for (const [bucket, added] of Object.entries(newByBucket)) {
        nextBuckets[bucket] = [...(prevBuckets[bucket] || []), ...added];
        touchedMd[bucket] = buildMaster(bucket, nextBuckets[bucket]);
      }
      bucketsRef.current = nextBuckets;
      setBuckets(nextBuckets);
      setMds((prevMd) => ({ ...prevMd, ...touchedMd }));
      setStatus("done");

      for (const bucket of Object.keys(newByBucket)) publishIfChanged(bucket, nextBuckets[bucket]);
    } catch (e) {
      setError(e.message || String(e));
      setStatus("error");
    }
  }, [selected, publishIfChanged]);

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const reassign = (file, targetTag) => {
    rememberTag(file.name, targetTag);
    const prev = bucketsRef.current;
    const next = { ...prev };
    next[UNSORTED] = (prev[UNSORTED] || []).filter((f) => !(f.name === file.name && f.path === file.path));
    next[targetTag] = [...(prev[targetTag] || []), file];
    bucketsRef.current = next;
    setBuckets(next);
    setMds((prevMd) => ({
      ...prevMd,
      [UNSORTED]: buildMaster(UNSORTED, next[UNSORTED]),
      [targetTag]: buildMaster(targetTag, next[targetTag]),
    }));
    publishIfChanged(targetTag, next[targetTag]);
  };

  // Correcting a wrong auto-sort: send the file back to Unsorted and forget
  // its remembered tag, so it doesn't repeat the same mistake next time.
  const unsort = (file, fromBucket) => {
    forgetTag(file.name);
    const prev = bucketsRef.current;
    const next = { ...prev };
    next[fromBucket] = (prev[fromBucket] || []).filter((f) => !(f.name === file.name && f.path === file.path));
    next[UNSORTED] = [...(prev[UNSORTED] || []), file];
    bucketsRef.current = next;
    setBuckets(next);
    setMds((prevMd) => ({
      ...prevMd,
      [fromBucket]: buildMaster(fromBucket, next[fromBucket]),
      [UNSORTED]: buildMaster(UNSORTED, next[UNSORTED]),
    }));
    publishIfChanged(fromBucket, next[fromBucket]);
  };

  // Keep session bucket state consistent with tag edits: renames carry the
  // bucket's files forward under the new name; removals send them to Unsorted.
  const syncTags = () => setTags(getTags());

  const onTagRenamed = (oldName, newName) => {
    const prev = bucketsRef.current;
    if (oldName in prev) {
      const next = { ...prev, [newName]: prev[oldName] };
      delete next[oldName];
      bucketsRef.current = next;
      setBuckets(next);
      setMds((prevMd) => {
        const nextMd = { ...prevMd, [newName]: prevMd[oldName] };
        delete nextMd[oldName];
        return nextMd;
      });
    }
    setSelected((sel) => (sel === oldName ? newName : sel));
    syncTags();
  };

  const onTagRemoved = (name) => {
    const prev = bucketsRef.current;
    if (name in prev) {
      const merged = [...(prev[UNSORTED] || []), ...prev[name]];
      const next = { ...prev, [UNSORTED]: merged };
      delete next[name];
      bucketsRef.current = next;
      setBuckets(next);
      setMds((prevMd) => {
        const nextMd = { ...prevMd, [UNSORTED]: buildMaster(UNSORTED, merged) };
        delete nextMd[name];
        return nextMd;
      });
    }
    setSelected((sel) => (sel === name ? UNSORTED : sel));
    syncTags();
  };

  const onTagAdded = () => syncTags();

  const activeBucket = selected === "ManageTags" ? null : selected;

  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex">
      <Sidebar tags={tags} selected={selected} onSelect={setSelected} counts={counts} />

      <main className="flex-1 px-6 py-6 max-w-3xl">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={
            "rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors mb-4 " +
            (dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-white hover:bg-slate-50")
          }
        >
          <Upload className="h-6 w-6 mx-auto text-slate-400 mb-1" />
          <div className="text-sm font-medium text-slate-700">
            Drop .aspx files or a .zip here — {tags.includes(selected) ? `goes straight into "${selected}"` : "auto-sorts by folder/memory"}
          </div>
          <input
            ref={inputRef} type="file" multiple accept=".aspx,.zip" className="hidden"
            onChange={(e) => e.target.files.length && handleFiles(e.target.files)}
          />
        </div>

        {status === "working" && (
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Unpacking, sorting, and converting…
          </div>
        )}
        {status === "done" && (
          <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Sorted into the buckets on the left.
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {selected === "ManageTags" && (
          <>
            <GithubSettings />
            <TagManager tags={tags} onRename={onTagRenamed} onRemove={onTagRemoved} onAdd={onTagAdded} />
          </>
        )}
        {activeBucket && (
          <BucketView
            bucket={activeBucket}
            files={buckets[activeBucket]}
            md={mds[activeBucket]}
            tags={tags}
            onReassign={reassign}
            onUnsort={(file) => unsort(file, activeBucket)}
            latestChangelogEntry={latestEntries[activeBucket]}
          />
        )}
      </main>
    </div>
  );
}
