/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { chromium } = require(
  process.env.CONCLAVIA_PLAYWRIGHT_PATH
    || "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const [playerUrl, controlUrl, pcmPath, outputDirectory] = process.argv.slice(2);
if (!playerUrl || !controlUrl || !pcmPath || !outputDirectory) {
  throw new Error(
    "Usage: node Audit-ContinuousAnimation.cjs <player-url> <control-url> <pcm-path> <output-directory>"
  );
}

const baseControlUrl = controlUrl.replace(/\/$/u, "");
const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
const headers = authorization ? { Authorization: `Bearer ${authorization}` } : {};
const shouldRecordVideo = process.env.CONCLAVIA_RECORD_VIDEO === "1";

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

(async () => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CONCLAVIA_CHROME_PATH
      || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ...(shouldRecordVideo
      ? {
          recordVideo: {
            dir: outputDirectory,
            size: { width: 1920, height: 1080 }
          }
        }
      : {})
  });

  try {
    const page = await context.newPage();
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.videoWidth > 0
      ),
      undefined,
      { timeout: 90_000 }
    );

    const measurement = page.evaluate(async () => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );
      if (!video) throw new Error("Decoded video disappeared.");
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 54;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas sampling is unavailable.");

      const frames = [];
      let previousPixels;
      const startedAt = performance.now();
      await new Promise((resolve) => {
        const sample = (now, metadata) => {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
          ).data;
          let delta = 0;
          if (previousPixels) {
            for (let index = 0; index < pixels.length; index += 16) {
              delta += Math.abs(pixels[index] - previousPixels[index]);
              delta += Math.abs(pixels[index + 1] - previousPixels[index + 1]);
              delta += Math.abs(pixels[index + 2] - previousPixels[index + 2]);
            }
            delta /= (pixels.length / 16) * 3 * 255;
          }
          previousPixels = new Uint8ClampedArray(pixels);
          frames.push({
            now,
            mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames,
            delta
          });
          if (now - startedAt >= 9_000) {
            resolve();
            return;
          }
          video.requestVideoFrameCallback(sample);
        };
        video.requestVideoFrameCallback(sample);
      });
      return frames;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const speechResponse = await fetch(`${baseControlUrl}/audio/speech`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: fs.readFileSync(pcmPath)
    });
    if (!speechResponse.ok) {
      throw new Error(`Speech failed (${speechResponse.status}): ${await speechResponse.text()}`);
    }

    const timelineCapture = shouldRecordVideo
      ? (async () => {
          const frameDirectory = path.join(outputDirectory, "timeline");
          fs.mkdirSync(frameDirectory, { recursive: true });
          const video = page.locator("video").first();
          for (let index = 0; index < 18; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 450));
            await video.screenshot({
              path: path.join(frameDirectory, `${String(index).padStart(2, "0")}.jpg`),
              type: "jpeg",
              quality: 92
            });
          }
        })()
      : Promise.resolve();

    const frames = await measurement;
    await timelineCapture;
    const frameIntervals = frames.slice(1).map(
      (frame, index) => (frame.mediaTime - frames[index].mediaTime) * 1_000
    );
    const visualDeltas = frames.slice(1).map((frame) => frame.delta);
    const duration = frames.length > 1
      ? frames.at(-1).mediaTime - frames[0].mediaTime
      : 0;
    const report = {
      ok: frames.length >= 180 && percentile(frameIntervals, 0.95) <= 50,
      decodedFrameCount: frames.length,
      decodedFps: duration > 0 ? (frames.length - 1) / duration : 0,
      intervalMedianMs: percentile(frameIntervals, 0.5),
      intervalP95Ms: percentile(frameIntervals, 0.95),
      intervalMaxMs: Math.max(0, ...frameIntervals),
      visualDeltaMedian: percentile(visualDeltas, 0.5),
      visualDeltaP95: percentile(visualDeltas, 0.95),
      visualDeltaMax: Math.max(0, ...visualDeltas),
      hardGapCount: frameIntervals.filter((value) => value >= 80).length,
      frames
    };
    await page.screenshot({
      path: path.join(outputDirectory, "continuous-final.jpg"),
      type: "jpeg",
      quality: 96
    });
    fs.writeFileSync(
      path.join(outputDirectory, "continuous-audit.json"),
      JSON.stringify(report, null, 2)
    );
    const recordedVideo = shouldRecordVideo ? page.video() : null;
    await page.close();
    if (recordedVideo) {
      await recordedVideo.saveAs(path.join(outputDirectory, "continuous.webm"));
    }
    const summary = Object.fromEntries(
      Object.entries(report).filter(([key]) => key !== "frames")
    );
    process.stdout.write(JSON.stringify(summary));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
