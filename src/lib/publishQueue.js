/* ------------------------------------------------------------------ *
 * Serializes async work per key. Used to stop two GitHub publishes for
 * the same tag from overlapping — GitHub's Contents API rejects a
 * write if the file changed since the write's starting sha was read
 * (409), which is exactly what happens if two publishes for the same
 * tag both read the file before either has written back. Chaining
 * per-key guarantees the second call's read only happens after the
 * first call's write has fully landed.
 * ------------------------------------------------------------------ */

const queues = new Map();

export function runExclusive(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn regardless of whether the previous call succeeded or failed
  queues.set(key, next);
  return next;
}
