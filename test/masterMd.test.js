import { describe, it, expect } from "vitest";
import { buildMaster, buildSection, extractTag, decodeOnce, stamp } from "../src/lib/masterMd.js";
import { readFixture, REAL_PAGES, HAS_REAL_PAGES } from "./helpers.js";

/* The RAW/MASTER representation is the fidelity layer. These tests exist
   to make a regression in it impossible to land quietly. */

describe.skipIf(!HAS_REAL_PAGES)("raw fidelity", () => {
  for (const name of REAL_PAGES) {
    it(`${name}: the source appears byte-for-byte inside the fence`, () => {
      const raw = readFixture(name);
      const md = buildSection(name, `input/${name}`, raw);
      expect(md).toContain("```aspx\n" + raw + "\n```");
    });

    it(`${name}: the fence round-trips back to the exact source`, () => {
      const raw = readFixture(name);
      const md = buildSection(name, name, raw);
      const start = md.indexOf("```aspx\n") + "```aspx\n".length;
      const end = md.indexOf("\n```", start);
      expect(md.slice(start, end)).toBe(raw);
    });

    it(`${name}: contains no fence delimiter that would break the block`, () => {
      expect(readFixture(name)).not.toContain("```");
    });
  }
});

describe("master file format", () => {
  const file = (name, raw) => ({ name, path: name, raw });
  const at = new Date(2026, 5, 13, 9, 4, 5);

  it("emits the established header, ToC and per-file section shape", () => {
    const md = buildMaster("PROJECT PLAYBOOK", [file("b.aspx", "<x/>"), file("A.aspx", "<y/>")], at);
    expect(md).toBe(
      "# PROJECT PLAYBOOK — ASPx Codebase Master File\n" +
        "Generated on: 06/13/2026 09:04:05\n" +
        "Total Files: 2\n\n" +
        "## Table of Contents\n" +
        "* [A.aspx](__#)\n* [b.aspx](__#)\n" +
        "\n---\n## A.aspx\nPath: A.aspx\nType: aspx-web-file\n---\n```aspx\n<y/>\n```\n" +
        "### Project Specifications\n\n### Content Overview\n\n\n\n\n" +
        "\n---\n## b.aspx\nPath: b.aspx\nType: aspx-web-file\n---\n```aspx\n<x/>\n```\n" +
        "### Project Specifications\n\n### Content Overview\n\n\n\n\n"
    );
  });

  it("sorts case-insensitively", () => {
    const md = buildMaster("T", [file("zeta.aspx", ""), file("Alpha.aspx", "")], at);
    expect(md.indexOf("Alpha.aspx")).toBeLessThan(md.indexOf("zeta.aspx"));
  });

  it("stamps MM/DD/YYYY HH:MM:SS", () => {
    expect(stamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("01/02/2026 03:04:05");
  });
});

describe("primitives", () => {
  it("extractTag returns the empty string for an absent tag", () => {
    expect(extractTag("<html/>", "CanvasContent1")).toBe("");
  });

  it("decodeOnce resolves exactly one entity pass", () => {
    expect(decodeOnce("&amp;quot;")).toBe("&quot;");
    expect(decodeOnce("&lt;div&gt;")).toBe("<div>");
  });

  it("decodeOnce resolves named entities beyond the six webparts.js knows", () => {
    expect(decodeOnce("Caf&eacute; &mdash; caf&#233;")).toBe("Café — café");
  });
});
