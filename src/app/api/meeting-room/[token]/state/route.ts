import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { MeetingModel } from "@/models/Meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "Meeting output not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const meeting = await MeetingModel.findOne({ "bot.outputToken": token })
      .select("status commandHistory pendingIntervention")
      .exec();
    if (!meeting) {
      return NextResponse.json({ error: "Meeting output not found" }, { status: 404 });
    }

    const latest = meeting.commandHistory.at(-1);
    const pending = meeting.pendingIntervention &&
      meeting.pendingIntervention.expiresAt.getTime() > Date.now()
      ? {
          id: meeting.pendingIntervention.id,
          type: meeting.pendingIntervention.type,
        }
      : undefined;
    return NextResponse.json(
      {
        status: meeting.status,
        pendingIntervention: pending,
        command: latest
          ? {
              id: latest.id,
              kind: latest.kind,
              response: latest.response,
            }
          : undefined,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Meeting output unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
