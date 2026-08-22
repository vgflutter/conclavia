/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { chromium } = require(
  process.env.CONCLAVIA_PLAYWRIGHT_PATH
    || "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const [playerUrl, outputDirectory] = process.argv.slice(2);
if (!playerUrl || !outputDirectory) {
  throw new Error(
    "Usage: node Verify-SingleHeroReadiness.cjs <player-url> <output-directory>"
  );
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

(async () => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CONCLAVIA_CHROME_PATH
      || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  try {
    const page = await context.newPage();
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.videoWidth >= 1920
          && video.videoHeight >= 1080
      ),
      undefined,
      { timeout: 90_000 }
    );

    // Connecting the streamer is not the same as having a presentable hero.
    // Keep the private verifier attached while groom resources, texture mips,
    // shaders and TSR history settle. The public player is mounted only after
    // this gate has passed and this peer has disconnected.
    await page.waitForTimeout(15_000);

    const frames = await page.evaluate(async () => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth >= 1920
      );
      if (!video) throw new Error("The 1080p decoded video disappeared.");

      const fullCanvas = document.createElement("canvas");
      fullCanvas.width = 120;
      fullCanvas.height = 68;
      const fullContext = fullCanvas.getContext("2d", { willReadFrequently: true });
      const heroCanvas = document.createElement("canvas");
      heroCanvas.width = 72;
      heroCanvas.height = 36;
      const heroContext = heroCanvas.getContext("2d", { willReadFrequently: true });
      if (!fullContext || !heroContext) {
        throw new Error("Canvas sampling is unavailable.");
      }

      const result = [];
      let previousFull;
      let previousHero;
      const startedAt = performance.now();
      await new Promise((resolve) => {
        const sample = (now, metadata) => {
          fullContext.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
          // The front benchmark camera keeps head and groom in the central
          // upper 60% of the frame. A late groom load changes this region by
          // orders of magnitude more than a blink or idle micro-motion.
          heroContext.drawImage(
            video,
            video.videoWidth * 0.2,
            0,
            video.videoWidth * 0.6,
            video.videoHeight * 0.57,
            0,
            0,
            heroCanvas.width,
            heroCanvas.height
          );
          const full = fullContext.getImageData(
            0,
            0,
            fullCanvas.width,
            fullCanvas.height
          ).data;
          const hero = heroContext.getImageData(
            0,
            0,
            heroCanvas.width,
            heroCanvas.height
          ).data;

          const normalizedDelta = (current, previous) => {
            if (!previous) return 0;
            let total = 0;
            let samples = 0;
            for (let index = 0; index < current.length; index += 16) {
              total += Math.abs(current[index] - previous[index]);
              total += Math.abs(current[index + 1] - previous[index + 1]);
              total += Math.abs(current[index + 2] - previous[index + 2]);
              samples += 3;
            }
            return total / (samples * 255);
          };

          result.push({
            now,
            mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames,
            fullDelta: normalizedDelta(full, previousFull),
            heroDelta: normalizedDelta(hero, previousHero)
          });
          previousFull = new Uint8ClampedArray(full);
          previousHero = new Uint8ClampedArray(hero);
          if (now - startedAt >= 12_000) {
            resolve();
            return;
          }
          video.requestVideoFrameCallback(sample);
        };
        video.requestVideoFrameCallback(sample);
      });
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        frames: result
      };
    });

    const intervals = frames.frames.slice(1).map(
      (frame, index) =>
        (frame.mediaTime - frames.frames[index].mediaTime) * 1_000
    );
    const fullDeltas = frames.frames.slice(1).map((frame) => frame.fullDelta);
    const heroDeltas = frames.frames.slice(1).map((frame) => frame.heroDelta);
    const duration = frames.frames.length > 1
      ? frames.frames.at(-1).mediaTime - frames.frames[0].mediaTime
      : 0;
    const decodedFps = duration > 0
      ? (frames.frames.length - 1) / duration
      : 0;
    const report = {
      ok:
        frames.width >= 1920
        && frames.height >= 1080
        && decodedFps >= 27
        // At the 30 fps broadcast target, one delayed presentation interval
        // can legitimately span two frame periods (66.7 ms). Reject actual
        // stalls through the separate >=100 ms hard-gap gate instead of
        // killing an otherwise healthy stream for a 52 ms scheduling jitter.
        && percentile(intervals, 0.95) <= 67
        && intervals.filter((value) => value >= 100).length <= 1
        && percentile(heroDeltas, 0.99) <= 0.12,
      width: frames.width,
      height: frames.height,
      decodedFrameCount: frames.frames.length,
      decodedFps,
      intervalMedianMs: percentile(intervals, 0.5),
      intervalP95Ms: percentile(intervals, 0.95),
      intervalMaxMs: Math.max(0, ...intervals),
      hardGapCount: intervals.filter((value) => value >= 100).length,
      fullDeltaP99: percentile(fullDeltas, 0.99),
      fullDeltaMax: Math.max(0, ...fullDeltas),
      heroDeltaP99: percentile(heroDeltas, 0.99),
      heroDeltaMax: Math.max(0, ...heroDeltas)
    };

    await page.locator("video").first().screenshot({
      path: path.join(outputDirectory, "single-hero-ready.jpg"),
      type: "jpeg",
      quality: 96
    });
    fs.writeFileSync(
      path.join(outputDirectory, "single-hero-readiness.json"),
      JSON.stringify(report, null, 2)
    );
    process.stdout.write(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
