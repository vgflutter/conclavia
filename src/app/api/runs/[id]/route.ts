import { Types } from "mongoose";
import { NextResponse } from "next/server";

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
    return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
  }

  try {
    await connectToDatabase();
    let run = await TalkRunModel.findById(id).exec();
    if (!run) {
      return NextResponse.json({ error: "Talk run not found" }, { status: 404 });
    }

    const generationIsStale =
      run.status === "generating" &&
      (!run.generationStartedAt ||
        run.generationStartedAt.getTime() < Date.now() - 130_000);
    if (generationIsStale) {
      run =
        (await TalkRunModel.findOneAndUpdate(
          { _id: run._id, status: "generating" },
          {
            $set: {
              status: "failed",
              error: "The previous generation was interrupted and can be retried",
            },
            $unset: { generationStartedAt: 1, activeTurn: 1 },
          },
          { new: true },
        ).exec()) ?? run;
    }
    return NextResponse.json({ run: serializeTalkRun(run) });
  } catch (error) {
    console.error("Unable to load talk run", error);
    return NextResponse.json(
      { error: "Unable to load the talk run" },
      { status: 500 },
    );
  }
}
