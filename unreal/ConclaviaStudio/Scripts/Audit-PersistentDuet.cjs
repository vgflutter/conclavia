/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const { chromium } = require(
  process.env.CONCLAVIA_PLAYWRIGHT_PATH
    || "C:/PixelStreamingInfrastructure/node_modules/playwright"
);

const [playerUrl, controlUrl, aeraPcm, adaPcm, outputDirectory] =
  process.argv.slice(2);
if (!playerUrl || !controlUrl || !aeraPcm || !adaPcm || !outputDirectory) {
  throw new Error(
    "Usage: node Audit-PersistentDuet.cjs <player-url> <control-url> <aera-pcm> <ada-pcm> <output-directory>"
  );
}

const baseControlUrl = controlUrl.replace(/\/$/u, "");
const authorization = process.env.CONCLAVIA_CONTROL_TOKEN;
const controlHeaders = authorization
  ? { Authorization: `Bearer ${authorization}` }
  : {};

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${url} failed (${response.status}): ${text}`);
  }
  return payload;
}

async function health() {
  return requestJson(`${baseControlUrl}/health`, { headers: controlHeaders });
}

async function cue(speakerIndex, shot, intent) {
  return requestJson(`${baseControlUrl}/director/cue`, {
    method: "POST",
    headers: { ...controlHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      speakerId: `participant-${speakerIndex + 1}`,
      targetId: `participant-${(speakerIndex === 0 ? 1 : 0) + 1}`,
      speakerName: speakerIndex === 0 ? "Aera" : "Ada",
      targetName: speakerIndex === 0 ? "Ada" : "Aera",
      shot,
      intent,
      expectedDurationMs: 5_000
    })
  });
}

async function speak(pcmPath) {
  return requestJson(`${baseControlUrl}/audio/speech`, {
    method: "POST",
    headers: { ...controlHeaders, "Content-Type": "application/octet-stream" },
    body: fs.readFileSync(pcmPath)
  });
}

async function measureVideoLuma(page) {
  return page.evaluate(() => {
    const video = [...document.querySelectorAll("video")].find(
      (candidate) => candidate.videoWidth > 0
    );
    if (!video) return 0;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let luminance = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      luminance += pixels[index] * 0.2126
        + pixels[index + 1] * 0.7152
        + pixels[index + 2] * 0.0722;
    }
    return luminance / (canvas.width * canvas.height * 255);
  });
}

async function waitForSpeechFinished(previousCount, page, framePath) {
  const samples = [];
  const deadline = Date.now() + 15_000;
  let observedActive = false;
  let bestVisibleMouthControl = 0;
  let capturedFrameLuma = 0;
  while (Date.now() < deadline) {
    const sample = await health();
    samples.push(sample);
    observedActive ||= Boolean(sample.commercialSpeechActive);
    const visibleMouthControl = Number(sample.commercialMaxMouthControl || 0);
    if (sample.commercialSpeechActive && visibleMouthControl > bestVisibleMouthControl) {
      bestVisibleMouthControl = visibleMouthControl;
      await page.screenshot({ path: framePath, type: "jpeg", quality: 96 });
      capturedFrameLuma = await measureVideoLuma(page);
    }
    if (
      observedActive
      && !sample.commercialSpeechActive
      && sample.commercialCompletedSpeechCount > previousCount
    ) {
      return { final: sample, samples, capturedFrameLuma };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for persistent-duet speech completion.");
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
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    await page.goto(playerUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll("video")].some(
        (video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          && video.videoWidth > 0
      ),
      undefined,
      { timeout: 90_000 }
    );
    const playerSurface = await page.evaluate(() => {
      const video = [...document.querySelectorAll("video")].find(
        (candidate) => candidate.videoWidth > 0
      );
      if (!video) return { fillsViewport: false, visibleControls: -1 };
      const rect = video.getBoundingClientRect();
      const visibleControls = [...document.querySelectorAll(
        "button, input, select, [role='button']"
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || 1) > 0
          && bounds.width > 0
          && bounds.height > 0;
      }).length;
      return {
        fillsViewport: rect.width >= window.innerWidth * 0.95
          && rect.height >= window.innerHeight * 0.95,
        visibleControls
      };
    });
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
      video.style.objectFit = "cover";
      video.style.background = "#020617";
      video.style.zIndex = "2147483647";
    });

    const baseline = await health();
    const utterances = [
      { speaker: 0, pcm: aeraPcm, shot: "three-quarter-left", intent: "question moodConfusion" },
      { speaker: 1, pcm: adaPcm, shot: "profile-right", intent: "reply moodExcitement" },
      { speaker: 0, pcm: aeraPcm, shot: "two-shot", intent: "challenge moodAnger" },
      { speaker: 1, pcm: adaPcm, shot: "three-quarter-right", intent: "partial_agreement moodHappiness" }
    ];
    const results = [];
    let completedCount = Number(baseline.commercialCompletedSpeechCount || 0);

    for (let index = 0; index < utterances.length; index += 1) {
      const utterance = utterances[index];
      await cue(utterance.speaker, utterance.shot, utterance.intent);
      await new Promise((resolve) => setTimeout(resolve, 260));
      const acceptedAt = Date.now();
      const speech = await speak(utterance.pcm);
      const framePath = path.join(
        outputDirectory,
        `speaker-${utterance.speaker + 1}-turn-${index + 1}.jpg`
      );
      const { final, samples, capturedFrameLuma } = await waitForSpeechFinished(
        completedCount,
        page,
        framePath
      );
      completedCount = final.commercialCompletedSpeechCount;
      results.push({
        speaker: utterance.speaker,
        speech,
        wallTimeMs: Date.now() - acceptedAt,
        final,
        peakMouthDuringSpeech: Math.max(
          0,
          ...samples.map((sample) => Number(sample.commercialSpeechPeakMouthControl || 0))
        ),
        peakUpperFaceDuringSpeech: Math.max(
          0,
          ...samples.map((sample) => Number(sample.commercialSpeechPeakUpperFaceControl || 0))
        ),
        capturedFrameLuma,
        framePath
      });
    }

    const final = await health();
    const validation = {
      runtimeV13: String(final.runtimeRevision || "").includes("v13-visible-duet"),
      cleanPlayerSurface: playerSurface.fillsViewport
        && playerSurface.visibleControls === 0,
      allCameraFramesVisible: results.every(
        (result) => Number(result.capturedFrameLuma || 0) >= 0.025
      ),
      persistentGenerators: final.commercialGeneratorCount === 2
        && final.commercialGeneratorBound === true,
      allMouthPeaksHealthy: results.every(
        (result) => Number(result.final.commercialLastSpeechPeakMouthControl || 0) >= 0.12
      ),
      allUpperFacePeaksHealthy: results.every(
        (result) => Number(result.final.commercialLastSpeechPeakUpperFaceControl || 0) >= 0.02
      ),
      allSolverFeedsComplete: results.every(
        (result) => Number(result.final.commercialLastSpeechSolverChunks || 0) >= 20
      ),
      alternatingFaces: results.every(
        (result) => result.final.activeFaceIndex === result.speaker
      ),
      handoffsObserved: Number(final.speakerHandoffCount || 0)
        - Number(baseline.speakerHandoffCount || 0) >= 3,
      cuesObserved: Number(final.cameraCueCount || 0)
        - Number(baseline.cameraCueCount || 0) >= utterances.length
    };
    const passed = Object.values(validation).every(Boolean);
    const report = { ok: passed, validation, baseline, final, results };
    fs.writeFileSync(
      path.join(outputDirectory, "audit.json"),
      JSON.stringify(report, null, 2)
    );
    process.stdout.write(JSON.stringify(report));
    if (!passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(error.stack ?? String(error));
  process.exitCode = 1;
});
