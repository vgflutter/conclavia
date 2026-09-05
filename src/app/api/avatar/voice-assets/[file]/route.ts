const MODEL_REVISION = "3cadd1ee6394adea1bd021217a0e650ede09a323";
const MODEL_ROOT = `https://huggingface.co/Supertone/supertonic-3/resolve/${MODEL_REVISION}`;
const ALLOWED_FILES = new Set([
  "duration_predictor.onnx",
  "text_encoder.onnx",
  "vector_estimator.onnx",
  "vocoder.onnx",
  "tts.json",
  "unicode_indexer.json",
  "M1.json",
  "M3.json",
]);

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  if (!ALLOWED_FILES.has(file)) {
    return new Response("Not found", { status: 404 });
  }

  const folder = file.endsWith(".onnx") || file === "tts.json" || file === "unicode_indexer.json"
    ? "onnx"
    : "voice_styles";
  const source = `${MODEL_ROOT}/${folder}/${file}`;

  try {
    const upstream = await fetch(source, {
      redirect: file.endsWith(".onnx") ? "manual" : "follow",
      cache: "force-cache",
    });

    if (file.endsWith(".onnx") && upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (!location) return new Response("Voice unavailable", { status: 502 });
      return Response.redirect(location, 302);
    }

    if (!upstream.ok || !upstream.body) {
      return new Response("Voice unavailable", { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Cache-Control": "public, max-age=86400, immutable",
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      },
    });
  } catch {
    return new Response("Voice unavailable", { status: 502 });
  }
}
