/* ------------------------------------------------------------------ *
 * RFC 4180 CSV reader.
 *
 * AFAIK session exports carry the whole conversation in one
 * ChatTranscript cell: quoted, multi-line, full of commas, semicolons,
 * Markdown tables and doubled quotes. A split-on-newline reader would
 * shred it, so this is a small state machine over the whole text.
 *
 * Values are returned exactly as written — no trimming, no type
 * coercion. The import layer is the raw record of what was exported;
 * interpretation happens later and never writes back here.
 * ------------------------------------------------------------------ */

const CANDIDATE_DELIMITERS = [",", ";", "\t"];

/* The delimiter is chosen from the header record only. Data rows are a
 * poor signal: a transcript cell alone can hold more semicolons than
 * the file has columns. */
export function detectDelimiter(text) {
  const counts = new Map(CANDIDATE_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  let best = ",";
  for (const [d, n] of counts) if (n > counts.get(best)) best = d;
  return best;
}

/**
 * @returns {{ rows: string[][], errors: string[] }}
 *   rows    every non-blank record, as arrays of cell strings
 *   errors  structural problems found; content is still returned
 */
export function parseCsv(input, { delimiter } = {}) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const rows = [];
  const errors = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quotedStartLine = 0;
  let line = 1;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    // A blank line is not a record. A record of empty cells is one.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field === "") { inQuotes = true; quotedStartLine = line; }
      else field += ch; // a stray quote mid-field is data, kept as written
    } else if (ch === sep) {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      line++;
      endRow();
    } else if (ch === "\n") {
      line++;
      endRow();
    } else {
      field += ch;
    }
  }

  if (inQuotes) errors.push(`Unterminated quoted field starting on line ${quotedStartLine}; kept its text up to the end of the file.`);
  if (field !== "" || row.length > 0) endRow();
  return { rows, errors };
}
