import { describe, it, expect } from "vitest";
import {
  terms, detectFormat, parseKnowledgeMd, indexKnowledge, scorePage, checkQuestion,
  runKnowledgeCheck, KNOWLEDGE_VERDICT, KNOWLEDGE_FORMAT, COVERED_AT, WEAK_AT,
} from "../../src/lib/responses/knowledgeCheck.js";
import { ANSWER_EVALUATION } from "../../src/lib/responses/consolidate.js";
import { makeAspx, textControl } from "../helpers.js";

/* ------------------------------------------------------------------ *
 * The Answer status column reports the transcript: the agent replied,
 * or it did not. It cannot say whether the knowledge base HELD the
 * answer, so "not answered" never distinguishes a missing page from a
 * retrieval failure — and those need opposite fixes.
 *
 * These tests pin that separation, and pin the limits of the claim: a
 * lexical match locates supporting content, it does not confirm that
 * any answer is right.
 * ------------------------------------------------------------------ */

/* The real AI-file shape: a bucket heading, then one block per page
 * ending in a Source section. The first page deliberately contains
 * both a "# " heading and a "---" rule in its own body, because real
 * pages do and both would break a naive split. */
const AI_FILE = `# NEWS AND ANNOUNCEMENT

# Harbour-Cup-Closes-At-Lakeside-Pavilion

## Harbour Cup Closes At Lakeside Pavilion

Teams Blue Herons, Copper Foxes and Reed Warblers played at the Lakeside Pavilion.
Team Reed Warblers claimed victory as overall champions of the Harbour Cup.

# A heading inside the body

---

## Source

- Source file: Harbour-Cup-Closes-At-Lakeside-Pavilion.aspx
- Page layout: Article

---

# New-Vehicle-Request-Form

## New Vehicle Request Form and Vehicle Requisition Guidelines

Submit the vehicle requisition form to the Admin department three days before travel.

## Source

- Source file: New-Vehicle-Request-Form.aspx
- Page layout: Article
`;

const index = () => indexKnowledge([{ name: "AI.md", text: AI_FILE }]);

const q = (id, text, answerEvaluation = ANSWER_EVALUATION.ANSWERED) => ({
  questionId: id, cleanQuestion: text, qaIds: ["qa-1"], answerEvaluation, notes: "",
});

describe("informative words", () => {
  it("keeps the words that identify a page and drops the ones that do not", () => {
    expect(terms("What are the winners of the Harbour Cup?")).toEqual(["winners", "harbour", "cup"]);
  });

  it("drops question openers, which otherwise match every page", () => {
    expect(terms("Please tell me how I can get this")).toEqual([]);
  });

  it("splits on punctuation the way the question grouper does", () => {
    expect(terms("1-BR price?")).toEqual(["br", "price"]);
  });
});

describe("reading a knowledge file", () => {
  it("recognises the AI file, the Master file and an ordinary document", () => {
    expect(detectFormat(AI_FILE)).toBe(KNOWLEDGE_FORMAT.AI);
    expect(detectFormat("## P.aspx\nType: aspx-web-file\n```aspx\n<html></html>\n```")).toBe(KNOWLEDGE_FORMAT.MASTER);
    expect(detectFormat("# Handbook\n\nSome policy text.")).toBe(KNOWLEDGE_FORMAT.PLAIN);
  });

  it("splits pages on the generator's own Source line, not on headings or rules", () => {
    const { pages } = parseKnowledgeMd(AI_FILE);
    expect(pages.map((p) => p.name)).toEqual([
      "Harbour-Cup-Closes-At-Lakeside-Pavilion.aspx",
      "New-Vehicle-Request-Form.aspx",
    ]);
    // The body's own "# " heading and "---" rule stayed with their page.
    expect(pages[0].text).toContain("A heading inside the body");
    expect(pages[1].text).not.toContain("Reed Warblers");
  });

  it("indexes a Master file through the app's extractor, not its raw bytes", () => {
    const raw = makeAspx(textControl("<h2>Westfield Park</h2><p>Westfield Park covers 201 hectares.</p>"));
    const master = `# B — ASPx Codebase Master File\n\n## Westfield.aspx\nPath: Westfield.aspx\nType: aspx-web-file\n---\n\`\`\`aspx\n${raw}\n\`\`\`\n`;
    const { format, pages } = parseKnowledgeMd(master);
    expect(format).toBe(KNOWLEDGE_FORMAT.MASTER);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain("201 hectares");
    // The GUIDs and attribute names of the raw source must not be indexed.
    expect(pages[0].text).not.toContain("data-sp-controldata");
  });

  it("falls back to top-level headings for an ordinary knowledge document", () => {
    const { pages } = parseKnowledgeMd("# Leave Policy\n\nFifteen days.\n\n# Travel Policy\n\nBook early.");
    expect(pages.map((p) => p.name)).toEqual(["Leave Policy", "Travel Policy"]);
  });

  it("reports a page that carries no text instead of letting it look searched", () => {
    const master = "## Broken.aspx\nType: aspx-web-file\n---\n```aspx\nnot an aspx page at all\n```";
    const idx = indexKnowledge([{ name: "M.md", text: master }]);
    expect(idx.noText).toEqual(["Broken.aspx"]);
    // Indexed as empty, so its source metadata cannot match a question.
    expect(idx.pages[0].termCount.size).toBe(0);
  });
});

describe("scoring a question against a page", () => {
  it("reports which words were found and which were not", () => {
    const idx = index();
    const page = idx.pages.find((p) => p.name.startsWith("Harbour"));
    const r = scorePage(["reed", "warblers", "parking"], page, idx.idf);
    expect(r.matched).toEqual(["reed", "warblers"]);
    expect(r.missing).toEqual(["parking"]);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });

  it("is 1 when every informative word is on the page", () => {
    const idx = index();
    const page = idx.pages.find((p) => p.name.startsWith("Harbour"));
    expect(scorePage(["reed", "warblers"], page, idx.idf).score).toBe(1);
  });

  it("picks the page the question is actually about", () => {
    const r = checkQuestion(q("Q-001", "How do I submit the vehicle requisition form?"), index());
    expect(r.pageName).toBe("New-Vehicle-Request-Form.aspx");
  });

  /* Ties are the normal case, not a curiosity: ask about a form and
   * every page that mentions it scores 1.0. Naming whichever happened to
   * come first shows the reader evidence they can see is wrong. */
  it("breaks a tie towards the page whose own title carries the words", () => {
    const idx = indexKnowledge([{
      name: "AI.md",
      text:
        "# Budget-Template-Submission\n\nTo access Travel Request, use the navigation tab.\n\n" +
        "## Source\n\n- Source file: Budget-Template-Submission.aspx\n\n" +
        "# Travel-Request\n\nTravel Request lets you access the request form.\n\n" +
        "## Source\n\n- Source file: Travel-Request.aspx\n",
    }]);
    const r = checkQuestion(q("Q-001", "How do I access Travel Request?"), idx);
    expect(r.score).toBe(1);
    expect(r.pageName).toBe("Travel-Request.aspx");
  });

  it("breaks a remaining tie towards the page that says the words most often", () => {
    const idx = indexKnowledge([{
      name: "AI.md",
      text:
        "# One\n\nParking is available.\n\n## Source\n\n- Source file: One.aspx\n\n" +
        "# Two\n\nParking, parking and more parking information.\n\n## Source\n\n- Source file: Two.aspx\n",
    }]);
    expect(checkQuestion(q("Q-001", "Parking?"), idx).pageName).toBe("Two.aspx");
  });
});

/* The point of the feature: the same "not answered" splits into a
 * content problem and a retrieval problem, and they are told apart. */
describe("the verdict separates a missing page from a retrieval failure", () => {
  const idx = index();

  it("knowledge base has it and the user got an answer -> supported", () => {
    const r = checkQuestion(q("Q-001", "Who were the champions of the Harbour Cup?"), idx);
    expect(r.score).toBeGreaterThanOrEqual(COVERED_AT);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.SUPPORTED);
  });

  it("knowledge base has it and the user got nothing -> retrieval gap, not a content gap", () => {
    const r = checkQuestion(q("Q-002", "Who were the champions of the Harbour Cup?", ANSWER_EVALUATION.NOT_ANSWERED), idx);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.RETRIEVAL_GAP);
    expect(r.pageName).toContain("Harbour-Cup");
  });

  it("knowledge base has nothing and the user got nothing -> content to add", () => {
    const r = checkQuestion(q("Q-003", "What is the dental reimbursement ceiling?", ANSWER_EVALUATION.NOT_ANSWERED), idx);
    expect(r.score).toBeLessThan(WEAK_AT);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.KNOWLEDGE_GAP);
  });

  it("knowledge base has nothing yet the user got an answer -> worth a human look", () => {
    const r = checkQuestion(q("Q-004", "What is the dental reimbursement ceiling?"), idx);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.ANSWER_NOT_IN_KB);
  });

  it("a partial match is called weak rather than decided either way", () => {
    // "vehicle" and "form" are on the vehicle page; "insurance" and
    // "renewal" are on no page.
    const r = checkQuestion(q("Q-005", "Vehicle form insurance renewal"), idx);
    expect(r.score).toBeGreaterThanOrEqual(WEAK_AT);
    expect(r.score).toBeLessThan(COVERED_AT);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.WEAK_MATCH);
  });

  it("will not judge a question whose reply the transcript cannot show", () => {
    const r = checkQuestion(q("Q-006", "Who were the champions of the Harbour Cup?", ANSWER_EVALUATION.CANNOT_DETERMINE), idx);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.CANNOT_CHECK);
  });

  it("will not judge a question with no informative words left", () => {
    const r = checkQuestion(q("Q-007", "Can you tell me?"), idx);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.CANNOT_CHECK);
    expect(r.terms).toEqual([]);
  });

  it("will not judge anything when no knowledge file is loaded", () => {
    const r = checkQuestion(q("Q-008", "Who were the champions of the Harbour Cup?"), indexKnowledge([]));
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.CANNOT_CHECK);
  });
});

describe("the evidence is reported, not just the verdict", () => {
  it("names the page, the score and the words behind every call", () => {
    const r = checkQuestion(q("Q-001", "Who were the champions of the Harbour Cup?"), index());
    expect(r.pageName).toBe("Harbour-Cup-Closes-At-Lakeside-Pavilion.aspx");
    expect(r.pageFile).toBe("AI.md");
    expect(r.matched).toContain("harbour");
    expect(r.score).toBeGreaterThan(0);
  });

  it("scores the agent's own reply against the same page, as a prompt to look", () => {
    const idx = index();
    const grounded = checkQuestion(q("Q-001", "Who were the champions of the Harbour Cup?"), idx, {
      answerText: "Team Reed Warblers were the overall champions of the Harbour Cup.",
    });
    const invented = checkQuestion(q("Q-002", "Who were the champions of the Harbour Cup?"), idx, {
      answerText: "The champions received a cash prize of fifty thousand pesos and a trophy sculpture.",
    });
    expect(grounded.answerScore).toBeGreaterThan(invented.answerScore);
  });

  it("has no answer score when there is no reply text to score", () => {
    expect(checkQuestion(q("Q-001", "Vehicle requisition form"), index()).answerScore).toBeNull();
  });

  /* An unanswered question's "reply" is a not-found notice. Scoring it
   * puts a meaningless 0% beside "not answered", which reads as
   * evidence about the page when it is an artefact of the notice. */
  it("does not score the reply of a question that was never answered", () => {
    const r = checkQuestion(q("Q-001", "Vehicle requisition form", ANSWER_EVALUATION.NOT_ANSWERED), index(), {
      answerText: "I was unable to find any information about that.",
    });
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.RETRIEVAL_GAP);
    expect(r.answerScore).toBeNull();
  });

  /* With no word in common the top of the ranking is just the first
   * page. Printing it beside a 0% score sends the reader to check a
   * page that was never a candidate. */
  it("names no page when nothing matched at all", () => {
    const r = checkQuestion(q("Q-001", "Bitcoin custody arrangements?"), index());
    expect(r.score).toBe(0);
    expect(r.pageName).toBe("");
    expect(r.pageFile).toBe("");
  });
});

describe("checking the whole question list", () => {
  it("tallies every verdict and keeps a result per question", () => {
    const questions = [
      q("Q-001", "Who were the champions of the Harbour Cup?"),
      q("Q-002", "What is the dental reimbursement ceiling?", ANSWER_EVALUATION.NOT_ANSWERED),
      q("Q-003", "How do I submit the vehicle requisition form?", ANSWER_EVALUATION.NOT_ANSWERED),
    ];
    const { byQuestionId, counts } = runKnowledgeCheck(questions, index());
    expect(byQuestionId.size).toBe(3);
    expect(counts[KNOWLEDGE_VERDICT.SUPPORTED]).toBe(1);
    expect(counts[KNOWLEDGE_VERDICT.KNOWLEDGE_GAP]).toBe(1);
    expect(counts[KNOWLEDGE_VERDICT.RETRIEVAL_GAP]).toBe(1);
    // Every verdict is present as a key, so a zero reads as zero.
    expect(Object.keys(counts).sort()).toEqual(Object.values(KNOWLEDGE_VERDICT).sort());
  });

  it("merges several uploaded files and says where each page came from", () => {
    const idx = indexKnowledge([
      { name: "News.md", text: AI_FILE },
      { name: "HR.md", text: "# Dental Plan\n\nThe dental reimbursement ceiling is 8,000 pesos yearly." },
    ]);
    expect(idx.pageCount).toBe(3);
    expect(idx.sources.map((s) => s.format)).toEqual([KNOWLEDGE_FORMAT.AI, KNOWLEDGE_FORMAT.PLAIN]);
    const r = checkQuestion(q("Q-001", "What is the dental reimbursement ceiling?"), idx);
    expect(r.verdict).toBe(KNOWLEDGE_VERDICT.SUPPORTED);
    expect(r.pageFile).toBe("HR.md");
  });
});
