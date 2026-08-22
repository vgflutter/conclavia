"use client";

const TARGET_SAMPLE_RATE = 48_000;
const PROCESSOR_BUFFER_SIZE = 4_096;
const MAX_QUEUED_CHUNKS = 4;

export interface UnrealAudioBridgeMetrics {
  chunksSent: number;
  bytesSent: number;
  droppedChunks: number;
  lastError?: string;
}

export class UnrealAudioBridge {
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private sourceTrack?: MediaStreamTrack;
  private processor?: ScriptProcessorNode;
  private sink?: GainNode;
  private queue: ArrayBuffer[] = [];
  private sending = false;
  private metrics: UnrealAudioBridgeMetrics = {
    chunksSent: 0,
    bytesSent: 0,
    droppedChunks: 0,
  };

  async activate(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({
        latencyHint: "interactive",
        sampleRate: TARGET_SAMPLE_RATE,
      });
    }
    if (this.context.state === "suspended") await this.context.resume();
  }

  async follow(stream: MediaStream): Promise<void> {
    await this.activate();
    this.disconnectGraph();
    const context = this.context;
    if (!context) return;
    const liveTrack = stream
      .getAudioTracks()
      .find((track) => track.enabled && track.readyState === "live");
    if (!liveTrack) throw new Error("LiveAvatar audio track is not ready");

    this.sourceTrack = liveTrack.clone();
    this.source = context.createMediaStreamSource(
      new MediaStream([this.sourceTrack]),
    );
    this.processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    this.sink = context.createGain();
    this.sink.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm =
        context.sampleRate === TARGET_SAMPLE_RATE
          ? new Float32Array(input)
          : resample(input, context.sampleRate, TARGET_SAMPLE_RATE);
      const payload = new ArrayBuffer(pcm.byteLength);
      new Float32Array(payload).set(pcm);
      this.enqueue(payload);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(context.destination);
  }

  pause(): void {
    this.disconnectGraph();
    this.queue = [];
  }

  async close(): Promise<void> {
    this.pause();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
  }

  snapshot(): UnrealAudioBridgeMetrics {
    return { ...this.metrics };
  }

  private disconnectGraph(): void {
    if (this.processor) this.processor.onaudioprocess = null;
    this.sourceTrack?.stop();
    this.source?.disconnect();
    this.processor?.disconnect();
    this.sink?.disconnect();
    this.source = undefined;
    this.sourceTrack = undefined;
    this.processor = undefined;
    this.sink = undefined;
  }

  private enqueue(chunk: ArrayBuffer): void {
    if (this.queue.length >= MAX_QUEUED_CHUNKS) {
      this.queue.shift();
      this.metrics.droppedChunks += 1;
    }
    this.queue.push(chunk);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length > 0) {
        const chunk = this.queue.shift();
        if (!chunk) continue;
        const response = await fetch("/api/unreal/audio", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        });
        if (!response.ok) throw new Error(`PCM bridge HTTP ${response.status}`);
        this.metrics.chunksSent += 1;
        this.metrics.bytesSent += chunk.byteLength;
        this.metrics.lastError = undefined;
      }
    } catch (error) {
      this.queue = [];
      this.metrics.lastError =
        error instanceof Error ? error.message : "PCM bridge failed";
    } finally {
      this.sending = false;
    }
  }
}

function resample(
  source: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  const length = Math.max(1, Math.round(source.length * targetRate / sourceRate));
  const result = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const lower = Math.min(source.length - 1, Math.floor(position));
    const upper = Math.min(source.length - 1, lower + 1);
    const mix = position - lower;
    result[index] = source[lower] * (1 - mix) + source[upper] * mix;
  }
  return result;
}
