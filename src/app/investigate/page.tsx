"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace, errorMessage } from "@/components/workspace";
import { AnswerView, ClaimCard } from "@/components/evidence";
import type { Answer, Chunk, Collection, Paper } from "@/lib/research";
type ComparisonPaper = Pick<Paper, "id" | "title" | "coverage" | "analysis">;
export default function InvestigatePage() {
  const { db, api, session } = useWorkspace();
  const [papers, setPapers] = useState<ComparisonPaper[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    answer: Answer;
    passages: Chunk[];
    papers: Pick<Paper, "id" | "title">[];
  } | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  useEffect(() => {
    let active = true;
    Promise.all([
      db
        .from("collections")
        .select("*")
        .order("created_at", { ascending: false }),
      db
        .from("research_papers")
        .select("id,title,coverage,analysis")
        .order("created_at", { ascending: false })
        .limit(100),
    ]).then(async ([c, p]) => {
      if (!active) return;
      if (c.error || p.error) {
        setError("Could not load investigations.");
        return;
      }
      setCollections(c.data ?? []);
      setPapers(p.data ?? []);
      const id = new URLSearchParams(window.location.search).get("collection");
      const current = c.data?.find((item) => item.id === id);
      if (current) {
        const { data, error } = await db
          .from("collection_papers")
          .select("paper_id")
          .eq("collection_id", current.id);
        if (!active) return;
        if (error) setError("Could not load collection members.");
        else {
          setCollection(current.id);
          setTitle(current.title);
          setQuestion(current.question);
          setSelected((data ?? []).map((p) => p.paper_id));
        }
      }
    });
    return () => {
      active = false;
    };
  }, [db]);
  useEffect(() => {
    let active = true;
    if (selected.length)
      db.from("paper_chunks")
        .select("*")
        .in("paper_id", selected)
        .order("ordinal")
        .then(({ data, error }) => {
          if (active) {
            if (error) setError("Could not load comparison passages.");
            else setChunks(data ?? []);
          }
        });
    return () => {
      active = false;
    };
  }, [db, selected]);
  async function selectCollection(id: string) {
    setResult(null);
    setStatus("");
    setError("");
    setCollection(id);
    if (!id) {
      setTitle("");
      setQuestion("");
      setSelected([]);
      return;
    }
    const c = collections.find((c) => c.id === id)!;
    setTitle(c.title);
    setQuestion(c.question);
    const { data, error } = await db
      .from("collection_papers")
      .select("paper_id")
      .eq("collection_id", id);
    if (error) setError("Could not load this collection.");
    else setSelected((data ?? []).map((p) => p.paper_id));
  }
  async function save() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      // Database function makes metadata + membership changes atomic and owner-scoped.
      const { data, error } = await db.rpc("save_research_collection", {
        collection_id: collection || crypto.randomUUID(),
        collection_title: title.trim(),
        research_question: question.trim(),
        paper_ids: selected,
      });
      if (error) throw error;
      const current: Collection = {
        id: data,
        title: title.trim(),
        question: question.trim(),
        created_at: new Date().toISOString(),
      };
      setCollection(data);
      setCollections((c) => [current, ...c.filter((p) => p.id !== data)]);
      setStatus("Investigation saved.");
    } catch {
      setError(
        "Could not save the investigation. Your changes are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <section className="hero">
        <p className="eyebrow">Investigate</p>
        <h1>
          One question.
          <br />
          Multiple perspectives.
        </h1>
        <p>
          Keep papers together, compare their methods, and ask what their
          evidence supports.
        </p>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="two-col">
        <section className="panel stack">
          <label>
            Investigation
            <select
              value={collection}
              onChange={(e) => void selectCollection(e.target.value)}
            >
              <option value="">New investigation</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Long-context evaluation"
            />
          </label>
          <label>
            Research question
            <textarea
              value={question}
              maxLength={2000}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="How do these papers evaluate long-context performance, and where do their assumptions differ?"
            />
          </label>
          <button disabled={busy || !title.trim()} onClick={save}>
            Save investigation
          </button>
          <p role="status">{status}</p>
        </section>
        <section className="panel stack">
          <h2>Choose your sources</h2>
          <p className="muted">
            Select up to 6 papers for comparison and synthesis. Import sources
            in Analyze.
          </p>
          {papers.length === 0 && (
            <Link href="/upload">Add your first paper →</Link>
          )}
          {papers.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                disabled={!selected.includes(p.id) && selected.length >= 6}
                onChange={(e) => {
                  setResult(null);
                  setSelected((s) =>
                    e.target.checked
                      ? [...s, p.id]
                      : s.filter((id) => id !== p.id),
                  );
                }}
              />
              {p.title}
              <span className="muted">
                {" "}
                ·{" "}
                {p.coverage === "document" ? "Document text" : "Provided text"}
              </span>
            </label>
          ))}
        </section>
      </div>
      <section className="panel stack">
        <h2>Synthesize the evidence</h2>
        <p>
          Ask about agreement, contradictions, methods, assumptions, or open
          questions. Every retained comparison cites passages from at least two
          papers.
        </p>
        <button
          disabled={busy || selected.length < 2 || question.trim().length < 10}
          onClick={async () => {
            setBusy(true);
            setError("");
            setResult(null);
            try {
              setResult(
                await api("/api/synthesize", { paperIds: selected, question }),
              );
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : "Compare with source citations"}
        </button>
        {result && (
          <AnswerView
            answer={result.answer}
            chunks={result.passages}
            papers={result.papers}
          />
        )}
      </section>
      {selected.length > 0 && (
        <section className="stack">
          <h2>Paper comparison</h2>
          <div className="paper-grid">
            {papers
              .filter((p) => selected.includes(p.id))
              .map((p) => (
                <section className="panel stack" key={p.id}>
                  <Link href={`/paper/${p.id}`}>
                    <h3>{p.title} ↗</h3>
                  </Link>
                  {(
                    [
                      "Methodology",
                      "Experimental setup",
                      "Key findings",
                      "Assumptions",
                      "Limitations",
                    ] as const
                  ).map((area) => (
                    <div className="stack" key={area}>
                      <h3>{area}</h3>
                      {p.analysis?.claims.filter((c) => c.area === area)
                        .length ? (
                        p.analysis.claims
                          .filter((c) => c.area === area)
                          .map((claim, i) => (
                            <ClaimCard key={i} claim={claim} chunks={chunks} />
                          ))
                      ) : (
                        <p className="muted">No cited extraction available.</p>
                      )}
                    </div>
                  ))}
                </section>
              ))}
          </div>
        </section>
      )}
      <p className="muted">
        Synthesis is generated on demand. Save useful conclusions as notes in
        the relevant paper. Your collection belongs to {session.user.email}.
      </p>
    </div>
  );
}
