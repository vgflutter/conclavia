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
    "Usage: node Audit-SingleHeroExpressions.cjs <player-url> <control-url> <pcm-path> <output-directory>"
  );
}

const baseControlUrl = controlUrl.replace(/\/$/u, "");
const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
const headers = authorization ? { Authorization: `Bearer ${authorization}` } : {};

async function requestJson(route, init = {}) {
  const response = await fetch(`${baseControlUrl}${route}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${route} failed (${response.status}): ${text}`);
  }
  return payload;
}

async function health() {
  return requestJson("/health", { headers });
}

async function cue(testCase) {
  return requestJson("/director/cue", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      speakerId: "participant-1",
      speakerName: "Expression Hero",
      shot: "close-up",
      intent: testCase.intent,
      expectedDurationMs: 8_000,
      performanceBeats: [{
        atMs: 0,
        mood: testCase.mood,
        intensity: testCase.intensity,
        focus: "camera",
        gesture: "none"
      }]
    })
  });
}

async function speak(pcm) {
  return requestJson("/audio/speech", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: pcm
  });
}

async function waitForSpeech(page, previousCount, testCase) {
  const samples = [];
  const video = page.locator("video").first();
  const deadline = Date.now() + 25_000;
  let observedActive = false;
  let bestUpperFace = -1;
  let peakFrame;

  while (Date.now() < deadline) {
    const sample = await health();
    samples.push({
      atMs: samples.length * 100,
      active: Boolean(sample.commercialSpeechActive),
      mood: sample.commercialMood,
      moodIntensity: Number(sample.commercialMoodIntensity || 0),
      targetIntensity: Number(sample.performanceTargetIntensity || 0),
      mouth: Number(sample.commercialMaxMouthControl || 0),
      upperFace: Number(sample.commercialMaxUpperFaceControl || 0),
      upperFaceControl: sample.commercialMaxUpperFaceControlName,
      appliedBeatCount: Number(sample.performanceAppliedBeatCount || 0)
    });
    observedActive ||= Boolean(sample.commercialSpeechActive);

    const upperFace = Number(sample.commercialMaxUpperFaceControl || 0);
    if (sample.commercialSpeechActive && upperFace > bestUpperFace) {
      bestUpperFace = upperFace;
      peakFrame = path.join(outputDirectory, `${testCase.id}-peak.jpg`);
      await video.screenshot({ path: peakFrame, type: "jpeg", quality: 96 });
    }

    if (
      observedActive
      && !sample.commercialSpeechActive
      && Number(sample.commercialCompletedSpeechCount || 0) > previousCount
    ) {
      return { final: sample, samples, peakFrame };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${testCase.id}.`);
}

(async () => {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const pcm = fs.readFileSync(pcmPath);
  const tests = [
    { id: "neutral", mood: "neutral", intensity: 0, intent: "argument" },
    { id: "confidence", mood: "confidence", intensity: 0.55, intent: "answer" },
    { id: "anger", mood: "anger", intensity: 0.62, intent: "challenge" }
  ];
  const browser = await chromium.launch({
    executablePath: process.env.CONCLAVIA_CHROME_PATH
      || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"]
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
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
          && video.videoWidth > 0
      ),
      undefined,
      { timeout: 90_000 }
    );

    const baseline = await health();
    if (!baseline.stageReady || !baseline.commercialLipSyncReady) {
      throw new Error(`Expression runtime is not ready: ${JSON.stringify(baseline)}`);
    }

    const results = [];
    let completedCount = Number(baseline.commercialCompletedSpeechCount || 0);
    for (const testCase of tests) {
      await cue(testCase);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const accepted = await speak(pcm);
      const result = await waitForSpeech(page, completedCount, testCase);
      completedCount = Number(result.final.commercialCompletedSpeechCount || 0);
      const activeSamples = result.samples.filter((sample) => sample.active);
      const appliedSample = [...activeSamples].reverse().find(
        (sample) => String(sample.mood || "").toLowerCase() === testCase.mood
      ) || activeSamples.at(-1) || result.samples.at(-1);
      results.push({
        ...testCase,
        accepted,
        peakFrame: result.peakFrame,
        appliedMood: appliedSample?.mood,
        appliedIntensity: Number(appliedSample?.moodIntensity || 0),
        appliedBeatCount: Math.max(
          0,
          ...result.samples.map((sample) => sample.appliedBeatCount)
        ),
        peakMouth: Math.max(0, ...activeSamples.map((sample) => sample.mouth)),
        peakUpperFace: Math.max(0, ...activeSamples.map((sample) => sample.upperFace)),
        upperFaceControls: [...new Set(
          activeSamples.map((sample) => sample.upperFaceControl).filter(Boolean)
        )],
        samples: result.samples
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    const expressive = results.filter((result) => result.id !== "neutral");
    const validation = {
      sameAudioAccepted: results.every((result) => result.accepted.ok !== false),
      allBeatsApplied: results.every((result) => result.appliedBeatCount >= 1),
      correctMoods: results.every(
        (result) => String(result.appliedMood || "").toLowerCase() === result.mood
      ),
      lipSyncPreserved: results.every((result) => result.peakMouth >= 0.12),
      upperFaceActive: expressive.every((result) => result.peakUpperFace >= 0.02),
      distinctUpperFaceResponse: new Set(
        expressive.flatMap((result) => result.upperFaceControls)
      ).size >= 2
    };
    const report = {
      ok: Object.values(validation).every(Boolean),
      validation,
      runtimeRevision: baseline.runtimeRevision,
      baselineMood: baseline.commercialMood,
      tests: results
    };
    fs.writeFileSync(
      path.join(outputDirectory, "expression-audit.json"),
      JSON.stringify(report, null, 2)
    );
    process.stdout.write(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
