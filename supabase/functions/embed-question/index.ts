import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-retry-count, traceparent, tracestate, baggage",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });

  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  headers: Headers,
): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("Origin");
  const headers = corsHeaders(origin);

  if (origin && !allowedOrigins.has(origin)) {
    return jsonResponse({ error: "Origin not allowed" }, 403, headers);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    headers.set("Allow", "POST, OPTIONS");
    return jsonResponse({ error: "Method not allowed" }, 405, headers);
  }

  const authorization = request.headers.get("Authorization");
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!authorization || !bearerMatch) {
    return jsonResponse({ error: "Authentication required" }, 401, headers);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !openAiApiKey) {
    console.error("Missing required function secrets.");
    return jsonResponse({ error: "Server is not configured" }, 500, headers);
  }

  // Verify that the bearer token belongs to a real, signed-in Supabase user.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(
    bearerMatch[1],
  );

  if (userError || !userData.user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401, headers);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400, headers);
  }

  if (
    typeof body !== "object" || body === null || !("question" in body) ||
    typeof body.question !== "string"
  ) {
    return jsonResponse({ error: "Body must include a string question" }, 400, headers);
  }

  const question = body.question.trim();
  if (!question) {
    return jsonResponse({ error: "Question must not be empty" }, 400, headers);
  }
  if (question.length > 8_000) {
    return jsonResponse({ error: "Question is too long" }, 413, headers);
  }

  try {
    const openAiResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: question,
        encoding_format: "float",
      }),
    });

    if (!openAiResponse.ok) {
      console.error("OpenAI embedding request failed with status", openAiResponse.status);
      return jsonResponse({ error: "Embedding provider request failed" }, 502, headers);
    }

    const result = await openAiResponse.json();
    const embedding = result?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      console.error("OpenAI response did not contain an embedding.");
      return jsonResponse({ error: "Invalid embedding provider response" }, 502, headers);
    }

    return jsonResponse({ embedding }, 200, headers);
  } catch (error) {
    console.error("Embedding request failed:", error);
    return jsonResponse({ error: "Could not generate embedding" }, 502, headers);
  }
});
