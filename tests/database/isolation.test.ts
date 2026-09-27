import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "../../src/lib/server/ingestion";
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
let paper: string;
let chunks: ReturnType<typeof chunkDocument>["chunks"];
async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec("BEGIN; SET LOCAL ROLE authenticated;");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await run();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); GRANT USAGE ON SCHEMA auth,public TO authenticated,anon;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  INSERT INTO auth.users VALUES('${alice}'),('${bob}');`);
  // PGlite has gen_random_uuid built in; Supabase enables pgcrypto in 00001.
  const initial = (
    await readFile("supabase/migrations/00001_init_schema.sql", "utf8")
  ).replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', "");
  await db.exec(initial);
  // Simulate broad legacy grants and an undocumented security-definer graph RPC.
  await db.exec(
    `GRANT ALL ON public.papers TO anon, authenticated; CREATE FUNCTION public.get_graph_data() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'legacy' $$;`,
  );
  await db.exec(
    await readFile(
      "supabase/migrations/00002_source_grounded_workspace.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile("supabase/migrations/00003_atomic_collections.sql", "utf8"),
  );
});
after(async () => {
  await db.close();
});
test("fresh migration saves source and passages atomically, retaining Unicode provenance", async () => {
  const id = randomUUID();
  const doc = chunkDocument(
    [
      {
        title: "Method",
        page: 3,
        text: "😀 Original experimental results and limitations. ".repeat(70),
      },
    ],
    id,
  );
  chunks = doc.chunks;
  const document = {
    id,
    title: "Test source",
    source_kind: "text",
    coverage: "provided_text",
    source_text: doc.text,
    source_hash: doc.hash,
    authors: [],
  };
  paper = await asUser(
    alice,
    async () =>
      (
        await db.query<{ id: string }>(
          "SELECT public.save_research_source($1,$2) AS id",
          [document, chunks],
        )
      ).rows[0].id,
  );
  assert.equal(paper, id);
  await asUser(alice, async () => {
    assert.equal(
      (await db.query("SELECT * FROM public.paper_chunks")).rows.length,
      chunks.length,
    );
  });
  const duplicate = await asUser(
    alice,
    async () =>
      (
        await db.query<{ id: string }>(
          "SELECT public.save_research_source($1,$2) AS id",
          [{ ...document, id: randomUUID() }, chunks],
        )
      ).rows[0].id,
  );
  assert.equal(duplicate, paper);
});
test("second user cannot read or modify first user sources, passages, notes, or memberships", async () => {
  await asUser(bob, async () => {
    assert.equal(
      (await db.query("SELECT * FROM public.research_papers")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("SELECT * FROM public.paper_chunks")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "UPDATE public.research_papers SET analysis_status=$1 WHERE id=$2 RETURNING id",
          ["complete", paper],
        )
      ).rows.length,
      0,
    );
  });
  await assert.rejects(
    asUser(bob, () =>
      db.query(
        "INSERT INTO public.notes(owner_id,paper_id,content) VALUES($1,$2,$3)",
        [alice, paper, "stolen"],
      ),
    ),
    /row-level security/,
  );
  await assert.rejects(
    asUser(bob, () =>
      db.query(
        "INSERT INTO public.notes(owner_id,paper_id,content) VALUES($1,$2,$3)",
        [bob, paper, "stolen"],
      ),
    ),
    /foreign key/,
  );
  await assert.rejects(
    asUser(alice, () =>
      db.query("UPDATE public.paper_chunks SET text=$1", ["replacement"]),
    ),
    /permission denied/,
  );
});
test("invalid passage rolls back the whole source import", async () => {
  const id = randomUUID();
  const doc = chunkDocument(
    [
      {
        title: "Bad",
        page: null,
        text: "New original source for transaction rollback. ".repeat(10),
      },
    ],
    id,
  );
  await assert.rejects(
    asUser(alice, () =>
      db.query("SELECT public.save_research_source($1,$2)", [
        {
          id,
          title: "Bad",
          source_kind: "text",
          coverage: "provided_text",
          source_text: doc.text,
          source_hash: doc.hash,
          authors: [],
        },
        [{ ...doc.chunks[0], text: "Fabricated source" }],
      ]),
    ),
    /does not match/,
  );
  assert.equal(
    (await db.query("SELECT id FROM public.research_papers WHERE id=$1", [id]))
      .rows.length,
    0,
  );
});
test("collections save atomically and reject foreign-owned paper membership", async () => {
  const id = randomUUID();
  await asUser(alice, () =>
    db.query("SELECT public.save_research_collection($1,$2,$3,$4)", [
      id,
      "Methods",
      "What differs?",
      [paper],
    ]),
  );
  await assert.rejects(
    asUser(bob, () =>
      db.query("SELECT public.save_research_collection($1,$2,$3,$4)", [
        id,
        "Stolen",
        "",
        [paper],
      ]),
    ),
  );
  await assert.rejects(
    asUser(bob, () =>
      db.query("SELECT public.save_research_collection($1,$2,$3,$4)", [
        randomUUID(),
        "Wrong owner",
        "",
        [paper],
      ]),
    ),
    /foreign key/,
  );
  await asUser(alice, async () => {
    assert.equal(
      (await db.query("SELECT * FROM public.collection_papers")).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query<{ title: string }>(
          "SELECT title FROM public.collections WHERE id=$1",
          [id],
        )
      ).rows[0].title,
      "Methods",
    );
  });
});
test("notes must link to a passage from the same owner and paper", async () => {
  await asUser(alice, () =>
    db.query(
      "INSERT INTO public.notes(paper_id,chunk_id,content) VALUES($1,$2,$3)",
      [paper, chunks[0].id, "A source-linked observation"],
    ),
  );
  await asUser(bob, async () =>
    assert.equal((await db.query("SELECT * FROM public.notes")).rows.length, 0),
  );
  await assert.rejects(
    asUser(alice, () =>
      db.query(
        "INSERT INTO public.notes(paper_id,chunk_id,content) VALUES($1,$2,$3)",
        [paper, randomUUID(), "Wrong passage"],
      ),
    ),
    /foreign key/,
  );
});
test("hourly quota cannot be exceeded or reset through direct client writes", async () => {
  for (let i = 0; i < 12; i++) {
    const ok = await asUser(
      alice,
      async () =>
        (
          await db.query<{ ok: boolean }>(
            "SELECT public.consume_research_quota('analyze') AS ok",
          )
        ).rows[0].ok,
    );
    assert.equal(ok, i < 10);
  }
  await assert.rejects(
    asUser(alice, () => db.exec("DELETE FROM public.research_usage")),
    /permission denied/,
  );
  await assert.rejects(
    asUser(alice, () =>
      db.query("SELECT public.consume_research_quota('bogus')"),
    ),
    /Unknown action/,
  );
  await asUser(bob, async () =>
    assert.equal(
      (
        await db.query<{ ok: boolean }>(
          "SELECT public.consume_research_quota('analyze') AS ok",
        )
      ).rows[0].ok,
      true,
    ),
  );
});
test("legacy public table and graph function are inaccessible after migration", async () => {
  await db.exec("BEGIN; SET LOCAL ROLE anon;");
  await assert.rejects(
    db.query("SELECT * FROM public.papers"),
    /permission denied/,
  );
  await db.exec("ROLLBACK");
  await assert.rejects(
    asUser(alice, () => db.query("SELECT public.get_graph_data()")),
    /permission denied/,
  );
});
