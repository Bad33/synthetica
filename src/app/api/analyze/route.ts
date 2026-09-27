import { z } from "zod";
import { authenticate, consumeQuota } from "@/lib/server/auth";
import { ApiError, failure, json, readJson } from "@/lib/server/http";
import { analysisSchema, validateClaims, type Chunk } from "@/lib/research";
import { generate } from "@/lib/server/ai";
import { extractionPrompt, PROMPT_VERSION } from "@/lib/prompts/research";
export const maxDuration = 60;
export async function POST(req: Request) {
  let context: Awaited<ReturnType<typeof authenticate>> | undefined;
  let paperId: string | undefined;
  try {
    const ctx = await authenticate(req);
    context = ctx;
    const input = z.object({ paperId: z.uuid() }).parse(await readJson(req));
    paperId = input.paperId;
    const { data: paper, error } = await ctx.db
      .from("research_papers")
      .select("id,coverage,analysis")
      .eq("id", paperId)
      .single();
    if (error || !paper) throw new ApiError(404, "Paper not found.");
    if (paper.analysis) return json({ analysis: paper.analysis, cached: true });
    await consumeQuota(ctx, "analyze");
    const { data, error: chunkError } = await ctx.db
      .from("paper_chunks")
      .select("*")
      .eq("paper_id", paperId)
      .order("ordinal");
    if (chunkError) throw chunkError;
    const chunks = (data ?? []) as Chunk[];
    // Analyze every passage within the document input bound, not a summary or excerpt.
    const parsed = analysisSchema.safeParse(
      await generate(
        extractionPrompt,
        { coverage: paper.coverage, passages: chunks },
        "extraction",
      ),
    );
    if (!parsed.success)
      throw new ApiError(502, "Analysis format was invalid. Please retry.");
    const claims = validateClaims(parsed.data.claims, chunks);
    if (!claims.length)
      throw new ApiError(
        422,
        "No source-verifiable claims were returned. The original passages are still available.",
      );
    const { error: saveError } = await ctx.db
      .from("research_papers")
      .update({
        analysis: { claims },
        analysis_status: "complete",
        prompt_version: PROMPT_VERSION,
      })
      .eq("id", paperId);
    if (saveError) throw saveError;
    return json({
      analysis: { claims },
      discardedClaims: parsed.data.claims.length - claims.length,
    });
  } catch (error) {
    if (
      context &&
      paperId &&
      !(error instanceof ApiError && [401, 404, 429].includes(error.status))
    ) {
      await context.db
        .from("research_papers")
        .update({ analysis_status: "failed" })
        .eq("id", paperId)
        .is("analysis", null);
    }
    return failure(error);
  }
}
