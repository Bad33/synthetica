import { z } from "zod";

export const areas = [
  "Overview",
  "Core problem",
  "Contributions",
  "Methodology",
  "Experimental setup",
  "Key findings",
  "Limitations",
  "Assumptions",
  "Reproducibility",
  "Code and data",
  "Related work",
  "Open questions",
  "Concepts",
] as const;
export const citationSchema = z.object({
  chunkId: z.string().max(100),
  quote: z.string().min(12).max(2400),
});
export const claimSchema = z.object({
  area: z.enum(areas),
  kind: z.enum(["source_fact", "ai_interpretation"]),
  text: z.string().min(1).max(2400),
  citations: z.array(citationSchema).min(1).max(5),
});
export const analysisSchema = z.object({
  claims: z.array(claimSchema).max(50),
});
export const answerSchema = z.object({
  status: z.enum(["supported", "unavailable"]),
  claims: z.array(claimSchema).max(12),
});
export type Citation = z.infer<typeof citationSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Chunk = {
  id: string;
  paper_id: string;
  section: string;
  page: number | null;
  ordinal: number;
  text: string;
  start_offset: number;
  end_offset: number;
};
export type Section = { title: string; page: number | null; text: string };
export type SourceDocument = {
  title: string;
  identifier: string | null;
  url: string | null;
  authors: string[];
  published: string | null;
  venue: string | null;
  kind: "text" | "pdf" | "html";
  coverage: "provided_text" | "document";
  sections: Section[];
};
export type Paper = {
  id: string;
  owner_id: string;
  title: string;
  identifier: string | null;
  source_url: string | null;
  authors: string[];
  published: string | null;
  venue: string | null;
  source_kind: SourceDocument["kind"];
  coverage: SourceDocument["coverage"];
  source_text: string;
  source_hash: string;
  analysis: Analysis | null;
  analysis_status: "pending" | "complete" | "failed";
  created_at: string;
  reading_status: "unread" | "reading" | "read";
  tags: string[];
};
export type Collection = {
  id: string;
  title: string;
  question: string;
  created_at: string;
};
export type Note = {
  id: string;
  paper_id: string;
  content: string;
  chunk_id: string | null;
  created_at: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  question: string | null;
  answer: Answer | null;
  created_at: string;
};
export const paperColumns =
  "id,owner_id,title,identifier,source_url,authors,published,venue,source_kind,coverage,source_text,source_hash,analysis,analysis_status,created_at,reading_status,tags";
export const unavailable = (): Answer => ({
  status: "unavailable",
  claims: [],
});

// Exact quotes and source IDs are checked server-side. This verifies provenance,
// not semantic entailment: interpretations remain explicitly labelled as AI.
export function validateClaims(claims: Claim[], chunks: Chunk[]): Claim[] {
  const source = new Map(chunks.map((c) => [c.id, c]));
  return claims.filter((claim) => {
    if (!claim.citations.length) return false;
    if (
      !claim.citations.every((c) =>
        source.get(c.chunkId)?.text.includes(c.quote),
      )
    )
      return false;
    return (
      claim.kind !== "source_fact" ||
      claim.citations.some((c) => c.quote === claim.text)
    );
  });
}

export function retrieve(
  chunks: Chunk[],
  question: string,
  limit = 12,
): Chunk[] {
  const stop = new Set([
    "the",
    "and",
    "are",
    "this",
    "that",
    "what",
    "how",
    "does",
    "with",
    "from",
    "paper",
    "were",
    "was",
    "which",
    "for",
  ]);
  const terms = [
    ...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  ]
    .filter((t) => !stop.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
  const ranked = chunks
    .map((chunk) => ({
      chunk,
      score: terms.reduce((n, term) => {
        const text = chunk.text.toLowerCase();
        return (
          n +
          (text.includes(term) ? 1 : 0) +
          (chunk.section.toLowerCase().includes(term) ? 2 : 0)
        );
      }, 0),
    }))
    .sort((a, b) => b.score - a.score || a.chunk.ordinal - b.chunk.ordinal);
  return ranked
    .filter((x) => x.score > 0)
    .slice(0, limit)
    .map((x) => x.chunk);
}
