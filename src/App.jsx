import React, { useState, useCallback, useRef } from "react";
import { Upload, FileCode, Download, Loader2, AlertCircle, CheckCircle2, List, FolderTree } from "lucide-react";
import Changelog from "./components/Changelog";
import { addEntry } from "./lib/history";

/* ------------------------------------------------------------------ *
 * Transform rules — reverse-engineered from JUNE_13_Master_File.md
 * (verified consistent across all 121 sections):
 *   per .aspx: raw fence + ContentTypeId + PageLayoutType +
 *   CanvasContent1 decoded exactly ONE html-entity pass.
 * ------------------------------------------------------------------ */

// One-pass HTML entity decode (matches the sample: inner &#123;/&quot; stay encoded)
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

/* ---- Bucketing: group files by their top-level folder ----
 * "TOWNSHIP PAGES/foo.aspx"            -> bucket "TOWNSHIP PAGES"
 * "TOWNSHIP PAGES/sub/foo.aspx"        -> bucket "TOWNSHIP PAGES" (nested folders collapse to the top-level parent)
 * "foo.aspx" (no folder, loose drop)   -> bucket "Uncategorized"
 * ------------------------------------------------------------ */
function bucketOf(path) {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : "Uncategorized";
}

function buildMaster(bucketName, files) {
  // files: [{name, path, raw}] — sort case-insensitively by name to match sample order
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

function buildBuckets(files) {
  const map = new Map();
  for (const f of files) {
    const bucket = bucketOf(f.path);
    if (!map.has(bucket)) map.set(bucket, []);
    map.get(bucket).push(f);
  }
  // alphabetical, but "Uncategorized" always sinks to the end
  const bucketNames = [...map.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
  return bucketNames.map((bucket) => {
    const bucketFiles = map.get(bucket);
    const names = bucketFiles.map((f) => f.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return { bucket, count: bucketFiles.length, names, md: buildMaster(bucket, bucketFiles) };
  });
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
  // locate End Of Central Directory (sig 0x06054b50)
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
      collected.push({ name: f.name, path: f.name, raw }); // loose drop, no folder -> Uncategorized
    }
  }
  return collected;
}

/* ================================================================== */
function autoTitle(bucket, count) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${bucket} — ${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} (${count} file${count !== 1 ? "s" : ""})`;
}

function downloadMd(filenameBase, md) {
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase.replace(/[^\w.-]+/g, "_")}_Master_File.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function bucketSizeLabel(md) {
  const bytes = new Blob([md]).size;
  return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
}

export default function App() {
  const [view, setView] = useState("generator"); // generator | changelog
  const [historyKey, setHistoryKey] = useState(0); // bump to force Changelog to re-read localStorage
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | done | error
  const [error, setError] = useState("");
  const [buckets, setBuckets] = useState(null); // [{bucket, count, names, md}]
  const inputRef = useRef(null);

  const handleFiles = useCallback(async (fileList) => {
    setStatus("working"); setError(""); setBuckets(null);
    try {
      const files = await collectFiles(fileList);
      if (files.length === 0) throw new Error("No .aspx files found in that drop (looked inside .zip too).");
      const built = buildBuckets(files);
      for (const b of built) {
        addEntry({ title: autoTitle(b.bucket, b.count), count: b.count, names: b.names, md: b.md });
      }
      setHistoryKey((k) => k + 1);
      setBuckets(built);
      setStatus("done");
    } catch (e) {
      setError(e.message || String(e));
      setStatus("error");
    }
  }, []);

  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-3xl px-5 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-emerald-500 flex items-center justify-center">
            <FileCode className="h-5 w-5 text-slate-900" />
          </div>
          <div className="leading-tight flex-1">
            <div className="text-sm font-semibold tracking-wide">ASPx → Markdown Master File</div>
            <div className="text-xs text-slate-400">Drop .aspx files or a .zip — sorted into one .md per folder</div>
          </div>
          <nav className="flex items-center gap-1">
            <button
              onClick={() => setView("generator")}
              className={"rounded-md px-3 py-1.5 text-sm font-medium " + (view === "generator" ? "bg-slate-700 text-white" : "text-slate-300 hover:text-white")}
            >
              Generator
            </button>
            <button
              onClick={() => setView("changelog")}
              className={"inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium " + (view === "changelog" ? "bg-slate-700 text-white" : "text-slate-300 hover:text-white")}
            >
              <List className="h-3.5 w-3.5" /> Changelog
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">
        {view === "changelog" ? (
          <Changelog refreshKey={historyKey} onChanged={() => setHistoryKey((k) => k + 1)} />
        ) : (
        <>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={
            "rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors " +
            (dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-300 bg-white hover:bg-slate-50")
          }
        >
          <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
          <div className="text-sm font-medium text-slate-700">Drop .aspx files or a .zip here</div>
          <div className="text-xs text-slate-500 mt-1">
            Folders in the zip become buckets (e.g. <span className="font-mono">TOWNSHIP PAGES/</span>) — each gets its own .md. Loose files with no folder land in "Uncategorized".
          </div>
          <input
            ref={inputRef} type="file" multiple accept=".aspx,.zip" className="hidden"
            onChange={(e) => e.target.files.length && handleFiles(e.target.files)}
          />
        </div>

        {status === "working" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Unpacking, sorting, and converting…
          </div>
        )}

        {status === "error" && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {status === "done" && buckets && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="font-semibold text-slate-800">
                {buckets.reduce((n, b) => n + b.count, 0)} file{buckets.reduce((n, b) => n + b.count, 0) !== 1 ? "s" : ""} sorted into {buckets.length} bucket{buckets.length !== 1 ? "s" : ""}
              </span>
            </div>

            {buckets.map((b) => (
              <div key={b.bucket} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 p-4">
                  <div className="flex items-center gap-2 text-sm min-w-0">
                    <FolderTree className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="font-semibold text-slate-800 truncate">{b.bucket}</span>
                    <span className="text-slate-400 shrink-0">· {b.count} file{b.count !== 1 ? "s" : ""} · {bucketSizeLabel(b.md)}</span>
                  </div>
                  <button
                    onClick={() => downloadMd(b.bucket, b.md)}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-3.5 py-2 hover:bg-slate-700 shrink-0"
                  >
                    <Download className="h-4 w-4" /> Download .md
                  </button>
                </div>
                <div className="p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Included files</div>
                  <div className="max-h-24 overflow-auto rounded border border-slate-100 bg-slate-50 p-2 text-xs font-mono text-slate-600" style={{ lineHeight: "1.6" }}>
                    {b.names.map((n) => <div key={n}>{n}</div>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Note: the <span className="font-mono">Path:</span> line uses each file's path as it appeared in the drop (folder-relative, since the original absolute Windows path can't be reproduced in a browser). Each bucket is also saved to the Changelog automatically.
        </p>
        </>
        )}
      </main>
    </div>
  );
}
