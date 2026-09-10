/* ------------------------------------------------------------------ *
 * Hashing and byte measurement, shared by the snapshot registry and
 * the benchmark exporter.
 *
 * Its own module so the registry and the exporter can both use it
 * without importing each other — the exporter needs the registry to
 * know which snapshot is active, and the registry would otherwise need
 * the exporter for this.
 *
 * WebCrypto rather than node:crypto so one implementation runs in both
 * front-ends: present in every browser on a secure context, and in
 * Node >= 18.
 * ------------------------------------------------------------------ */

export async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const byteLength = (text) => new TextEncoder().encode(text).length;
