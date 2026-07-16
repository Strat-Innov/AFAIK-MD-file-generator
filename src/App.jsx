import React, { useState, useCallback, useRef } from "react";
import { Upload, FileCode, Download, Loader2, AlertCircle, CheckCircle2, X } from "lucide-react";

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

function buildMaster(files) {
  // files: [{name, path, raw}] — sort case-insensitively by name to match sample order
  const sorted = [...files].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  let md =
    `# ASPx Codebase Master File\n` +
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
      collected.push({ name: f.name, path: f.name, raw });
    }
  }
  return collected;
}

/* ================================================================== */
export default function App() {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | done | error
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // {md, count, names}
  const inputRef = useRef(null);

  const handleFiles = useCallback(async (fileList) => {
    setStatus("working"); setError(""); setResult(null);
    try {
      const files = await collectFiles(fileList);
      if (files.length === 0) throw new Error("No .aspx files found in that drop (looked inside .zip too).");
      const md = buildMaster(files);
      setResult({ md, count: files.length, names: files.map((f) => f.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())) });
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

  const download = () => {
    const blob = new Blob([result.md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ASPx_Master_File.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const bytes = result ? new Blob([result.md]).size : 0;
  const sizeLabel = bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-3xl px-5 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-emerald-500 flex items-center justify-center">
            <FileCode className="h-5 w-5 text-slate-900" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide">ASPx → Markdown Master File</div>
            <div className="text-xs text-slate-400">Drop .aspx files or a .zip — get one combined .md</div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">
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
          <div className="text-xs text-slate-500 mt-1">or click to browse — everything stays in your browser</div>
          <input
            ref={inputRef} type="file" multiple accept=".aspx,.zip" className="hidden"
            onChange={(e) => e.target.files.length && handleFiles(e.target.files)}
          />
        </div>

        {status === "working" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Unpacking and converting…
          </div>
        )}

        {status === "error" && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {status === "done" && result && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="font-semibold text-slate-800">{result.count} file{result.count !== 1 ? "s" : ""} converted</span>
                <span className="text-slate-400">· {sizeLabel}</span>
              </div>
              <button onClick={download} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white text-sm px-3.5 py-2 hover:bg-slate-700">
                <Download className="h-4 w-4" /> Download .md
              </button>
            </div>

            <div className="p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">Included files</div>
              <div className="max-h-32 overflow-auto rounded border border-slate-100 bg-slate-50 p-2 text-xs font-mono text-slate-600" style={{ lineHeight: "1.6" }}>
                {result.names.map((n) => <div key={n}>{n}</div>)}
              </div>
              <div className="text-xs uppercase tracking-wide text-slate-400 mt-4 mb-2">Preview</div>
              <pre className="max-h-64 overflow-auto rounded border border-slate-100 bg-slate-900 p-3 text-xs text-slate-100" style={{ whiteSpace: "pre-wrap" }}>
                {result.md.slice(0, 2500)}
                {result.md.length > 2500 ? "\n…" : ""}
              </pre>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Note: the <span className="font-mono">Path:</span> line uses each file's name (the original used an absolute Windows path that can't be reproduced in a browser).
        </p>
      </main>
    </div>
  );
}
