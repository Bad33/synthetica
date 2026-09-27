"use client";
import { useEffect, useState } from "react";
import { useWorkspace, errorMessage } from "./workspace";
import { AnswerView, ClaimCard } from "./evidence";
import {
  areas,
  paperColumns,
  type Analysis,
  type Answer,
  type Chunk,
  type Message,
  type Note,
  type Paper,
} from "@/lib/research";

export function PaperReader({ id }: { id: string }) {
  const { db, api, session } = useWorkspace();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [area, setArea] = useState<string>("Overview");
  const [view, setView] = useState<"explanation" | "original" | "side-by-side">(
    "explanation",
  );
  const [question, setQuestion] = useState("");
  const [note, setNote] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [tags, setTags] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState("unsupported_claim");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      db.from("research_papers").select(paperColumns).eq("id", id).single(),
      db.from("paper_chunks").select("*").eq("paper_id", id).order("ordinal"),
      db.from("notes").select("*").eq("paper_id", id).order("created_at"),
      db
        .from("chat_messages")
        .select("*")
        .eq("paper_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]).then(([p, c, n, m]) => {
      if (!active) return;
      if (p.error || c.error || n.error || m.error)
        setError("This paper is unavailable or could not be loaded.");
      else {
        setPaper(p.data as Paper);
        setChunks(c.data ?? []);
        setNotes(n.data ?? []);
        setMessages((m.data ?? []).reverse());
        setTags((p.data.tags ?? []).join(", "));
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [db, id]);
  async function analyze() {
    setAnalyzing(true);
    setError("");
    try {
      const result = await api<{ analysis: Analysis }>("/api/analyze", {
        paperId: id,
      });
      setPaper((p) =>
        p
          ? { ...p, analysis: result.analysis, analysis_status: "complete" }
          : p,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAnalyzing(false);
    }
  }
  async function ask(query: string) {
    if (asking || !query.trim()) return;
    setAsking(true);
    setError("");
    try {
      const { answer } = await api<{ answer: Answer }>("/api/chat", {
        paperId: id,
        question: query,
      });
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "user",
          question: query,
          answer: null,
          created_at: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          question: null,
          answer,
          created_at: new Date().toISOString(),
        },
      ]);
      setQuestion("");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAsking(false);
    }
  }
  function quote(chunk: Chunk, text: string) {
    setQuoteId(chunk.id);
    setNote(`> ${text}\n\n`);
    document.getElementById("notebook")?.scrollIntoView({ behavior: "smooth" });
  }
  async function saveNote() {
    setSavingNote(true);
    setError("");
    try {
      const { data, error } = await db
        .from("notes")
        .insert({
          owner_id: session.user.id,
          paper_id: id,
          content: note.trim(),
          chunk_id: quoteId,
        })
        .select()
        .single();
      if (error) throw error;
      setNotes((n) => [...n, data]);
      setNote("");
      setQuoteId(null);
    } catch {
      setError("Could not save the note. Your text is still here.");
    } finally {
      setSavingNote(false);
    }
  }
  async function updateState(
    update: Partial<Pick<Paper, "reading_status" | "tags">>,
  ) {
    const { error } = await db
      .from("research_papers")
      .update(update)
      .eq("id", id);
    if (error) setError("Could not save reading status or tags.");
    else setPaper((p) => (p ? { ...p, ...update } : p));
  }
  function exportBrief() {
    if (!paper) return;
    const lines = [
      `# ${paper.title}`,
      "",
      `Source: ${paper.source_url || paper.identifier || "Personal import"}`,
      `Coverage: ${paper.coverage}`,
      "",
      "## AI explanation",
    ];
    for (const claim of paper.analysis?.claims ?? []) {
      lines.push("", `### ${claim.area} · ${claim.kind}`, claim.text);
      for (const c of claim.citations) {
        const chunk = chunks.find((p) => p.id === c.chunkId);
        lines.push(
          `> ${c.quote}`,
          `Source: ${chunk?.section || "Unknown"}${chunk?.page ? `, page ${chunk.page}` : ""}; passage ${c.chunkId}`,
        );
      }
    }
    lines.push("", "## User notes");
    for (const n of notes)
      lines.push(
        "",
        n.content,
        n.chunk_id ? `Source passage: ${n.chunk_id}` : "",
      );
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "research-brief.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (loading)
    return <p role="status">Loading original passages and your research…</p>;
  if (!paper)
    return (
      <p className="error" role="alert">
        {error || "Paper not found."}
      </p>
    );
  const selectedClaims = (paper.analysis?.claims ?? []).filter(
    (c) => c.area === area,
  );
  const original = (
    <section className="panel stack">
      <h2>Original passages</h2>
      <label>
        Search this source
        <input
          value={sourceQuery}
          onChange={(e) => setSourceQuery(e.target.value)}
          placeholder="Find a phrase…"
        />
      </label>
      <div className="original-list stack">
        {chunks
          .filter(
            (c) =>
              !sourceQuery ||
              c.text.toLowerCase().includes(sourceQuery.toLowerCase()),
          )
          .map((chunk) => (
            <div key={chunk.id} id={`passage-${chunk.id}`}>
              <h3>
                {chunk.section}
                {chunk.page ? ` · Page ${chunk.page}` : ""}
              </h3>
              <p className="original-text">{chunk.text}</p>
              <button
                className="citation"
                onClick={() => quote(chunk, chunk.text)}
              >
                Quote in notebook
              </button>
            </div>
          ))}
      </div>
    </section>
  );
  return (
    <>
      <p className="eyebrow">Source workspace</p>
      <h1 className="reader-title">{paper.title}</h1>
      <div className="row">
        <span className="pill">
          {paper.source_kind.toUpperCase()} ·{" "}
          {paper.coverage === "document"
            ? "Document text extracted"
            : "Provided text only"}
        </span>
        <span className="muted">{chunks.length} passages</span>
        {paper.source_url && (
          <a
            className="button secondary"
            href={paper.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open original ↗
          </a>
        )}
        <button className="quiet" onClick={exportBrief}>
          Export research brief
        </button>
      </div>
      <p className="muted">
        {paper.authors.length
          ? paper.authors.join(", ")
          : "Authors not available"}{" "}
        · {paper.published || "Publication date not available"} ·{" "}
        {paper.venue || "Venue not available"}
        {paper.identifier ? ` · ${paper.identifier}` : ""}
      </p>
      <p className="muted">
        Retraction/correction status is not checked. Document text can omit
        figures, scanned content, and table structure.
      </p>
      {paper.coverage === "provided_text" && (
        <p className="notice">
          This source may be an abstract, excerpt, or web landing page.
          Explanations and answers cover only the retained text.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row section">
        <label>
          Reading status
          <select
            value={paper.reading_status}
            onChange={(e) =>
              void updateState({
                reading_status: e.target.value as Paper["reading_status"],
              })
            }
          >
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="read">Read</option>
          </select>
        </label>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void updateState({
              tags: [
                ...new Set(
                  tags
                    .split(",")
                    .map((t) => t.trim().slice(0, 50))
                    .filter(Boolean),
                ),
              ].slice(0, 20),
            });
          }}
        >
          <label>
            Tags, separated by commas
            <input
              value={tags}
              maxLength={1000}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          <button className="quiet">Save tags</button>
        </form>
      </div>
      <div className="tabs" aria-label="Reader view">
        {(["explanation", "original", "side-by-side"] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === "explanation"
              ? "AI explanation"
              : v === "original"
                ? "Original"
                : "Side by side"}
          </button>
        ))}
      </div>
      <div className={`reader-grid ${view === "original" ? "wide" : ""}`}>
        {view === "original" ? (
          original
        ) : (
          <section className="stack">
            {!paper.analysis ? (
              <div className="panel stack">
                <h2>Build a cited explanation</h2>
                <p>
                  Your source is saved. Generate an explanation from its
                  original passages.
                </p>
                <button disabled={analyzing} onClick={analyze}>
                  {analyzing
                    ? "Extracting and validating source citations…"
                    : paper.analysis_status === "failed"
                      ? "Retry source analysis"
                      : "Analyze source"}
                </button>
              </div>
            ) : (
              <>
                <label>
                  Research area
                  <select
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                  >
                    {areas.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  Source facts are verbatim quotations. AI interpretations have
                  verified quotations, but their meaning still needs your
                  review.
                </p>
                {selectedClaims.length ? (
                  selectedClaims.map((claim, i) => (
                    <div className="stack" key={i}>
                      <ClaimCard
                        claim={claim}
                        chunks={chunks}
                        onQuote={quote}
                      />
                      {area === "Concepts" && (
                        <div className="row">
                          <button
                            className="quiet"
                            disabled={asking}
                            onClick={() =>
                              void ask(
                                `Explain more simply using only the source: ${claim.text}`.slice(
                                  0,
                                  2000,
                                ),
                              )
                            }
                          >
                            Explain simpler
                          </button>
                          <button
                            className="quiet"
                            disabled={asking}
                            onClick={() =>
                              void ask(
                                `Explain the mathematics and prerequisites, if present in the source, for: ${claim.text}`.slice(
                                  0,
                                  2000,
                                ),
                              )
                            }
                          >
                            Explain mathematically
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="notice">
                    No source-verifiable explanation was extracted for this
                    area. Inspect the source or ask a specific question.
                  </p>
                )}
              </>
            )}
            <section className="panel stack">
              <h2>Evidence</h2>
              <p className="muted">
                Quantitative passages are available in the original source.
                Automatic chart extraction is not enabled; no inferred or legacy
                chart values are displayed.
              </p>
            </section>
          </section>
        )}
        {view === "side-by-side"
          ? original
          : view !== "original" && (
              <section className="panel stack">
                <h2>Ask the source</h2>
                <p className="muted">
                  Answers retrieve original passages. Conversation history helps
                  interpret follow-up questions.
                </p>
                <div className="row">
                  {[
                    "What methodology and experimental setup are reported?",
                    "What limitations and assumptions are stated?",
                    "What results support the main conclusion?",
                  ].map((q) => (
                    <button
                      key={q}
                      className="citation"
                      disabled={asking}
                      onClick={() => void ask(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                <div className="chat-log" aria-live="polite">
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <p key={m.id} className="user-question">
                        {m.question}
                      </p>
                    ) : (
                      m.answer && (
                        <AnswerView
                          key={m.id}
                          answer={m.answer}
                          chunks={chunks}
                        />
                      )
                    ),
                  )}
                  {asking && (
                    <p role="status">
                      Retrieving passages and checking citations…
                    </p>
                  )}
                </div>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask(question);
                  }}
                >
                  <label>
                    Your research question
                    <textarea
                      value={question}
                      minLength={3}
                      maxLength={2000}
                      required
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="What evidence supports this result?"
                    />
                  </label>
                  <button disabled={asking}>Ask with source citations</button>
                </form>
              </section>
            )}
      </div>
      <div className="two-col section">
        <section className="panel stack" id="notebook">
          <p className="claim-label">USER NOTES</p>
          <h2>Your notebook</h2>
          {notes.map((n) => (
            <div className="source-quote" key={n.id}>
              <p className="original-text">{n.content}</p>
              {n.chunk_id && (
                <p className="muted">
                  Linked to{" "}
                  {chunks.find((c) => c.id === n.chunk_id)?.section ??
                    "source passage"}
                </p>
              )}
            </div>
          ))}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNote();
            }}
          >
            <label>
              Your note
              <textarea
                value={note}
                required
                maxLength={20000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Your observations, questions, or a passage to revisit…"
              />
            </label>
            {quoteId && (
              <p className="muted">
                Linked to a source passage.{" "}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setQuoteId(null)}
                >
                  Unlink
                </button>
              </p>
            )}
            <button disabled={savingNote || !note.trim()}>
              {savingNote ? "Saving…" : "Save note"}
            </button>
          </form>
        </section>
        <section className="panel stack">
          <h2>Help improve this analysis</h2>
          <p className="muted">
            Feedback is saved privately with this paper for review.
          </p>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setFeedbackStatus("Saving…");
              const { error } = await db
                .from("research_feedback")
                .insert({
                  owner_id: session.user.id,
                  paper_id: id,
                  kind: feedbackKind,
                  detail: feedback,
                });
              setFeedbackStatus(
                error
                  ? "Could not save feedback. Try again."
                  : "Feedback saved.",
              );
              if (!error) setFeedback("");
            }}
          >
            <label>
              Feedback type
              <select
                value={feedbackKind}
                onChange={(e) => setFeedbackKind(e.target.value)}
              >
                <option value="unsupported_claim">Unsupported claim</option>
                <option value="incorrect_citation">Incorrect citation</option>
                <option value="bad_extraction">Bad extraction</option>
                <option value="missing_context">Missing context</option>
                <option value="useful">Useful</option>
                <option value="not_useful">Not useful</option>
              </select>
            </label>
            <label>
              Details
              <textarea
                value={feedback}
                maxLength={2000}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Which claim or passage should be reviewed?"
              />
            </label>
            <button className="quiet">Save feedback</button>
            <p role="status">{feedbackStatus}</p>
          </form>
        </section>
      </div>
    </>
  );
}
