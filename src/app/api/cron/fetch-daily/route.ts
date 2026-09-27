// Autonomous ingestion is paused while source quality is established.
export async function GET() {
  return Response.json(
    {
      error:
        "Autonomous ingestion is disabled. Import a source from your private workspace.",
    },
    { status: 410 },
  );
}
