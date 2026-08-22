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
    "Usage: node Capture-CommercialLipSyncAudit.cjs <player-url> <control-url> <pcm-path> <output-directory>"
  );
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

  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.videoWidth > 0
      ),
      undefined,
      { timeout: 90_000 }
    );
    await page.evaluate(() => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );
      if (!video) throw new Error("Decoded video disappeared.");
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

    await page.waitForTimeout(1_000);
    const pcm = fs.readFileSync(pcmPath);
    const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
    const controlHeaders = authorization
      ? { Authorization: `Bearer ${authorization}` }
      : {};
    const response = await fetch(`${controlUrl.replace(/\/$/u, "")}/audio/speech`, {
      method: "POST",
      headers: {
        ...controlHeaders,
        "Content-Type": "application/octet-stream"
      },
      body: pcm
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Speech request failed (${response.status}): ${responseText}`);
    }

    const frames = [];
    const healthSamples = [];
    for (let index = 0; index < 72; index += 1) {
      const framePath = path.join(
        outputDirectory,
        `frame-${String(index).padStart(2, "0")}.jpg`
      );
      await page.screenshot({ path: framePath, type: "jpeg", quality: 96 });
      frames.push(framePath);
      if (index === 6 || index === 18 || index === 36 || index === 54) {
        const healthResponse = await fetch(
          `${controlUrl.replace(/\/$/u, "")}/health`,
          { headers: controlHeaders }
        );
        healthSamples.push(await healthResponse.json());
      }
      await page.waitForTimeout(150);
    }

    const healthResponse = await fetch(
      `${controlUrl.replace(/\/$/u, "")}/health`,
      { headers: controlHeaders }
    );
    const health = await healthResponse.json();
    const activeSamples = healthSamples.filter(
      (sample) => sample.commercialSpeechActive
        && Number.isFinite(sample.commercialJawInput)
        && Number.isFinite(sample.commercialJawCurve)
    );
    const jawInputs = activeSamples.map((sample) => sample.commercialJawInput);
    const jawCurves = activeSamples.map((sample) => sample.commercialJawCurve);
    const maxTrackingError = activeSamples.reduce(
      (maximum, sample) => Math.max(
        maximum,
        Math.abs(sample.commercialJawInput - sample.commercialJawCurve)
      ),
      0
    );
    const validation = {
      passed: Boolean(
        health.commercialGeneratorBound
          && activeSamples.length >= 2
          && Math.max(...jawInputs, 0) >= 0.02
          && Math.max(...jawCurves, 0) >= 0.02
          && maxTrackingError <= 0.08
      ),
      activeSampleCount: activeSamples.length,
      maxJawInput: Math.max(...jawInputs, 0),
      maxJawCurve: Math.max(...jawCurves, 0),
      maxTrackingError
    };
    if (!validation.passed) {
      throw new Error(
        `Commercial lip-sync validation failed: ${JSON.stringify(validation)}`
      );
    }
    const result = {
      ok: true,
      validation,
      speech: JSON.parse(responseText),
      healthSamples,
      health,
      frames
    };
    fs.writeFileSync(
      path.join(outputDirectory, "audit.json"),
      JSON.stringify(result, null, 2)
    );
    process.stdout.write(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
