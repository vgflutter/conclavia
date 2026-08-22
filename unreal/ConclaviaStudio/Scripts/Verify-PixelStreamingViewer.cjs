/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const { chromium } = require(
  "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const playerUrl = process.argv[2];
const screenshotPath = process.argv[3];
const captureMode = process.argv[4] ?? "overscan";

if (!playerUrl || !screenshotPath) {
  throw new Error("Usage: node Verify-PixelStreamingViewer.cjs <player-url> <screenshot-path>");
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: [
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding"
    ]
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const browserErrors = [];

    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });

    const response = await page.goto(playerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("video")].some(
          (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0
        ),
      undefined,
      { timeout: 90_000 }
    );

    // MetaHuman preview actors assemble their material and groom graphs inside
    // the editor. Give those resources time to settle before judging the frame.
    await page.waitForTimeout(35_000);

    const video = await page.evaluate(() => {
      const element = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );

      return element
        ? {
            width: element.videoWidth,
            height: element.videoHeight,
            readyState: element.readyState,
            paused: element.paused,
            currentTime: element.currentTime
          }
        : null;
    });

    const frame = await page.evaluate((requestedCaptureMode) => {
      const element = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );
      if (!element) {
        throw new Error("Pixel Streaming video element disappeared before frame capture.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Unable to create a canvas context for frame verification.");
      }

      // Immersive editor streaming keeps a thin viewport toolbar in its
      // backbuffer. Packaged/game streaming does not: cropping that output
      // cuts into the channel bug and the subject's headroom.
      const cropTop = requestedCaptureMode === "overscan"
        ? Math.round(element.videoHeight * 0.05)
        : 0;
      const cropHeight = element.videoHeight - cropTop;
      const cropWidth = Math.round((cropHeight * 16) / 9);
      const cropX = Math.max(0, Math.round((element.videoWidth - cropWidth) / 2));
      context.drawImage(
        element,
        cropX,
        cropTop,
        Math.min(cropWidth, element.videoWidth),
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height
      );
      return canvas.toDataURL("image/jpeg", 0.92);
    }, captureMode);
    fs.writeFileSync(screenshotPath, Buffer.from(frame.split(",")[1], "base64"));
    await page.waitForTimeout(15_000);

    process.stdout.write(
      JSON.stringify({
        httpStatus: response?.status() ?? null,
        video,
        screenshotPath,
        browserErrors
      })
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
