"use client";
import { useState } from "react";
import {
  type Claim,
  type Chunk,
  type Paper,
  type Answer,
} from "@/lib/research";
export function ClaimCard({
  claim,
  chunks,
  papers = [],
  onQuote,
}: {
  claim: Claim;
  chunks: Chunk[];
  papers?: Pick<Paper, "id" | "title">[];
  onQuote?: (chunk: Chunk, quote: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="claim">
      <div className="claim-label">
        {claim.kind === "source_fact"
          ? "SOURCE FACT · VERBATIM"
          : "AI INTERPRETATION"}
      </div>
      <p>{claim.text}</p>
      <button
        className="citation"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Show"} source passage
        {claim.citations.length > 1 ? "s" : ""} [{claim.citations.length}]
      </button>
      {open &&
        claim.citations.map((ref, i) => {
          const chunk = chunks.find((c) => c.id === ref.chunkId);
          return (
            <div className="source-quote" key={`${ref.chunkId}-${i}`}>
              <p className="muted">
                {papers.find((p) => p.id === chunk?.paper_id)?.title} ·{" "}
                {chunk?.section ?? "Source unavailable"}
                {chunk?.page ? ` · Page ${chunk.page}` : ""}
              </p>
              <blockquote>{ref.quote}</blockquote>
              {chunk && (
                <details>
                  <summary>Passage context</summary>
                  <p className="original-text">{chunk.text}</p>
                </details>
              )}
              {chunk && onQuote && (
                <button
                  className="quiet"
                  onClick={() => onQuote(chunk, ref.quote)}
                >
                  Quote in notebook
                </button>
              )}
            </div>
          );
        })}
    </div>
  );
}
export function AnswerView({
  answer,
  chunks,
  papers,
}: {
  answer: Answer;
  chunks: Chunk[];
  papers?: Pick<Paper, "id" | "title">[];
}) {
  return answer.status === "unavailable" ? (
    <p className="notice">
      The retrieved source passages do not contain enough evidence to answer.
      Try a more specific question or inspect the original source.
    </p>
  ) : (
    <div className="stack">
      {answer.claims.map((claim, i) => (
        <ClaimCard key={i} claim={claim} chunks={chunks} papers={papers} />
      ))}
    </div>
  );
}
