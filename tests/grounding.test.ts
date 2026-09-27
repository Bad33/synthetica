import test from "node:test";
import assert from "node:assert/strict";
import {
  validateClaims,
  retrieve,
  type Claim,
  type Chunk,
  analysisSchema,
} from "../src/lib/research";
import {
  chunkDocument,
  textSections,
  parseHtml,
  parseInput,
} from "../src/lib/server/ingestion";
import { publicAddress, sourceUrl } from "../src/lib/server/fetch-source";
import { readJson } from "../src/lib/server/http";
const chunk: Chunk = {
  id: "one",
  paper_id: "paper",
  section: "Results",
  page: 7,
  ordinal: 0,
  text: "On dataset A the method achieved 84.3% accuracy. No replication was conducted.",
  start_offset: 0,
  end_offset: 74,
};
const claim: Claim = {
  area: "Key findings",
  kind: "source_fact",
  text: "On dataset A the method achieved 84.3% accuracy.",
  citations: [
    {
      chunkId: "one",
      quote: "On dataset A the method achieved 84.3% accuracy.",
    },
  ],
};
test("retains exact source facts, rejects invented metrics and nonexistent citations", () => {
  assert.equal(validateClaims([claim], [chunk]).length, 1);
  assert.equal(
    validateClaims([{ ...claim, text: "Accuracy was 99%." }], [chunk]).length,
    0,
  );
  assert.equal(
    validateClaims(
      [
        {
          ...claim,
          citations: [{ chunkId: "other-paper", quote: claim.text }],
        },
      ],
      [chunk],
    ).length,
    0,
  );
  assert.equal(
    validateClaims(
      [
        {
          ...claim,
          citations: [
            { chunkId: "one", quote: claim.text.replace("84.3", "99.9") },
          ],
        },
      ],
      [chunk],
    ).length,
    0,
  );
});
test("paraphrases must be labelled interpretations and cite a real passage", () => {
  const interpretation = {
    ...claim,
    text: "The experiment reports accuracy on one dataset.",
  };
  assert.equal(validateClaims([interpretation], [chunk]).length, 0);
  assert.equal(
    validateClaims([{ ...interpretation, kind: "ai_interpretation" }], [chunk])
      .length,
    1,
  );
  assert.equal(
    analysisSchema.safeParse({ claims: [{ ...claim, citations: [] }] }).success,
    false,
  );
});
test("retrieval uses original text and abstains when there is no overlap", () => {
  assert.deepEqual(retrieve([chunk], "What accuracy results were reported?"), [
    chunk,
  ]);
  assert.deepEqual(retrieve([chunk], "survival chemotherapy"), []);
});
test("chunk provenance round trips Unicode text and section/page boundaries", () => {
  const sections = [
    {
      title: "Method",
      page: 2,
      text: "😀β experimental evidence ".repeat(210),
    },
    { title: "Results", page: 3, text: "Second page outcome ".repeat(10) },
  ];
  const { chunks, text, hash } = chunkDocument(sections, "paper");
  const characters = Array.from(text);
  for (const c of chunks) {
    assert.equal(
      characters.slice(c.start_offset, c.end_offset).join(""),
      c.text,
    );
    assert.ok(Array.from(c.text).length <= 2200);
  }
  assert.equal(chunks.at(-1)?.page, 3);
  assert.equal(hash, chunkDocument(sections, "other-id").hash);
  assert.notEqual(
    hash,
    chunkDocument([{ ...sections[0], page: 4 }, sections[1]], "paper").hash,
  );
});
test("parses headings and HTML original text without scripts or repeated nested table content", () => {
  assert.deepEqual(
    textSections("Abstract\nShort abstract.\n2. Methods\nStudy details."),
    [
      { title: "Abstract", page: null, text: "Short abstract." },
      { title: "2. Methods", page: null, text: "Study details." },
    ],
  );
  const html = parseHtml(
    '<html><head><meta name="citation_author" content="A. Author"><title>Paper</title></head><body><nav>junk</nav><article><h2>Results</h2><p>Some evidence</p><table><tr><td><p>84.3</p></td></tr></table><script>malicious()</script></article></body></html>',
  );
  assert.equal(html.title, "Paper");
  assert.deepEqual(html.authors, ["A. Author"]);
  assert.equal(html.sections[0].text, "Some evidence\n\n84.3");
  assert.equal(html.coverage, "provided_text");
});
test("rejects unsupported source files and textless PDF impostors", async () => {
  await assert.rejects(
    parseInput({
      mode: "file",
      filename: "paper.exe",
      base64: Buffer.from("hello").toString("base64"),
    }),
  );
  await assert.rejects(
    parseInput({
      mode: "file",
      filename: "paper.pdf",
      base64: Buffer.from("Not a PDF").toString("base64"),
    }),
  );
});
test("SSRF guard rejects local, reserved, mapped, link-local and non-HTTPS destinations", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  for (const url of [
    "http://example.com",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://example.com:8443",
    "https://localhost",
    "https://a.local",
  ])
    assert.throws(() => sourceUrl(url));
});
test("streamed request limit works without content-length and malformed JSON is rejected", async () => {
  await assert.rejects(
    readJson(
      new Request("https://app.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(100) }),
      }),
      20,
    ),
    /too large/,
  );
  await assert.rejects(
    readJson(
      new Request("https://app.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ),
    /Invalid JSON/,
  );
});
test("extracts a real PDF with page-level provenance", async () => {
  const lines = [
    "Results",
    "The experiment achieved 84.3 percent accuracy on the evaluation set.",
    "Limitations include a small sample and no independent replication.",
  ];
  const stream =
    "BT /F1 12 Tf 50 750 Td " +
    lines.map((line, i) => `${i ? "0 -20 Td " : ""}(${line}) Tj`).join("\n") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const source = await parseInput({
    mode: "file",
    filename: "fixture.pdf",
    base64: Buffer.from(pdf).toString("base64"),
  });
  assert.equal(source.kind, "pdf");
  assert.equal(source.coverage, "document");
  assert.ok(source.sections.every((s) => s.page === 1));
  assert.ok(
    source.sections.some((s) => s.text.includes("84.3 percent accuracy")),
  );
});
