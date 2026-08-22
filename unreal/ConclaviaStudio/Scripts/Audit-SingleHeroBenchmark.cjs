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
    "Usage: node Audit-SingleHeroBenchmark.cjs <player-url> <control-url> <pcm-path> <output-directory>"
  );
}

const baseControlUrl = controlUrl.replace(/\/$/u, "");
const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
const headers = authorization ? { Authorization: `Bearer ${authorization}` } : {};

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

async function controlJson(route) {
  const response = await fetch(`${baseControlUrl}${route}`, { headers });
  if (!response.ok) {
    throw new Error(`${route} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function controlPostJson(route, body) {
  const response = await fetch(`${baseControlUrl}${route}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${route} failed (${response.status}): ${await response.text()}`);
  }
  return response.json().catch(() => ({ ok: true }));
}

(async () => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const pcm = fs.readFileSync(pcmPath);
  const browser = await chromium.launch({
    executablePath: process.env.CONCLAVIA_CHROME_PATH
      || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  try {
    const page = await context.newPage();
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // The stock UE 5.6 player can still show its CLICK TO START gate even with
    // AutoConnect in the URL. Exercise that real user path explicitly instead
    // of depending on a query-string autoplay detail that PowerShell may
    // consume when this audit is launched through Systems Manager.
    await page.waitForTimeout(750);
    const startButton = page.getByText("CLICK TO START", { exact: true });
    if (await startButton.count()) {
      await startButton.first().click({ force: true }).catch(() => undefined);
    } else {
      await page.mouse.click(960, 540);
    }
    await page.evaluate(() => {
      for (const video of document.querySelectorAll("video")) {
        video.muted = true;
        void video.play().catch(() => undefined);
      }
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.videoWidth >= 1920
          && video.videoHeight >= 1080
      ),
      undefined,
      { timeout: 90_000 }
    );

    const initialHealth = await controlJson("/health");
    if (
      initialHealth.castCount !== 1
      || initialHealth.cameraCount !== 3
      || initialHealth.grade1SetReady !== true
      || !String(initialHealth.runtimeRevision || "").includes("grade1-hero-56-v4")
      || !initialHealth.commercialLipSyncReady
    ) {
      throw new Error(
        `Benchmark renderer is not the ready Grade 1 revision: ${JSON.stringify({
          castCount: initialHealth.castCount,
          cameraCount: initialHealth.cameraCount,
          grade1SetReady: initialHealth.grade1SetReady,
          ready: initialHealth.commercialLipSyncReady,
          revision: initialHealth.runtimeRevision
        })}`
      );
    }

    const measurement = page.evaluate(async () => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth >= 1920
      );
      if (!video) throw new Error("The decoded benchmark video disappeared.");
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 54;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas sampling is unavailable.");
      const frames = [];
      let previous;
      const startedAt = performance.now();
      let lastCallbackAt = startedAt;
      let maxCallbackSilenceMs = 0;
      await new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearInterval(watchdog);
          resolve();
        };
        // requestVideoFrameCallback deliberately stops firing when the remote
        // track freezes. A wall-clock watchdog turns that failure into audit
        // data instead of leaving the SSM command and the billable GPU stuck.
        const watchdog = window.setInterval(() => {
          const wallNow = performance.now();
          maxCallbackSilenceMs = Math.max(
            maxCallbackSilenceMs,
            wallNow - lastCallbackAt
          );
          if (wallNow - startedAt >= 125_000) finish();
        }, 250);
        const sample = (now, metadata) => {
          if (finished) return;
          lastCallbackAt = performance.now();
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let delta = 0;
          if (previous) {
            let samples = 0;
            for (let index = 0; index < pixels.length; index += 16) {
              delta += Math.abs(pixels[index] - previous[index]);
              delta += Math.abs(pixels[index + 1] - previous[index + 1]);
              delta += Math.abs(pixels[index + 2] - previous[index + 2]);
              samples += 3;
            }
            delta /= samples * 255;
          }
          previous = new Uint8ClampedArray(pixels);
          frames.push({
            now,
            mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames,
            delta
          });
          if (now - startedAt >= 120_000) {
            finish();
            return;
          }
          video.requestVideoFrameCallback(sample);
        };
        video.requestVideoFrameCallback(sample);
      });
      return {
        frames,
        elapsedWallMs: performance.now() - startedAt,
        maxCallbackSilenceMs
      };
    });

    const screenshots = (async () => {
      const video = page.locator("video").first();
      for (let index = 0; index < 8; index += 1) {
        await page.waitForTimeout(15_000);
        await video.screenshot({
          path: path.join(outputDirectory, `minute-${String(index).padStart(2, "0")}.jpg`),
          type: "jpeg",
          quality: 94
        });
      }
    })();

    const speechRuns = (async () => {
      const results = [];
      const shots = [
        "wide",
        "close-up",
        "three-quarter-left",
        "three-quarter-right"
      ];
      for (let index = 0; index < 4; index += 1) {
        await controlPostJson("/director/cue", {
          speakerId: "participant-1",
          speakerName: "Grade 1 Hero",
          shot: shots[index],
          intent: index === 0 ? "opening" : "argument",
          expectedDurationMs: 12_000,
          performanceBeats: []
        });
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        await page.locator("video").first().screenshot({
          path: path.join(outputDirectory, `shot-${shots[index]}.jpg`),
          type: "jpeg",
          quality: 96
        });
        const response = await fetch(`${baseControlUrl}/audio/speech`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/octet-stream" },
          body: pcm
        });
        if (!response.ok) {
          throw new Error(
            `Speech ${index + 1} failed (${response.status}): ${await response.text()}`
          );
        }
        results.push(await response.json().catch(() => ({ ok: true })));
        await new Promise((resolve) => setTimeout(resolve, 28_000));
      }
      return results;
    })();

    const [measurementResult, speechResults] = await Promise.all([
      measurement,
      speechRuns,
      screenshots
    ]).then(([frameResult, speechResult]) => [frameResult, speechResult]);
    const frames = measurementResult.frames;
    const finalHealth = await controlJson("/health");
    const intervals = frames.slice(1).map(
      (frame, index) => (frame.mediaTime - frames[index].mediaTime) * 1_000
    );
    const deltas = frames.slice(1).map((frame) => frame.delta);
    const duration = frames.length > 1
      ? frames.at(-1).mediaTime - frames[0].mediaTime
      : 0;
    const decodedFps = duration > 0 ? (frames.length - 1) / duration : 0;
    const completedSpeechDelta =
      Number(finalHealth.commercialCompletedSpeechCount || 0)
      - Number(initialHealth.commercialCompletedSpeechCount || 0);
    const report = {
      ok:
        frames.length >= 3_200
        && decodedFps >= 27
        && percentile(intervals, 0.95) <= 50
        && intervals.filter((value) => value >= 100).length <= 12
        && measurementResult.maxCallbackSilenceMs <= 2_000
        && percentile(deltas, 0.99) <= 0.12
        && finalHealth.castCount === 1
        && finalHealth.cameraCount === 3
        && finalHealth.grade1SetReady === true
        && completedSpeechDelta >= 4
        && Number(finalHealth.commercialLastSpeechPeakMouthControl || 0) >= 0.15
        && Number(finalHealth.commercialLastSpeechPeakUpperFaceControl || 0) >= 0.10,
      durationSeconds: duration,
      measurementWallSeconds: measurementResult.elapsedWallMs / 1_000,
      maxCallbackSilenceMs: measurementResult.maxCallbackSilenceMs,
      decodedFrameCount: frames.length,
      decodedFps,
      intervalMedianMs: percentile(intervals, 0.5),
      intervalP95Ms: percentile(intervals, 0.95),
      intervalMaxMs: Math.max(0, ...intervals),
      hardGapCount: intervals.filter((value) => value >= 100).length,
      visualDeltaP99: percentile(deltas, 0.99),
      visualDeltaMax: Math.max(0, ...deltas),
      runtimeRevision: finalHealth.runtimeRevision,
      castCount: finalHealth.castCount,
      cameraCount: finalHealth.cameraCount,
      cameraPackage: finalHealth.cameraPackage,
      grade1SetReady: finalHealth.grade1SetReady,
      grade1PropCount: finalHealth.grade1PropCount,
      completedSpeechDelta,
      lastSpeechPeakMouthControl:
        Number(finalHealth.commercialLastSpeechPeakMouthControl || 0),
      lastSpeechPeakUpperFaceControl:
        Number(finalHealth.commercialLastSpeechPeakUpperFaceControl || 0),
      speechRequests: speechResults.length
    };
    fs.writeFileSync(
      path.join(outputDirectory, "single-hero-benchmark.json"),
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
