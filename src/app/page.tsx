"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace, errorMessage } from "@/components/workspace";
import type { Collection, Paper } from "@/lib/research";
type LibraryPaper = Pick<
  Paper,
  | "id"
  | "title"
  | "identifier"
  | "coverage"
  | "reading_status"
  | "created_at"
  | "tags"
  | "source_kind"
>;
export default function HomePage() {
  const { db } = useWorkspace();
  const [papers, setPapers] = useState<LibraryPaper[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function search(q: string) {
    setLoading(true);
    setError("");
    try {
      let request = db
        .from("research_papers")
        .select(
          "id,title,identifier,coverage,reading_status,created_at,tags,source_kind",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (q.trim())
        request = request.textSearch(
          "search_document",
          q.trim().slice(0, 500),
          { type: "websearch", config: "english" },
        );
      const { data, error } = await request;
      if (error) throw error;
      setPapers(data ?? []);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      db
        .from("research_papers")
        .select(
          "id,title,identifier,coverage,reading_status,created_at,tags,source_kind",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("collections")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10),
    ]).then(([p, c]) => {
      if (!active) return;
      if (p.error || c.error)
        setError(
          "Could not load your library. Check connection and database migrations.",
        );
      else {
        setPapers(p.data ?? []);
        setCollections(c.data ?? []);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [db]);
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Understand · Investigate · Keep the evidence</p>
        <h1>
          What are you trying
          <br />
          to understand?
        </h1>
        <p>
          Start with a paper or search a question across your saved sources.
        </p>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            void search(query);
          }}
        >
          <label className="visually-hidden" htmlFor="research-search">
            Search your source text
          </label>
          <input
            id="research-search"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your sources: long-context evaluation…"
          />
          <button disabled={loading}>Search</button>
        </form>
        <div className="row" style={{ marginTop: 18 }}>
          <Link className="button" href="/upload">
            Analyze a paper ↗
          </Link>
          <Link className="button secondary" href="/investigate">
            Start an investigation
          </Link>
        </div>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {collections.length > 0 && (
        <section className="section">
          <h2>Continue research</h2>
          <div className="paper-grid">
            {collections.map((c) => (
              <Link
                className="paper-card"
                href={`/investigate?collection=${c.id}`}
                key={c.id}
              >
                <span className="eyebrow">Investigation</span>
                <h3>{c.title}</h3>
                <p className="muted">
                  {c.question || "Open your research collection"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="section">
        <div className="row between">
          <h2>{query ? "Search results" : "Your library"}</h2>
          <span className="muted">
            Private · Most recent first · Up to 100 results
          </span>
        </div>
        {loading ? (
          <p role="status" className="notice">
            Loading your sources…
          </p>
        ) : papers.length === 0 ? (
          <div className="panel section">
            <h3>
              {query
                ? "No matching sources"
                : "Your next question starts here."}
            </h3>
            <p>
              {query
                ? "Try a shorter query or add another paper."
                : "Import a PDF, DOI, paper URL, or text. Your original passages stay alongside every explanation."}
            </p>
            <Link href="/upload">Add a source →</Link>
          </div>
        ) : (
          <div className="paper-grid">
            {papers.map((p) => (
              <Link key={p.id} className="paper-card" href={`/paper/${p.id}`}>
                <div className="row between">
                  <span className="pill">
                    {p.source_kind.toUpperCase()} ·{" "}
                    {p.coverage === "document"
                      ? "Document text"
                      : "Provided text"}
                  </span>
                  <span className="muted">{p.reading_status}</span>
                </div>
                <h3>{p.title}</h3>
                <p className="muted">{p.identifier || "Personal import"}</p>
                <div className="row">
                  {p.tags.map((t) => (
                    <span className="pill" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
                <span className="muted">Open source workspace →</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
