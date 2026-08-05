import { NextResponse } from "next/server";

import { advanceTalkRun, AdvanceTalkRunError } from "@/lib/advance-talk-run";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    return NextResponse.json({
      run: await advanceTalkRun(id, {}, { signal: request.signal }),
    });
  } catch (error) {
    if (error instanceof AdvanceTalkRunError) {
      return NextResponse.json(
        { error: error.message, run: error.run, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Unable to generate the next intervention" },
      { status: 500 },
    );
  }
}
