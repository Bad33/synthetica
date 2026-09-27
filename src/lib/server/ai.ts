import { GoogleGenerativeAI } from "@google/generative-ai";
import { ApiError } from "./http";
export const models = () => ({
  extraction: process.env.GEMINI_EXTRACTION_MODEL,
  qa: process.env.GEMINI_QA_MODEL || process.env.GEMINI_EXTRACTION_MODEL,
});
export async function generate(
  system: string,
  input: unknown,
  purpose: "extraction" | "qa",
): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  const model = models()[purpose];
  if (!key || !model)
    throw new ApiError(
      503,
      "AI analysis is not configured. Your saved sources are still available.",
    );
  const client = new GoogleGenerativeAI(key).getGenerativeModel(
    {
      model,
      systemInstruction: system,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: 8192,
      },
    },
    { timeout: 45_000 },
  );
  const result = await client.generateContent(JSON.stringify(input));
  try {
    return JSON.parse(result.response.text());
  } catch {
    throw new ApiError(
      502,
      "The model returned an invalid response. No unsupported answer was saved.",
    );
  }
}
