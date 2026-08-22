/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { chromium } = require(
  process.env.CONCLAVIA_PLAYWRIGHT_PATH
    || "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const [playerUrl, controlUrl, outputDirectory] = process.argv.slice(2);
if (!playerUrl || !controlUrl || !outputDirectory) {
  throw new Error(
    "Usage: node Capture-ListeningPresence.cjs <player-url> <control-url> <output-directory>"
  );
}

async function postCue(payload) {
  const response = await fetch(`${controlUrl.replace(/\/$/u, "")}/director/cue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Cue failed (${response.status}): ${await response.text()}`);
  }
}

async function health() {
  const response = await fetch(`${controlUrl.replace(/\/$/u, "")}/health`);
  if (!response.ok) throw new Error(`Health failed (${response.status})`);
  return response.json();
}

(async () => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CONCLAVIA_CHROME_PATH
      || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  try {
    const page = await context.newPage();
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.mouse.click(960, 540).catch(() => undefined);
    await page.evaluate(() => {
      for (const videoElement of document.querySelectorAll("video")) {
        videoElement.muted = true;
        void videoElement.play().catch(() => undefined);
      }
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (candidate) => candidate.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && candidate.videoWidth >= 1920
          && candidate.videoHeight >= 1080
      ),
      undefined,
      { timeout: 90_000 }
    );
    const video = page.locator("video").first();

    await postCue({
      speakerId: "participant-1",
      speakerName: "Mary",
      shot: "close-up",
      intent: "listen",
      bodyGesture: "lower-hand",
      expectedDurationMs: 2_000,
      performanceBeats: [],
    });
    await page.waitForTimeout(2_000);
    await video.screenshot({ path: path.join(outputDirectory, "idle-0.jpg"), type: "jpeg", quality: 94 });
    const idleStartHealth = await health();
    await page.waitForTimeout(3_000);
    await video.screenshot({ path: path.join(outputDirectory, "idle-3.jpg"), type: "jpeg", quality: 94 });

    await postCue({
      speakerId: "participant-1",
      targetId: "meeting-participant",
      speakerName: "Mary",
      targetName: "Vincenzo",
      shot: "reaction",
      intent: "listen-react",
      bodyGesture: "none",
      listenerMood: "surprise",
      listenerMoodIntensity: 0.52,
      expectedDurationMs: 6_000,
      performanceBeats: [],
    });
    await page.waitForTimeout(1_200);
    const activeHealth = await health();
    await video.screenshot({ path: path.join(outputDirectory, "listening-active.jpg"), type: "jpeg", quality: 94 });
    await page.waitForTimeout(6_200);
    const settledHealth = await health();
    await video.screenshot({ path: path.join(outputDirectory, "listening-settled.jpg"), type: "jpeg", quality: 94 });

    const result = {
      ok: true,
      idle: {
        driver: idleStartHealth.bodyIdleDriver,
        playRate: idleStartHealth.bodyIdlePlayRate,
        gaze: idleStartHealth.naturalGazeEnabled,
      },
      listeningActive: {
        active: activeHealth.listeningReactionActive,
        modelReady: activeHealth.listeningModelReady,
        mood: activeHealth.commercialMood,
        intensity: activeHealth.commercialMoodIntensity,
        upperFace: activeHealth.commercialMaxUpperFaceControl,
        upperFaceControl: activeHealth.commercialMaxUpperFaceControlName,
      },
      listeningSettled: {
        active: settledHealth.listeningReactionActive,
        mood: settledHealth.commercialMood,
        intensity: settledHealth.commercialMoodIntensity,
      },
    };
    fs.writeFileSync(
      path.join(outputDirectory, "presence.json"),
      JSON.stringify(result, null, 2)
    );
    process.stdout.write(JSON.stringify(result));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
