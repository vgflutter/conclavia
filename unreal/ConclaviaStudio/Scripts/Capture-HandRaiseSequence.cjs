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
    "Usage: node Capture-HandRaiseSequence.cjs <player-url> <control-url> <output-directory>"
  );
}

async function cue(bodyGesture) {
  const response = await fetch(`${controlUrl.replace(/\/$/u, "")}/director/cue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      speakerId: "participant-1",
      targetId: "meeting-participant",
      speakerName: "Mary",
      shot: "wide",
      intent: bodyGesture === "raise-hand" ? "request-to-speak" : "settle",
      bodyGesture,
      expectedDurationMs: 8_000,
      performanceBeats: []
    })
  });
  if (!response.ok) {
    throw new Error(
      `Cue ${bodyGesture} failed (${response.status}): ${await response.text()}`
    );
  }
}

async function captureAfter(video, startedAt, targetMs, filename) {
  const waitMs = Math.max(0, targetMs - (Date.now() - startedAt));
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  await video.screenshot({
    path: path.join(outputDirectory, filename),
    type: "jpeg",
    quality: 96
  });
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
    await page.waitForTimeout(2_000);

    const video = page.locator("video").first();
    await cue("lower-hand");
    await page.waitForTimeout(2_000);
    await video.screenshot({
      path: path.join(outputDirectory, "00-idle.jpg"),
      type: "jpeg",
      quality: 96
    });

    await cue("raise-hand");
    const raiseStartedAt = Date.now();
    for (const targetMs of [120, 280, 480, 760, 1_100, 1_650, 2_400]) {
      await captureAfter(
        video,
        raiseStartedAt,
        targetMs,
        `raise-${String(targetMs).padStart(4, "0")}ms.jpg`
      );
    }

    await cue("lower-hand");
    const lowerStartedAt = Date.now();
    for (const targetMs of [120, 320, 620, 1_000, 1_600]) {
      await captureAfter(
        video,
        lowerStartedAt,
        targetMs,
        `lower-${String(targetMs).padStart(4, "0")}ms.jpg`
      );
    }

    fs.writeFileSync(
      path.join(outputDirectory, "sequence.json"),
      JSON.stringify({ ok: true, raiseFrames: 7, lowerFrames: 5 }, null, 2)
    );
    process.stdout.write(JSON.stringify({ ok: true, outputDirectory }));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
