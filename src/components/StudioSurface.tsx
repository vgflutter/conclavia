"use client";

import { forwardRef } from "react";

import {
  StudioStage,
  type StudioStageHandle,
  type StudioStageProps,
} from "@/components/StudioStage";
import { UnrealStudioStage } from "@/components/UnrealStudioStage";

export const StudioSurface = forwardRef<StudioStageHandle, StudioStageProps>(
  function StudioSurface(props, ref) {
    return props.talk.settings.videoMode === "unreal" ? (
      <UnrealStudioStage ref={ref} {...props} />
    ) : (
      <StudioStage ref={ref} {...props} />
    );
  },
);
