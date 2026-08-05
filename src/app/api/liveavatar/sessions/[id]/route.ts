import { NextResponse } from "next/server";

import {
  LiveAvatarApiError,
  liveAvatarRequest,
} from "@/lib/liveavatar-server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(id)) {
    return NextResponse.json({ error: "LiveAvatar session not found" }, { status: 404 });
  }

  try {
    await liveAvatarRequest("/v1/sessions/stop", {
      method: "POST",
      body: JSON.stringify({
        session_id: id,
        reason: "USER_CLOSED",
      }),
    });
    return NextResponse.json({ stopped: true });
  } catch (error) {
    const status = error instanceof LiveAvatarApiError ? error.status : 502;
    console.error(`Unable to stop LiveAvatar session ${id}`, error);
    return NextResponse.json(
      { error: "Unable to stop the LiveAvatar session" },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
