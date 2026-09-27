"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace, errorMessage } from "@/components/workspace";
export default function UploadPage() {
  const { api } = useWorkspace();
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "url" | "text">("file");
  const [title, setTitle] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  return (
    <div className="stack" style={{ maxWidth: 820, margin: "auto" }}>
      <section className="hero">
        <p className="eyebrow">Analyze a paper</p>
        <h1>Start with the source.</h1>
        <p>
          Save the original text first. Then build an explanation you can
          inspect, passage by passage.
        </p>
      </section>
      <div className="tabs" aria-label="Source type">
        {(["file", "url", "text"] as const).map((m) => (
          <button
            disabled={busy}
            key={m}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
          >
            {m === "file"
              ? "Upload PDF / HTML"
              : m === "url"
                ? "DOI / paper URL"
                : "Paste text"}
          </button>
        ))}
      </div>
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setProgress("Retrieving, parsing, and saving the original source…");
          try {
            let input: object = {
              mode,
              title,
              identifier,
              ...(mode === "url" ? { url } : { text }),
            };
            if (mode === "file") {
              if (!file) throw new Error("Choose a file.");
              if (file.size > 3 * 1024 * 1024)
                throw new Error("Files must be at most 3 MB.");
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = () =>
                  reject(new Error("Could not read the file."));
                reader.readAsDataURL(file);
              });
              input = { mode, title, identifier, filename: file.name, base64 };
            }
            const data = await api<{
              id: string;
              stages: { sections: number; passages: number };
            }>("/api/ingest", input);
            setProgress(
              `Saved ${data.stages.sections} sections and ${data.stages.passages} passages. Opening the reader…`,
            );
            router.push(`/paper/${data.id}`);
          } catch (error) {
            setError(errorMessage(error));
            setProgress("");
            setBusy(false);
          }
        }}
      >
        <label>
          Title (optional)
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            placeholder="A title for your library"
          />
        </label>
        <label>
          DOI / identifier (optional)
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            maxLength={300}
            placeholder="10.xxxx/example"
          />
        </label>
        {mode === "file" ? (
          <label>
            Source file
            <input
              required
              type="file"
              accept=".pdf,.html,.htm,.txt"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span className="muted">
              PDF, HTML, or TXT · Up to 3 MB · PDFs up to 100 pages · Text PDFs
              only
            </span>
          </label>
        ) : mode === "url" ? (
          <label>
            DOI or HTTPS URL
            <input
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2000}
              placeholder="10.1038/… or https://arxiv.org/html/…"
            />
            <span className="muted">
              Publisher, arXiv, PubMed, and direct paper links. A landing page
              may contain only an abstract; upload the PDF for document text.
            </span>
          </label>
        ) : (
          <label>
            Original source text
            <textarea
              required
              minLength={100}
              maxLength={400000}
              style={{ minHeight: 280 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste original paper text, preserving section headings. An abstract will remain labelled as provided text."
            />
          </label>
        )}
        <p className="muted">
          No inferred chart values. Page numbers are retained for PDFs; HTML and
          pasted text use sections. Scanned PDFs need OCR before import.
        </p>
        <button disabled={busy}>
          {busy ? "Saving source…" : "Save source and open workspace"}
        </button>
        {progress && <p role="status">{progress}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
