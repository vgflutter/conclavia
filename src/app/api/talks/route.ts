import { NextResponse } from "next/server";

import { connectToDatabase } from "@/lib/mongodb";
import { serializeTalk } from "@/lib/serialize-talk";
import { validateTalkInput } from "@/lib/talk-validation";
import { TalkModel } from "@/models/Talk";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectToDatabase();
    const talks = await TalkModel.find().sort({ createdAt: -1 }).exec();

    return NextResponse.json({ talks: talks.map(serializeTalk) });
  } catch (error) {
    console.error("Unable to list talks", error);
    return NextResponse.json(
      { error: "Unable to load talks" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const result = validateTalkInput(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "The talk configuration is invalid", issues: result.issues },
      { status: 400 },
    );
  }

  try {
    await connectToDatabase();
    const talk = await TalkModel.create(result.data);

    return NextResponse.json({ talk: serializeTalk(talk) }, { status: 201 });
  } catch (error) {
    console.error("Unable to create talk", error);
    return NextResponse.json(
      { error: "Unable to save the talk" },
      { status: 500 },
    );
  }
}
