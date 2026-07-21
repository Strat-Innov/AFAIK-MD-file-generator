/* ------------------------------------------------------------------ *
 * Changelog — a single rotating plain-text file. Deliberately stores
 * no file content, only short lines ("tag: count"), grouped under
 * "## Month Year" headers, so a full year of activity stays a few KB.
 * At year end (an entry exists from a prior calendar year), the app
 * prompts to export; clearLog() is only ever called after that export
 * has been triggered.
 * ------------------------------------------------------------------ */

const KEY = "afaik-changelog-log-v1";

function monthHeader(d) {
  return `## ${d.toLocaleString(undefined, { month: "long", year: "numeric" })}`;
}

function readLog() {
  return localStorage.getItem(KEY) || "";
}

function writeLog(text) {
  localStorage.setItem(KEY, text); // quota errors throw — a text-only log of this size should never hit it
}

export function getLogText() {
  return readLog();
}

export function appendEntry(tag, count, when = new Date()) {
  const header = monthHeader(when);
  const stamp = when.toLocaleString(undefined, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const line = `- ${stamp} — ${tag}: ${count} file${count !== 1 ? "s" : ""}`;
  const current = readLog();
  const lastHeaderLine = [...current.split("\n")].reverse().find((l) => l.startsWith("## "));
  writeLog(lastHeaderLine === header ? `${current}\n${line}` : `${current}${current ? "\n\n" : ""}${header}\n${line}`);
}

function yearsPresent(text) {
  const years = new Set();
  for (const m of text.matchAll(/## .*\b(\d{4})\b/g)) years.add(Number(m[1]));
  return years;
}

export function needsYearEndReminder(now = new Date()) {
  const currentYear = now.getFullYear();
  for (const y of yearsPresent(readLog())) if (y < currentYear) return true;
  return false;
}

export function exportLog() {
  const text = readLog();
  if (!text) throw new Error("Changelog is empty — nothing to export.");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AFAIK_Changelog_${new Date().getFullYear()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clearLog() {
  localStorage.removeItem(KEY);
}
