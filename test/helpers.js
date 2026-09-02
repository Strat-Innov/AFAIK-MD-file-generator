import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export const REAL_PAGES = ["FORTUNE-HILL.aspx", "THE-SIGNATURE.aspx", "STUDIO-CITY.aspx"];

// The real exports are gitignored — they carry employee names, work
// emails and internal tenant URLs, and this repo is public. Suites that
// need them skip rather than fail when they are absent. See README.md
// in this directory.
export const HAS_REAL_PAGES = REAL_PAGES.every((n) => fs.existsSync(path.join(dir, n)));

export function readFixture(name) {
  return fs.readFileSync(path.join(dir, name), "utf8");
}

/* ---- synthetic canvas builders ----
   Real exported pages keep their web part JSON entity-encoded inside the
   attribute even after CanvasContent1's single decode pass (the HTML
   parser resolves it on getAttribute). These builders reproduce that
   encoding exactly, so a synthetic fixture exercises the same code path
   as a real file. */

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textControl(innerHtml, position = {}) {
  const cd = escapeHtml(JSON.stringify({ controlType: 4, position: { zoneIndex: 1, sectionIndex: 1, controlIndex: 1, ...position } }));
  return `<div data-sp-canvascontrol="" data-sp-controldata="${cd}"><div data-sp-rte="">${innerHtml}</div></div>`;
}

export function webPartControl(blob, position = {}) {
  const cd = escapeHtml(JSON.stringify({ controlType: 3, position: { zoneIndex: 1, sectionIndex: 1, controlIndex: 1, ...position } }));
  const wp = escapeHtml(JSON.stringify(blob));
  return `<div data-sp-canvascontrol="" data-sp-controldata="${cd}"><div data-sp-webpart="" data-sp-webpartdata="${wp}"></div></div>`;
}

export function makeAspx(canvasHtml, extraTags = {}) {
  const tags = { ContentTypeId: "0x0101", PageLayoutType: "Article", ...extraTags };
  const props = Object.entries(tags)
    .map(([k, v]) => `<mso:${k} msdt:dt="string">${escapeHtml(v)}</mso:${k}>`)
    .join("\n");
  return `<html><head><!--[if gte mso 9]><xml>\n<mso:CustomDocumentProperties>\n${props}\n<mso:CanvasContent1 msdt:dt="string">${escapeHtml(canvasHtml)}</mso:CanvasContent1>\n</mso:CustomDocumentProperties>\n</xml><![endif]--></head><body></body></html>`;
}

/* ---- the August 2026 regression corpus (gitignored, see test/corpus/README.md) ---- */

const corpusDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");

export function corpusFiles() {
  if (!fs.existsSync(corpusDir)) return [];
  return fs.readdirSync(corpusDir).filter((f) => f.endsWith(".aspx")).sort();
}

export function readCorpus(name) {
  return fs.readFileSync(path.join(corpusDir, name), "utf8");
}

export const HAS_CORPUS = corpusFiles().length > 0;
