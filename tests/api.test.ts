import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { POST as ingest } from "../src/app/api/ingest/route";
import { POST as analyze } from "../src/app/api/analyze/route";
import { POST as chat } from "../src/app/api/chat/route";
import { POST as synthesize } from "../src/app/api/synthesize/route";
import { POST as retired } from "../src/app/api/process-paper/route";
import { GET as cron } from "../src/app/api/cron/fetch-daily/route";
const originalFetch = globalThis.fetch;
const paperId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_EXTRACTION_MODEL = "test-model";
function req(input: unknown, token = true) {
  return new Request("https://app.test/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer user-token" } : {}),
    },
    body: JSON.stringify(input),
  });
}
const sourceText =
  "The method achieved 84.3% accuracy on dataset A. This result has not been replicated.";
const passage = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  paper_id: paperId,
  section: "Results",
  page: 7,
  ordinal: 0,
  text: sourceText,
  start_offset: 0,
  end_offset: sourceText.length,
};
const claim = {
  area: "Key findings",
  kind: "source_fact",
  text: sourceText,
  citations: [{ chunkId: passage.id, quote: sourceText }],
};
let calls: string[] = [];
function mock(
  options: {
    denied?: boolean;
    quota?: boolean;
    missing?: boolean;
    model?: unknown;
    badProvider?: boolean;
  } = {},
) {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/auth/v1/user")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer user-token",
      );
      return options.denied
        ? Response.json({ message: "invalid JWT" }, { status: 401 })
        : Response.json({
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "reader@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = String(init?.body);
      assert.ok(
        body.includes(sourceText),
        "model must receive original source",
      );
      assert.ok(!body.includes("FABRICATED_CLIENT_SUMMARY"));
      if (options.badProvider)
        return Response.json(
          { error: { message: "PRIVATE_PROVIDER_ERROR" } },
          { status: 500 },
        );
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify(
                    options.model ?? { status: "supported", claims: [claim] },
                  ),
                },
              ],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      });
    }
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer user-token",
      "database calls use caller identity",
    );
    if (url.includes("/rpc/consume_research_quota"))
      return Response.json(options.quota ?? true);
    if (url.includes("/research_papers"))
      return Response.json(
        options.missing
          ? null
          : { id: paperId, coverage: "provided_text", analysis: null },
      );
    if (url.includes("/paper_chunks")) return Response.json([passage]);
    if (url.includes("/chat_messages"))
      return new Response(init?.method === "POST" ? null : "[]", {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    throw new Error(`Unexpected fetch: ${url}`);
  };
}
afterEach(() => {
  globalThis.fetch = originalFetch;
});
test("all expensive endpoints reject anonymous callers before reading input or contacting providers", async () => {
  globalThis.fetch = async () => {
    throw new Error("Must not call external services");
  };
  for (const route of [ingest, analyze, chat, synthesize])
    assert.equal((await route(req({}, false))).status, 401);
});
test("invalid JWT cannot consume quota or request generation", async () => {
  mock({ denied: true });
  assert.equal(
    (await chat(req({ paperId, question: "What accuracy?" }))).status,
    401,
  );
  assert.equal(calls.length, 1);
});
test("chat rejects client-supplied summary and history instead of trusting it as evidence", async () => {
  mock();
  const result = await chat(
    req({
      paperId,
      question: "Accuracy?",
      paperContent: "FABRICATED_CLIENT_SUMMARY",
      chatHistory: [],
    }),
  );
  assert.equal(result.status, 400);
  assert.equal(calls.length, 1);
});
test("a foreign or unavailable paper returns 404 before quota or model use", async () => {
  mock({ missing: true });
  assert.equal(
    (await chat(req({ paperId, question: "What accuracy?" }))).status,
    404,
  );
  assert.ok(!calls.some((c) => c.includes("consume_research_quota")));
});
test("exhausted quota returns 429 and never calls model", async () => {
  mock({ quota: false });
  const result = await chat(req({ paperId, question: "What accuracy?" }));
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("Retry-After"), "3600");
  assert.ok(!calls.some((c) => c.includes("generativelanguage")));
});
test("chat retrieves original passages and returns exact source citations", async () => {
  mock();
  const result = await chat(
    req({ paperId, question: "What accuracy was reported?" }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.answer.claims[0].citations[0].quote, sourceText);
  assert.equal(body.passages[0].page, 7);
});
test("hallucinated citations are discarded, yielding an unavailable answer", async () => {
  mock({
    model: {
      status: "supported",
      claims: [
        {
          ...claim,
          citations: [
            { chunkId: passage.id, quote: "The accuracy was 99.9%." },
          ],
        },
      ],
    },
  });
  const result = await chat(req({ paperId, question: "What accuracy?" }));
  assert.equal((await result.json()).answer.status, "unavailable");
});
test("no retrieval matches produces an unavailable answer without model cost", async () => {
  mock();
  const result = await chat(
    req({ paperId, question: "Chemotherapy survival?" }),
  );
  assert.equal((await result.json()).answer.status, "unavailable");
  assert.ok(!calls.some((c) => c.includes("generativelanguage")));
});
test("provider errors are not reflected into client responses", async () => {
  mock({ badProvider: true });
  const result = await chat(req({ paperId, question: "What accuracy?" }));
  assert.equal(result.status, 500);
  assert.ok(!(await result.text()).includes("PRIVATE_PROVIDER_ERROR"));
});
test("legacy cron and processing cannot incur model cost", async () => {
  globalThis.fetch = async () => {
    throw new Error("Unexpected network call");
  };
  assert.equal((await cron()).status, 410);
  assert.equal((await retired()).status, 410);
});
test("synthesis refuses a single paper repeated under multiple selections", async () => {
  mock();
  const result = await synthesize(
    req({
      paperIds: [paperId, paperId],
      question: "Compare accuracy results.",
    }),
  );
  assert.equal(result.status, 400);
  assert.equal(calls.length, 1);
});
test("analysis drops invented values rather than persisting an ungrounded result", async () => {
  mock({
    model: { claims: [{ ...claim, text: "The reported accuracy is 99.9%." }] },
  });
  const result = await analyze(req({ paperId }));
  assert.equal(result.status, 422);
});
