/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require(
  "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const [playerUrl, screenshotPath] = process.argv.slice(2);
if (!playerUrl || !screenshotPath) {
  throw new Error("Usage: node Capture-ReviewFrame.cjs <player-url> <screenshot-path>");
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0
      ),
      undefined,
      { timeout: 90_000 }
    );
    await page.waitForTimeout(15_000);
    await page.evaluate(() => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );
      if (!video) throw new Error("Decoded Pixel Streaming video disappeared.");
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      video.style.position = "fixed";
      video.style.inset = "0";
      video.style.width = "100vw";
      video.style.height = "100vh";
      video.style.objectFit = "contain";
      video.style.background = "#020617";
      video.style.zIndex = "2147483647";
    });
    // Chromium can render hardware-decoded WebRTC textures correctly in the
    // compositor while canvas.drawImage sees an incomplete backing surface.
    // Capture the composed page, which is also what the Mac viewer displays.
    await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 94 });
    process.stdout.write(JSON.stringify({ ok: true, screenshotPath }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
