/* ------------------------------------------------------------------ *
 * Handing a generated file to the browser.
 *
 * Shared because more than one panel offers downloads, and the details
 * below are the kind that fail silently and identically everywhere they
 * are re-implemented.
 * ------------------------------------------------------------------ */

/**
 * Save `blob` under `filename`.
 *
 * The anchor is attached before it is clicked, and the object URL is
 * revoked on a later tick rather than in the same statement. A detached
 * anchor is ignored outside Chromium, and revoking synchronously can
 * cancel a download that has not started reading the blob yet — either
 * one produces the same symptom: a click that does nothing at all.
 */
export function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const saveText = (filename, text, type = "text/markdown") =>
  saveBlob(filename, new Blob([text], { type }));

export const sizeLabel = (bytes) =>
  bytes >= 1e6 ? (bytes / 1e6).toFixed(2) + " MB" : (bytes / 1e3).toFixed(1) + " KB";
