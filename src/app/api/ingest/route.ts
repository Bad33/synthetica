import { randomUUID } from "node:crypto";
import { authenticate, consumeQuota } from "@/lib/server/auth";
import { failure, json, readJson } from "@/lib/server/http";
import {
  chunkDocument,
  ingestSchema,
  parseInput,
} from "@/lib/server/ingestion";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req);
    const input = ingestSchema.parse(await readJson(req, 4_300_000));
    await consumeQuota(ctx, "ingest");
    const source = await parseInput(input);
    const id = randomUUID();
    const { chunks, text, hash } = chunkDocument(source.sections, id);
    const { data, error } = await ctx.db.rpc("save_research_source", {
      document: {
        id,
        title: source.title,
        identifier: source.identifier,
        source_url: source.url,
        authors: source.authors,
        published: source.published,
        venue: source.venue,
        source_kind: source.kind,
        coverage: source.coverage,
        source_text: text,
        source_hash: hash,
      },
      passages: chunks,
    });
    if (error) throw error;
    return json({
      id: data,
      stages: {
        retrieved: true,
        parsed: true,
        sections: source.sections.length,
        passages: chunks.length,
        saved: true,
      },
      coverage: source.coverage,
    });
  } catch (error) {
    return failure(error);
  }
}
