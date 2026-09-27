// The old endpoint accepted untrusted summaries and incurred unauthenticated AI cost.
export async function POST() {
  return Response.json(
    {
      error:
        "This endpoint has been retired. Use authenticated /api/ingest, then /api/analyze.",
    },
    { status: 410 },
  );
}
