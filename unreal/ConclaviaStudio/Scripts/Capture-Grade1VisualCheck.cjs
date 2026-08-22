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
    "Usage: node Capture-Grade1VisualCheck.cjs <player-url> <control-url> <output-directory>"
  );
}

const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
const headers = authorization ? { Authorization: `Bearer ${authorization}` } : {};

async function cue(shot) {
  const response = await fetch(`${controlUrl.replace(/\/$/u, "")}/director/cue`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      speakerId: "participant-1",
      speakerName: "Grade 1 Hero",
      shot,
      intent: shot === "wide" ? "opening" : "argument",
      expectedDurationMs: 8_000,
      performanceBeats: []
    })
  });
  if (!response.ok) {
    throw new Error(`Cue ${shot} failed (${response.status}): ${await response.text()}`);
  }
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
    await page.waitForTimeout(8_000);

    const video = page.locator("video").first();
    const shots = ["wide", "close-up", "three-quarter-left", "three-quarter-right"];
    for (const shot of shots) {
      await cue(shot);
      await page.waitForTimeout(1_500);
      await video.screenshot({
        path: path.join(outputDirectory, `shot-${shot}.jpg`),
        type: "jpeg",
        quality: 97
      });
    }
    fs.writeFileSync(
      path.join(outputDirectory, "visual-check.json"),
      JSON.stringify({ ok: true, shots }, null, 2)
    );
    process.stdout.write(JSON.stringify({ ok: true, outputDirectory, shots }));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
