import { createHash, randomUUID } from "node:crypto";
import { load } from "cheerio";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import type { Chunk, Section, SourceDocument } from "../research";
import { ApiError } from "./http";
import { fetchSource, MAX_FILE_BYTES } from "./fetch-source";

const common = {
  title: z.string().trim().max(500).optional(),
  identifier: z.string().trim().max(300).optional(),
};
export const ingestSchema = z.discriminatedUnion("mode", [
  z.object({
    ...common,
    mode: z.literal("text"),
    text: z.string().trim().min(100).max(400_000),
  }),
  z.object({
    ...common,
    mode: z.literal("url"),
    url: z.string().trim().min(3).max(2000),
  }),
  z.object({
    ...common,
    mode: z.literal("file"),
    filename: z.string().max(255),
    base64: z.string().min(1).max(4_200_000),
  }),
]);
export type IngestInput = z.infer<typeof ingestSchema>;
export function textSections(
  text: string,
  page: number | null = null,
): Section[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: Section[] = [];
  let title = page ? `Page ${page}` : "Provided text";
  let body: string[] = [];
  const flush = () => {
    const value = body.join("\n").trim();
    if (value) sections.push({ title, page, text: value });
    body = [];
  };
  for (const line of lines) {
    if (
      /^(?:#{1,4}\s+.+|(?:\d+(?:\.\d+)*[.\s]+)?(?:abstract|introduction|background|methods?|methodology|results?|discussion|conclusions?|limitations?|references|acknowledg(?:e)?ments|appendix|experimental setup))\s*$/i.test(
        line.trim(),
      ) &&
      line.length < 140
    ) {
      flush();
      title = line.trim().replace(/^#+\s*/, "");
    } else body.push(line);
  }
  flush();
  return sections;
}
export function parseHtml(
  html: string,
): Pick<
  SourceDocument,
  "title" | "authors" | "published" | "venue" | "sections" | "coverage"
> {
  const $ = load(html);
  const meta = (name: string) =>
    $(`meta[name="${name}"]`).attr("content")?.trim() || "";
  const title =
    meta("citation_title") ||
    $("h1").first().text().trim() ||
    $("title").text().trim();
  const authors = $('meta[name="citation_author"]')
    .map((_, el) => $(el).attr("content") || "")
    .get();
  $("script,style,noscript,nav,footer,header,form,svg,iframe").remove();
  const article = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  const sections: Section[] = [];
  let heading = "Source page";
  let text: string[] = [];
  const flush = () => {
    const value = text.join("\n\n").trim();
    if (value) sections.push({ title: heading, page: null, text: value });
    text = [];
  };
  article.find("h1,h2,h3,h4,p,table,figcaption,li,pre").each((_, el) => {
    // Tables, lists and captions keep their own text; do not duplicate nested blocks.
    if ($(el).parents("table,li,pre,figcaption").length) return;
    const value = $(el)
      .text()
      .replace(/[\t ]+/g, " ")
      .trim();
    if (/^h[1-4]$/.test(el.tagName)) {
      flush();
      heading = value;
    } else if (value) text.push(value);
  });
  flush();
  if (!sections.length) sections.push(...textSections(article.text()));
  // Web pages may only contain an abstract or paywall. Do not claim full access.
  return {
    title,
    authors,
    published: meta("citation_publication_date") || null,
    venue: meta("citation_journal_title") || null,
    sections,
    coverage: "provided_text",
  };
}
export async function parseInput(input: IngestInput): Promise<SourceDocument> {
  let document: SourceDocument = {
    title: input.title || "Untitled source",
    identifier: input.identifier || null,
    authors: [],
    published: null,
    venue: null,
    url: null,
    kind: "text",
    coverage: "provided_text",
    sections: [],
  };
  if (input.mode === "text") document.sections = textSections(input.text);
  else {
    let body: Buffer;
    let mime: string;
    if (input.mode === "url") {
      let url = input.url;
      if (/^10\.\d{4,9}\/\S+$/i.test(url)) {
        document.identifier = url;
        url = `https://doi.org/${url}`;
      }
      const fetched = await fetchSource(url);
      body = fetched.body;
      mime = fetched.mime;
      document.url = fetched.url;
    } else {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64))
        throw new ApiError(400, "Invalid file encoding.");
      body = Buffer.from(input.base64, "base64");
      mime = /\.pdf$/i.test(input.filename)
        ? "application/pdf"
        : /\.html?$/i.test(input.filename)
          ? "text/html"
          : /\.txt$/i.test(input.filename)
            ? "text/plain"
            : "";
      if (!input.title) document.title = input.filename;
    }
    if (body.length > MAX_FILE_BYTES)
      throw new ApiError(413, "Files must be at most 3 MB.");
    if (
      mime === "application/pdf" ||
      body.subarray(0, 5).toString() === "%PDF-"
    ) {
      if (body.subarray(0, 5).toString() !== "%PDF-")
        throw new ApiError(422, "This is not a valid PDF.");
      const parser = new PDFParse({
        data: body,
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
      });
      try {
        const info = await parser.getInfo();
        if (info.total > 100)
          throw new ApiError(413, "PDFs must be at most 100 pages.");
        const result = await parser.getText();
        document.sections = result.pages.flatMap((p) =>
          textSections(p.text, p.num),
        );
        document.kind = "pdf";
        document.coverage = "document";
        if (!input.title && typeof info.info?.Title === "string")
          document.title = info.info.Title;
      } finally {
        await parser.destroy();
      }
    } else if (mime === "text/html" || mime === "application/xhtml+xml") {
      const html = parseHtml(body.toString("utf8"));
      document = {
        ...document,
        ...html,
        title: input.title || html.title || document.title,
        kind: "html",
      };
    } else if (mime === "text/plain")
      document.sections = textSections(body.toString("utf8"));
    else throw new ApiError(415, "Use a PDF, HTML, or plain text source.");
  }
  document.sections = document.sections.map((s) => ({
    ...s,
    title: s.title.slice(0, 300),
    text: s.text.replace(/\u0000/g, ""),
  }));
  document.title = document.title.slice(0, 500);
  const text = document.sections.map((s) => s.text).join("\n\n");
  if (text.length < 100)
    throw new ApiError(
      422,
      "No usable text was found. Scanned PDFs require OCR before import.",
    );
  if (text.length > 400_000)
    throw new ApiError(
      413,
      "Extracted text exceeds 400,000 characters. Import a smaller document.",
    );
  return document;
}
export function chunkDocument(
  sections: Section[],
  paperId: string,
): { chunks: Chunk[]; text: string; hash: string } {
  const chunks: Chunk[] = [];
  let offset = 0;
  for (const section of sections) {
    const characters = Array.from(section.text);
    for (let start = 0; start < characters.length; start += 1800) {
      const end = Math.min(start + 2200, characters.length);
      chunks.push({
        id: randomUUID(),
        paper_id: paperId,
        section: section.title,
        page: section.page,
        ordinal: chunks.length,
        text: characters.slice(start, end).join(""),
        start_offset: offset + start,
        end_offset: offset + end,
      });
      if (end === characters.length) break;
    }
    offset += characters.length + 2;
  }
  const text = sections.map((s) => s.text).join("\n\n");
  // Include boundaries, headings and pages in source identity, not just text.
  const hash = createHash("sha256")
    .update(JSON.stringify(sections))
    .digest("hex");
  return { chunks, text, hash };
}
