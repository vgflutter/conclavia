"use client";

interface SpeechStartResponse {
  durationMs?: number;
  error?: string;
}

/**
 * Sends one complete PCM16 utterance to Unreal. Unreal now owns both audible
 * playback and facial inference, so audio and the MetaHuman face share the
 * same render clock instead of drifting between the browser and the GPU VM.
 */
export class UnrealSpeechPlayer {
  private operation?: AbortController;

  async activate(): Promise<void> {
    // Pixel Streaming owns the audible AudioContext. Keeping this method lets
    // the stage retain the same imperative contract as the LiveAvatar mode.
  }

  async speak(
    pcmBytes: ArrayBuffer,
    onStarted?: (durationMs: number) => void,
  ): Promise<void> {
    this.stopCurrent();
    const operation = new AbortController();
    this.operation = operation;
    const response = await fetch("/api/unreal/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcmBytes,
      signal: operation.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as SpeechStartResponse;
    if (!response.ok || typeof payload.durationMs !== "number") {
      throw new Error(payload.error || `Unreal speech HTTP ${response.status}`);
    }
    // Unreal primes the facial solver for 120 ms before starting audible
    // playback. Keep web direction on that same clock instead of labelling the
    // participant as speaking when the HTTP request is merely accepted.
    await abortableDelay(120, operation.signal);
    onStarted?.(payload.durationMs);
    // Leave only a short conversational breath after the final phoneme.
    await abortableDelay(payload.durationMs + 60, operation.signal);
    if (this.operation === operation) this.operation = undefined;
  }

  stopCurrent(): void {
    this.operation?.abort();
    this.operation = undefined;
  }

  async close(): Promise<void> {
    this.stopCurrent();
  }
}

function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Speech stopped", "AbortError"));
      },
      { once: true },
    );
  });
}
