import { test, expect } from "@playwright/test";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const chunkId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "11111111-1111-4111-8111-111111111111";
const text =
  "In this experiment, the method achieved 84.3% accuracy on dataset A. The authors report that the findings need independent replication.";
const claim = {
  area: "Overview",
  kind: "source_fact",
  text,
  citations: [{ chunkId, quote: text }],
};
const chunk = {
  id: chunkId,
  paper_id: id,
  section: "Results",
  page: 7,
  ordinal: 0,
  text,
  start_offset: 0,
  end_offset: text.length,
};
test("sign in, import, inspect evidence, ask, save a note, export, and create an investigation", async ({
  page,
}) => {
  const paper = {
    id,
    owner_id: userId,
    title: "Evidence-first evaluation",
    identifier: "test-paper",
    source_url: null,
    authors: ["A. Researcher"],
    published: "2025",
    venue: "Test venue",
    source_kind: "text",
    coverage: "provided_text",
    source_text: text,
    source_hash: "a".repeat(64),
    analysis: null as { claims: (typeof claim)[] } | null,
    analysis_status: "pending",
    created_at: new Date().toISOString(),
    reading_status: "unread",
    tags: [],
  };
  const notes: object[] = [];
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 200, headers });
    let data: unknown = [];
    if (url.pathname.includes("/auth/v1/token")) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, exp, role: "authenticated" })).toString("base64url")}.signature`;
      data = {
        access_token: token,
        refresh_token: "test-refresh",
        expires_in: 3600,
        expires_at: exp,
        token_type: "bearer",
        user: {
          id: userId,
          email: "reader@example.test",
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      };
    } else if (url.pathname.endsWith("/research_papers"))
      data = request.headers()["accept"]?.includes("vnd.pgrst.object")
        ? paper
        : [paper];
    else if (url.pathname.endsWith("/paper_chunks")) data = [chunk];
    else if (url.pathname.endsWith("/notes")) {
      if (request.method() === "POST") {
        const note = {
          id: "note-1",
          created_at: new Date().toISOString(),
          ...request.postDataJSON(),
        };
        notes.push(note);
        data = note;
      } else data = notes;
    } else if (url.pathname.endsWith("/save_research_collection"))
      data = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
  });
  await page.route("**/api/ingest", (route) =>
    route.fulfill({ json: { id, stages: { sections: 1, passages: 1 } } }),
  );
  await page.route("**/api/analyze", (route) => {
    paper.analysis = { claims: [claim] };
    return route.fulfill({ json: { analysis: paper.analysis } });
  });
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      json: {
        answer: { status: "supported", claims: [claim] },
        passages: [chunk],
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your private workspace" }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("reader@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password-for-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What are you trying to understand?" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Analyze a paper" }).click();
  await page.getByRole("button", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Original source text").fill(text);
  await page
    .getByRole("button", { name: "Save source and open workspace" })
    .click();
  await expect(
    page.getByRole("heading", { name: paper.title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Analyze source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show source passage [1]", exact: true })
    .click();
  await expect(page.getByText("Results · Page 7")).toBeVisible();
  await page
    .getByRole("button", { name: "Quote in notebook", exact: true })
    .click();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByText("Linked to Results", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Your research question")
    .fill("What accuracy was reported?");
  await page.getByRole("button", { name: "Ask with source citations" }).click();
  await expect(page.locator(".user-question")).toHaveText(
    "What accuracy was reported?",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export research brief" }).click();
  expect((await download).suggestedFilename()).toBe("research-brief.md");
  await page.getByRole("button", { name: "Side by side", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Original passages" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/reader-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/reader-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Investigate", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Evidence evaluation");
  await page
    .getByLabel("Research question", { exact: true })
    .fill("How do methods compare?");
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: "Save investigation", exact: true })
    .click();
  await expect(
    page.getByText("Investigation saved.", { exact: true }),
  ).toBeVisible();
});
