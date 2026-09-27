"use client";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";

type WorkspaceContext = {
  db: SupabaseClient;
  session: Session;
  api: <T>(path: string, input: unknown) => Promise<T>;
};
const WorkspaceContext = createContext<WorkspaceContext | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace requires authentication");
  return context;
}
export function Workspace({ children }: { children: React.ReactNode }) {
  const [db] = useState(() =>
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        )
      : null,
  );
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!db);
  useEffect(() => {
    if (!db) return;
    let active = true;
    db.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data } = db.auth.onAuthStateChange((_event, current) => {
      if (active) {
        setSession(current);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [db]);
  async function api<T>(path: string, input: unknown): Promise<T> {
    const current = await db!.auth.getSession();
    if (!current.data.session) throw new Error("Sign in to continue.");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${current.data.session.access_token}`,
      },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "Request failed.",
      );
    return data as T;
  }
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Synthetica<span>Research, with receipts.</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">Understand</Link>
          <Link href="/upload">Analyze</Link>
          <Link href="/investigate">Investigate</Link>
          {session && (
            <button className="quiet" onClick={() => db?.auth.signOut()}>
              Sign out
            </button>
          )}
        </nav>
      </header>
      <main className="shell">
        {loading ? (
          <p role="status">Opening your workspace…</p>
        ) : !db ? (
          <section className="hero">
            <p className="eyebrow">Your research workspace</p>
            <h1>What are you trying to understand?</h1>
            <p>
              Bring a paper. Trace an explanation to the source. Build an
              investigation.
            </p>
            <div className="notice">
              Configure the public Supabase URL and anon key to enable your
              private workspace. See the repository setup guide.
            </div>
          </section>
        ) : !session ? (
          <SignIn db={db} />
        ) : (
          <WorkspaceContext.Provider
            key={session.user.id}
            value={{ db, session, api }}
          >
            {children}
          </WorkspaceContext.Provider>
        )}
      </main>
      <footer className="site-footer">
        Original passages are evidence. AI explanations are interpretations.
        Your notes belong to you.
      </footer>
    </>
  );
}
function SignIn({ db }: { db: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="signin-grid">
      <section className="hero">
        <p className="eyebrow">A place to understand research</p>
        <h1>
          Follow the idea.
          <br />
          Find the evidence.
        </h1>
        <p>
          Read original passages alongside AI explanations, ask grounded
          questions, and compare papers in a private workspace.
        </p>
        <div className="pill-row">
          <span className="pill">Source passages</span>
          <span className="pill">Cited interpretations</span>
          <span className="pill">Your notebook</span>
        </div>
      </section>
      <form
        className="panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const { error } = await db.auth.signInWithPassword({
              email,
              password,
            });
            if (error)
              setError("Unable to sign in. Check your email and password.");
          } catch {
            setError("Unable to reach authentication. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Your private workspace</h2>
        <p>
          Sign in with the account provided by your workspace administrator.
        </p>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
