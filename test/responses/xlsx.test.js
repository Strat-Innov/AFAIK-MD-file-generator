import { describe, it, expect } from "vitest";
import { readXlsx } from "../../src/lib/responses/xlsx.js";
import { HEADERS, ROWS, buildWorkbook } from "./fixtures.js";

describe("XLSX reader", () => {
  it("reads the first worksheet through the workbook relationship", async () => {
    const { rows, sheetName } = await readXlsx(await buildWorkbook([HEADERS, ...ROWS]));
    expect(sheetName).toBe("Sessions");
    expect(rows[0]).toEqual(HEADERS);
    // Trailing empty cells are not materialised; compare the filled prefix.
    for (const [i, r] of ROWS.entries()) {
      const got = rows[i + 1];
      expect(got.concat(Array(r.length - got.length).fill(""))).toEqual(r);
    }
  });

  it("keeps a multi-line transcript cell exactly", async () => {
    const { rows } = await readXlsx(await buildWorkbook([HEADERS, ...ROWS]));
    expect(rows[1][6]).toBe(ROWS[0][6]);
  });

  it("places cells by reference across gaps", async () => {
    const { rows } = await readXlsx(await buildWorkbook([["a", "b", "c"], ["1", "", "3"]]));
    expect(rows[1]).toEqual(["1", "", "3"]);
  });

  it("reads a namespace-prefixed worksheet", async () => {
    const { rows } = await readXlsx(await buildWorkbook([["a", "b"], ["x", "y"]], { prefix: "x" }));
    expect(rows).toEqual([["a", "b"], ["x", "y"]]);
  });

  it("rejects something that is not a ZIP", async () => {
    await expect(readXlsx(new TextEncoder().encode("SessionId,Channel").buffer)).rejects.toThrow(/Not a valid \.xlsx/);
  });
});

