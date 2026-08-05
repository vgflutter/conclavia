import { Types } from "mongoose";
import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { TalkModel } from "@/models/Talk";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Talk not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    const talk = await TalkModel.findById(id).exec();

    if (!talk) {
      return NextResponse.json({ error: "Talk not found" }, { status: 404 });
    }

    return NextResponse.json({ talk: serializeTalk(talk) });
  } catch (error) {
    console.error(`Unable to read talk ${id}`, error);
    return NextResponse.json(
      { error: "Unable to load the talk" },
      { status: 500 },
    );
  }
}
