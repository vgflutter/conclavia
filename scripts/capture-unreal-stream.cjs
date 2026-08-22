#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS audit script */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

const [playerUrl, outputPath] = process.argv.slice(2);
if (!playerUrl || !outputPath) {
  throw new Error("Usage: capture-unreal-stream.cjs <player-url> <output.png>");
}

const chromePath = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9223 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "conclavia-chrome-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu-sandbox",
  "--autoplay-policy=no-user-gesture-required",
  "--window-size=1920,1080",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getPageTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (response) => response.json(),
      );
      const target = targets.find(
        (candidate) => candidate.type === "page",
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {
      // Chrome is still starting.
    }
    await wait(250);
  }
  throw new Error("Chrome DevTools did not expose the Pixel Streaming page.");
}

async function main() {
  const target = await getPageTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  const browserLogs = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.method === "Runtime.consoleAPICalled") {
      browserLogs.push({
        type: message.params?.type,
        timestamp: message.params?.timestamp,
        args: (message.params?.args || []).map((argument) => (
          argument.value ?? argument.description ?? argument.type
        )),
      });
    } else if (message.method === "Runtime.exceptionThrown") {
      browserLogs.push({
        type: "exception",
        timestamp: message.params?.timestamp,
        text: message.params?.exceptionDetails?.text,
        exception: message.params?.exceptionDetails?.exception?.description,
      });
    } else if (message.method === "Log.entryAdded") {
      browserLogs.push({
        type: message.params?.entry?.level,
        timestamp: message.params?.entry?.timestamp,
        source: message.params?.entry?.source,
        text: message.params?.entry?.text,
      });
    }
    if (!message.id) return;
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const NativeRTCPeerConnection = window.RTCPeerConnection;
      window.__conclaviaPeerConnections = [];
      window.__conclaviaRtcEvents = [];
      const record = (peerIndex, event, details = {}) => {
        window.__conclaviaRtcEvents.push({
          elapsedMs: Math.round(performance.now()),
          peerIndex,
          event,
          ...details,
        });
      };
      window.RTCPeerConnection = class extends NativeRTCPeerConnection {
        constructor(...args) {
          super(...args);
          const peerIndex = window.__conclaviaPeerConnections.length;
          window.__conclaviaPeerConnections.push(this);
          record(peerIndex, 'created', { configuration: args[0] || null });
          this.addEventListener('connectionstatechange', () => record(
            peerIndex,
            'connectionstatechange',
            { state: this.connectionState },
          ));
          this.addEventListener('iceconnectionstatechange', () => record(
            peerIndex,
            'iceconnectionstatechange',
            { state: this.iceConnectionState },
          ));
          this.addEventListener('icegatheringstatechange', () => record(
            peerIndex,
            'icegatheringstatechange',
            { state: this.iceGatheringState },
          ));
          this.addEventListener('signalingstatechange', () => record(
            peerIndex,
            'signalingstatechange',
            { state: this.signalingState },
          ));
          this.addEventListener('track', (event) => record(
            peerIndex,
            'track',
            { kind: event.track?.kind, readyState: event.track?.readyState },
          ));
          this.addEventListener('icecandidate', (event) => record(
            peerIndex,
            'icecandidate',
            {
              candidate: event.candidate?.candidate || null,
              url: event.candidate?.url || null,
            },
          ));
          this.addEventListener('icecandidateerror', (event) => record(
            peerIndex,
            'icecandidateerror',
            {
              address: event.address,
              port: event.port,
              url: event.url,
              errorCode: event.errorCode,
              errorText: event.errorText,
            },
          ));
        }
      };
    })();`,
  });
  await send("Page.navigate", { url: playerUrl });
  await wait(1_000);
  await send("Runtime.evaluate", {
    expression: `(() => {
      const start = [...document.querySelectorAll('button, div')].find(
        (element) => element.textContent?.trim() === 'CLICK TO START'
      );
      (start || document.elementFromPoint(innerWidth / 2, innerHeight / 2))?.click();
      document.body.click();
      return true;
    })()`,
    userGesture: true,
  });

  let videoReady = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await send("Runtime.evaluate", {
      expression: `(() => {
        const video = [...document.querySelectorAll('video')].find(
          (element) => element.videoWidth > 0 && element.readyState >= 2
        );
        if (!video) return false;
        document.body.style.margin = '0';
        document.body.style.overflow = 'hidden';
        document.querySelectorAll('#controls, #connection').forEach(
          (element) => { element.style.display = 'none'; }
        );
        video.style.position = 'fixed';
        video.style.inset = '0';
        video.style.width = '100vw';
        video.style.height = '100vh';
        video.style.objectFit = 'contain';
        video.style.zIndex = '2147483647';
        return true;
      })()`,
      returnByValue: true,
    });
    if (result.result?.value === true) {
      videoReady = true;
      break;
    }
    await wait(500);
  }
  if (!videoReady) {
    const diagnosticResult = await send("Runtime.evaluate", {
      expression: `(async () => {
        const peerConnections = window.__conclaviaPeerConnections || [];
        const peers = [];
        for (const peerConnection of peerConnections) {
          const report = await peerConnection.getStats();
          const stats = [];
          report.forEach((entry) => {
            if (![
              'transport',
              'candidate-pair',
              'local-candidate',
              'remote-candidate',
              'inbound-rtp',
              'remote-inbound-rtp',
              'codec',
            ].includes(entry.type)) return;
            stats.push({ ...entry });
          });
          peers.push({
            connectionState: peerConnection.connectionState,
            iceConnectionState: peerConnection.iceConnectionState,
            iceGatheringState: peerConnection.iceGatheringState,
            signalingState: peerConnection.signalingState,
            receivers: peerConnection.getReceivers().map((receiver) => ({
              kind: receiver.track?.kind,
              readyState: receiver.track?.readyState,
              muted: receiver.track?.muted,
            })),
            stats,
          });
        }
        return {
          href: location.href,
          peerCount: peerConnections.length,
          rtcEvents: window.__conclaviaRtcEvents || [],
          peers,
          videos: [...document.querySelectorAll('video')].map((video) => ({
            readyState: video.readyState,
            networkState: video.networkState,
            paused: video.paused,
            muted: video.muted,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            currentTime: video.currentTime,
            hasSourceObject: Boolean(video.srcObject),
          })),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const diagnosticPath = `${outputPath}.diagnostics.json`;
    fs.writeFileSync(
      diagnosticPath,
      `${JSON.stringify({
        ...(diagnosticResult.result?.value || {}),
        browserLogs,
      }, null, 2)}\n`,
    );
    throw new Error(
      `Pixel Streaming video did not decode in time. Diagnostics: ${diagnosticPath}`,
    );
  }

  const recordMs = Number.parseInt(
    process.env.CONCLAVIA_RECORD_MS || "0",
    10,
  );
  if (Number.isFinite(recordMs) && recordMs > 0) {
    const recording = await send("Runtime.evaluate", {
      expression: `(async () => {
        const video = [...document.querySelectorAll('video')].find(
          (element) => element.videoWidth > 0 && element.srcObject instanceof MediaStream
        );
        if (!video) throw new Error('Decoded MediaStream is unavailable.');
        video.muted = false;
        video.defaultMuted = false;
        video.volume = 1;
        await video.play();
        const mimeType = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
        const chunks = [];
        const recorder = new MediaRecorder(video.srcObject, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 6_000_000,
          audioBitsPerSecond: 128_000,
        });
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        const stopped = new Promise((resolve) => {
          recorder.addEventListener('stop', resolve, { once: true });
        });
        recorder.start(250);
        await new Promise((resolve) => setTimeout(resolve, ${recordMs}));
        recorder.stop();
        await stopped;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return { base64: btoa(binary), mimeType: blob.type, size: blob.size };
      })()`,
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
    });
    const payload = recording.result?.value;
    if (!payload?.base64) {
      throw new Error("Pixel Streaming recording did not produce media.");
    }
    fs.writeFileSync(outputPath, Buffer.from(payload.base64, "base64"));
    socket.close();
    return;
  }

  const captureDelayMs = Number.parseInt(
    process.env.CONCLAVIA_CAPTURE_DELAY_MS || "1200",
    10,
  );
  const resolvedCaptureDelayMs = Number.isFinite(captureDelayMs)
    ? captureDelayMs
    : 1_200;
  const auditAudio = process.env.CONCLAVIA_AUDIT_AUDIO === "1";
  const audioSamples = [];
  if (auditAudio) {
    await send("Runtime.evaluate", {
      expression: `(async () => {
        const video = [...document.querySelectorAll('video')].find(
          (element) => element.videoWidth > 0 && element.srcObject instanceof MediaStream
        );
        if (!video) throw new Error('Decoded MediaStream is unavailable.');
        video.muted = false;
        video.defaultMuted = false;
        video.volume = 1;
        await video.play();
        const context = new AudioContext();
        await context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        const source = context.createMediaStreamSource(video.srcObject);
        source.connect(analyser);
        window.__conclaviaAudioAudit = { context, analyser, source };
        return true;
      })()`,
      awaitPromise: true,
      userGesture: true,
    });
    const deadline = Date.now() + resolvedCaptureDelayMs;
    while (Date.now() < deadline) {
      const sample = await send("Runtime.evaluate", {
        expression: `(() => {
          const audit = window.__conclaviaAudioAudit;
          if (!audit) return { rms: 0, peak: 0, state: 'missing' };
          const values = new Float32Array(audit.analyser.fftSize);
          audit.analyser.getFloatTimeDomainData(values);
          let sum = 0;
          let peak = 0;
          for (const value of values) {
            sum += value * value;
            peak = Math.max(peak, Math.abs(value));
          }
          return {
            rms: Math.sqrt(sum / values.length),
            peak,
            state: audit.context.state,
          };
        })()`,
        returnByValue: true,
      });
      audioSamples.push(sample.result?.value || { rms: 0, peak: 0 });
      await wait(50);
    }
  } else {
    await wait(resolvedCaptureDelayMs);
  }
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
  if (auditAudio) {
    const maxRms = Math.max(0, ...audioSamples.map((sample) => sample.rms || 0));
    const maxPeak = Math.max(0, ...audioSamples.map((sample) => sample.peak || 0));
    fs.writeFileSync(
      `${outputPath}.audio.json`,
      `${JSON.stringify({
        ok: maxRms >= 0.001,
        maxRms,
        maxPeak,
        audibleSampleCount: audioSamples.filter(
          (sample) => (sample.rms || 0) >= 0.001,
        ).length,
        sampleCount: audioSamples.length,
      }, null, 2)}\n`,
    );
  }
  socket.close();
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    chrome.kill("SIGTERM");
    await wait(500);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Chrome may still be releasing its profile. It lives in the OS temp
      // directory and can be collected safely after this audit process exits.
    }
  });
