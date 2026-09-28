import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter } from "../../src/lib/responses/csv.js";
import { HEADERS, ROWS, toCsv, MULTI_QUESTION_TRANSCRIPT } from "./fixtures.js";

describe("CSV reader", () => {
  it("round-trips a multi-line, quoted transcript cell exactly", () => {
    const { rows, errors } = parseCsv(toCsv(ROWS));
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual(HEADERS);
    expect(rows.slice(1)).toEqual(ROWS);
    expect(rows[1][6]).toBe(MULTI_QUESTION_TRANSCRIPT);
  });

  it("handles LF, CRLF and a missing trailing newline alike", () => {
    const lf = parseCsv(toCsv(ROWS, HEADERS, "\n")).rows;
    const crlf = parseCsv(toCsv(ROWS)).rows;
    const noTail = parseCsv(toCsv(ROWS).replace(/\r\n$/, "")).rows;
    expect(lf).toEqual(crlf);
    expect(noTail).toEqual(crlf);
  });

  it("strips a UTF-8 byte-order mark from the first header only", () => {
    const { rows } = parseCsv("﻿SessionId,Channel\r\nx,msteams\r\n");
    expect(rows[0][0]).toBe("SessionId");
  });

  it("does not trim or coerce values", () => {
    const { rows } = parseCsv('a,b,c\r\n  padded  ,007,"TRUE"\r\n');
    expect(rows[1]).toEqual(["  padded  ", "007", "TRUE"]);
  });

  it("keeps empty cells and skips blank lines", () => {
    const { rows } = parseCsv("a,b,c\r\n\r\n,,\r\n1,,3\r\n");
    expect(rows).toEqual([["a", "b", "c"], ["", "", ""], ["1", "", "3"]]);
  });

  it("reports an unterminated quote but keeps the text", () => {
    const { rows, errors } = parseCsv('a,b\r\n1,"never closed\r\nstill here');
    expect(errors).toHaveLength(1);
    expect(rows[1][1]).toBe("never closed\r\nstill here");
  });

  it("detects the delimiter from the header, not from transcript semicolons", () => {
    expect(detectDelimiter(toCsv(ROWS))).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
  });
});
