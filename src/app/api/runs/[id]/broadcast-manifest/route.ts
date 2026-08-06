import { Types } from "mongoose";

import { buildBroadcastMasterManifest } from "@/lib/broadcast-manifest";
import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalkRun } from "@/lib/serialize-talk-run";
import { TalkRunModel } from "@/models/TalkRun";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!Types.ObjectId.isValid(id)) {
    return Response.json({ error: "Talk run not found" }, { status: 404 });
  }

  await connectToDatabase();
  const document = await TalkRunModel.findById(id).exec();
  if (!document) {
    return Response.json({ error: "Talk run not found" }, { status: 404 });
  }

  const manifest = buildBroadcastMasterManifest(serializeTalkRun(document));
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="conclavia-${id}-broadcast-master.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
