/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const { chromium } = require(
  process.env.CONCLAVIA_PLAYWRIGHT_PATH
    || "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const [playerUrl, controlUrl, pcmPath, outputPath] = process.argv.slice(2);
if (!playerUrl || !controlUrl || !pcmPath || !outputPath) {
  throw new Error(
    "Usage: node Audit-PixelStreamingAudio.cjs <player-url> <control-url> <pcm-path> <output-path>"
  );
}

const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
const headers = authorization
  ? { Authorization: `Bearer ${authorization}` }
  : {};

async function speech() {
  const response = await fetch(`${controlUrl.replace(/\/$/u, "")}/audio/speech`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: fs.readFileSync(pcmPath)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Speech request failed (${response.status}): ${body}`);
  }
  return JSON.parse(body);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CONCLAVIA_CHROME_PATH
      || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      ...(process.env.CONCLAVIA_AUTOPLAY_OVERRIDE === "false"
        ? []
        : ["--autoplay-policy=no-user-gesture-required"])
    ]
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const browserErrors = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

    const response = await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.videoWidth > 0 && video.srcObject instanceof MediaStream
      ),
      undefined,
      { timeout: 90_000 }
    );

    const initialMediaState = await page.evaluate(() => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.srcObject instanceof MediaStream
      );
      const gate = document.querySelector("#conclavia-audio-gate");
      return video
        ? {
            muted: video.muted,
            volume: video.volume,
            paused: video.paused,
            readyState: video.readyState,
            gateVisible: gate?.getAttribute("data-visible") === "true"
          }
        : null;
    });

    // This is a real Playwright pointer action, so the browser treats the
    // following media play as user initiated even under strict autoplay rules.
    const gate = page.locator("#conclavia-audio-gate");
    if (await gate.isVisible().catch(() => false)) {
      await gate.click();
    } else {
      await page.mouse.click(640, 360);
    }
    const beforeSpeech = await page.evaluate(async () => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );
      if (!video || !(video.srcObject instanceof MediaStream)) {
        throw new Error("Decoded Pixel Streaming MediaStream is unavailable.");
      }
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

      return {
        muted: video.muted,
        volume: video.volume,
        paused: video.paused,
        readyState: video.readyState,
        audioContextState: context.state,
        audioTracks: video.srcObject.getAudioTracks().map((track) => ({
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings()
        }))
      };
    });

    const accepted = await speech();
    const durationMs = Number(accepted.durationMs || 5_000);
    const levels = [];
    const deadline = Date.now() + Math.min(15_000, durationMs + 1_500);
    while (Date.now() < deadline) {
      levels.push(await page.evaluate(() => {
        const audit = window.__conclaviaAudioAudit;
        if (!audit) return { rms: 0, peak: 0, state: "missing" };
        const samples = new Float32Array(audit.analyser.fftSize);
        audit.analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        let peak = 0;
        for (const sample of samples) {
          sum += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
        }
        return {
          rms: Math.sqrt(sum / samples.length),
          peak,
          state: audit.context.state
        };
      }));
      await page.waitForTimeout(50);
    }

    const maxRms = Math.max(0, ...levels.map((level) => level.rms));
    const maxPeak = Math.max(0, ...levels.map((level) => level.peak));
    const audibleSamples = levels.filter((level) => level.rms >= 0.001).length;
    const report = {
      ok: beforeSpeech.audioTracks.length > 0 && maxRms >= 0.001,
      httpStatus: response?.status() ?? null,
      initialMediaState,
      beforeSpeech,
      speech: accepted,
      maxRms,
      maxPeak,
      audibleSamples,
      sampleCount: levels.length,
      browserErrors
    };
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
