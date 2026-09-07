import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  attendeeTranscript,
  parseAttendeeWebhook,
  signAttendeeWebhookPayload,
  verifyAttendeeWebhook,
} from "../../src/lib/attendee-webhook";
import {
  detectElementaryArithmetic,
  meetingPermissionDecision,
  parseMeetingVoiceCommand,
} from "../../src/lib/meeting-command";
import { parseRecallOutputTranscript } from "../../src/lib/recall-transcript";

const teamLink =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_conclavia-e2e%40thread.v2/0?context=%7B%7D";
const appOrigin = "http://127.0.0.1:3101";

function futureLocalDateTime(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1_000);
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

async function useItalian(page: Page) {
  await page.context().addCookies([
    {
      name: "conclavia_locale",
      value: "it",
      url: appOrigin,
    },
  ]);
}

async function waitForClientReady(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((button) =>
      Object.keys(button).some((key) => key.startsWith("__reactProps$")),
    ),
  );
}

async function safeDelete(
  request: APIRequestContext,
  resource: "meetings" | "meeting-series",
  id: string | undefined,
) {
  if (!id) return;
  const response = await request.delete(`/api/${resource}/${id}`);
  expect([200, 404]).toContain(response.status());
}

test("meeting singolo: creazione, comandi, memoria e cancellazione", async ({
  page,
  request,
}) => {
  await useItalian(page);
  const marker = Date.now().toString(36);
  const title = `E2E Meeting ${marker}`;
  const objective = `Validare il flusso verticale ${marker}`;
  const rememberedFact = `La release ${marker} è fissata al 15 ottobre`;
  let meetingId: string | undefined;
  let outputToken: string | undefined;
  let assistantName = "Conclavia";
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await test.step("crea il meeting dalla schermata cliente", async () => {
      const avatarResponse = await request.get("/api/avatar");
      const avatarPayload = (await avatarResponse.json()) as {
        profile: { displayName: string };
      };
      assistantName = avatarPayload.profile.displayName;
      await page.goto("/meetings/new");
      await waitForClientReady(page);
      await expect(
        page.getByRole("heading", { name: "Prepara il collega digitale" }),
      ).toBeVisible();

      await page.getByLabel("Titolo del meeting").fill(title);
      await page.getByLabel("Obiettivo del meeting").fill(objective);
      await page.getByPlaceholder("Es. Approvare la roadmap").fill("Confermare la roadmap");
      await page.getByLabel("Link Microsoft Teams").fill(teamLink);
      await expect(page.getByRole("button", { name: /Entra ora/ })).toHaveCount(0);
      await page.getByLabel("Data e ora").fill(futureLocalDateTime(3));

      const automaticJoin = page.getByRole("checkbox", {
        name: /Programma l.ingresso automatico/,
      });
      await expect(automaticJoin).toHaveCount(0);

      await page.getByRole("button", { name: "Memorizza meeting" }).click();
      await page.waitForURL(/\/meetings\/[a-f0-9]{24}$/);
      meetingId = page.url().match(/\/meetings\/([a-f0-9]{24})$/)?.[1];
      expect(meetingId).toBeTruthy();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByText("Confermare la roadmap")).toBeVisible();

      const meetingResponse = await request.get(`/api/meetings/${meetingId}`);
      expect(meetingResponse.ok()).toBeTruthy();
      const meetingPayload = (await meetingResponse.json()) as {
        meeting: { assistant: { wakeWord: string }; bot: { outputToken: string } };
      };
      outputToken = meetingPayload.meeting.bot.outputToken;
      expect(meetingPayload.meeting.assistant.wakeWord).toBe(assistantName);
      await expect(page.getByText(`“${assistantName}…”`)).toBeVisible();
      const outputResponse = await request.get(
        `/api/meeting-room/${outputToken}/state`,
      );
      expect(outputResponse.ok()).toBeTruthy();
      expect(Object.keys(await outputResponse.json()).sort()).toEqual(["status"]);

      const protectedTranscript = await request.post(
        `/api/meeting-room/${outputToken}/transcript`,
        { data: { speakerName: "E2E", text: "Conclavia riepiloga" } },
      );
      expect(protectedTranscript.status()).toBe(409);
    });

    await test.step("rende disponibile la superficie dell’avatar", async () => {
      expect(outputToken).toBeTruthy();
      const outputPage = await page.context().newPage();
      try {
        await outputPage.goto(`/meeting-room/${outputToken}`);
        await expect(outputPage.locator("svg[data-gesture='rest']")).toBeVisible();

        await expect(outputPage.getByText(assistantName, { exact: true })).toBeVisible();
      } finally {
        await outputPage.close();
      }
    });

    await test.step("aggiorna la scaletta e usa i comandi del collega", async () => {
      await page.getByRole("button", { name: "Coperto" }).click();
      await expect(page.getByText("1 di 1 punto completato")).toBeVisible();

      const rememberStartedAt = Date.now();
      await page
        .getByPlaceholder("Es. Ricorda che il lancio è fissato al 15 ottobre")
        .fill(rememberedFact);
      await page.getByRole("button", { name: "Esegui" }).click();
      await expect(
        page.getByText("Ricevuto. L’ho salvato nella memoria del meeting."),
      ).toBeVisible();
      expect(Date.now() - rememberStartedAt).toBeLessThan(2_500);

      const agendaStartedAt = Date.now();
      await page.getByRole("button", { name: "Scaletta" }).click();
      await expect(page.getByText("La scaletta è completa: non ci sono altri punti aperti.")).toBeVisible();
      expect(Date.now() - agendaStartedAt).toBeLessThan(2_500);

      await page.getByRole("button", { name: "Riepiloga" }).click();
      const summary = page.getByRole("article").filter({ hasText: "Riepiloga" }).first();
      await expect(summary).toContainText(marker);
      await expect(summary).toContainText("roadmap", { ignoreCase: true });
    });

    await test.step("salva l'esito e lo ritrova nella memoria", async () => {
      await page.getByLabel("Riepilogo").fill(`Riepilogo E2E ${marker}`);
      await page.getByLabel("Da ricordare · uno per riga").fill(rememberedFact);
      await page.getByLabel("Decisioni · una per riga").fill(`Roadmap approvata ${marker}`);
      await page
        .getByLabel("Attività · testo | responsabile")
        .fill(`Preparare la demo ${marker} | Vincenzo`);
      await page
        .getByLabel("Questioni aperte · una per riga")
        .fill(`Confermare il budget ${marker}`);
      await page.getByRole("button", { name: "Salva nella memoria" }).click();
      await expect(page.getByText("Memoria aggiornata.")).toBeVisible();

      await page.goto("/memory");
      const memoryCard = page.getByRole("article").filter({ hasText: title });
      await expect(memoryCard).toBeVisible();
      await expect(memoryCard.getByText(rememberedFact)).toBeVisible();
      await expect(memoryCard.getByText(`Roadmap approvata ${marker}`)).toBeVisible();
      await expect(memoryCard.getByText(`Preparare la demo ${marker} · Vincenzo`)).toBeVisible();
    });

    await test.step("elimina solo il dato creato dal test", async () => {
      await page.goto(`/meetings/${meetingId}`);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Elimina meeting" }).click();
      await page.waitForURL(/\/meetings$/);
      await expect(page.getByText(title)).toHaveCount(0);
    });

    expect(browserErrors).toEqual([]);
  } finally {
    await safeDelete(request, "meetings", meetingId);
  }
});

test("serie: due appuntamenti condividono la memoria", async ({ page, request }) => {
  await useItalian(page);
  const marker = Date.now().toString(36);
  const seriesTitle = `E2E Serie ${marker}`;
  const firstLabel = `Kickoff ${marker}`;
  const secondLabel = `Follow-up ${marker}`;
  const sharedFact = `Il cliente ${marker} preferisce il piano annuale`;
  let seriesId: string | undefined;

  try {
    await page.goto("/meetings/new");
    await waitForClientReady(page);
    await page.getByRole("button", { name: /Serie di meeting/ }).click();
    await page.getByLabel("Nome della serie").fill(seriesTitle);
    await page.getByLabel("Obiettivo del meeting").fill(`Mantenere il contesto ${marker}`);
    await page.getByPlaceholder("Es. Approvare la roadmap").fill("Allineare i prossimi passi");

    await page.locator("#appointment-1-label").fill(firstLabel);
    await page.locator("#appointment-1-url").fill(teamLink);
    await page.locator("#appointment-1-start").fill(futureLocalDateTime(4));
    await page.getByRole("button", { name: "Aggiungi appuntamento" }).click();
    await page.locator("#appointment-2-label").fill(secondLabel);
    await page.locator("#appointment-2-url").fill(`${teamLink}&instance=2`);
    await page.locator("#appointment-2-start").fill(futureLocalDateTime(5));

    await page.getByRole("button", { name: "Crea serie" }).click();
    await page.waitForURL(/\/meetings\/series\/[a-f0-9]{24}$/);
    seriesId = page.url().match(/\/meetings\/series\/([a-f0-9]{24})$/)?.[1];
    expect(seriesId).toBeTruthy();
    await expect(page.getByRole("heading", { name: seriesTitle })).toBeVisible();
    await expect(page.getByText("2 appuntamenti")).toBeVisible();

    await page.getByRole("link", { name: new RegExp(firstLabel) }).click();
    await page.getByLabel("Riepilogo").fill(`Esito del kickoff ${marker}`);
    await page.getByLabel("Da ricordare · uno per riga").fill(sharedFact);
    await page.getByLabel("Decisioni · una per riga").fill(`Procedere ${marker}`);
    await page.getByRole("button", { name: "Salva nella memoria" }).click();
    await expect(page.getByText("Memoria aggiornata.")).toBeVisible();

    await page.getByRole("link", { name: "Torna alla serie" }).click();
    await page.getByRole("link", { name: new RegExp(secondLabel) }).click();
    await expect(page.getByRole("heading", { name: "Briefing dai meeting precedenti" })).toBeVisible();
    await expect(page.getByText(sharedFact)).toBeVisible();
    await expect(page.getByText(`Procedere ${marker}`)).toBeVisible();

    await page.getByRole("link", { name: "Torna alla serie" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Elimina serie" }).click();
    await page.waitForURL(/\/meetings$/);
    await expect(page.getByText(seriesTitle)).toHaveCount(0);
  } finally {
    await safeDelete(request, "meeting-series", seriesId);
  }
});

test("l'avatar si prova senza creare un meeting", async ({ page }) => {
  await useItalian(page);
  await page.goto("/avatar");
  await page.getByRole("link", { name: "Prova avatar" }).click();
  await page.waitForURL(/\/avatar\/test$/);
  await expect(
    page.getByRole("heading", { name: "Prova il collega digitale" }),
  ).toBeVisible();
  await expect(page.getByText("Prova voce, espressioni e gesti", { exact: false })).toBeVisible();

  await waitForClientReady(page);
  await expect(page.getByRole("button", { name: "Ascolta la voce" })).toBeVisible();

  await page.getByTestId("mood-focused").click();
  await expect(page.locator("svg[data-mood='focused']")).toBeVisible();

  await page.getByTestId("hand-raise-toggle").click();
  await expect(page.locator("svg[data-gesture='hand_raise']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Abbassa la mano" })).toBeVisible();

  await page.getByTestId("hand-raise-toggle").click();
  await expect(page.locator("svg[data-gesture='rest']")).toBeVisible();
});

test("comandi vocali: riconosce italiano e inglese dopo la parola di attivazione", () => {
  expect(parseMeetingVoiceCommand("Conclavia, ricorda che il budget è approvato", "Conclavia"))
    .toEqual({ kind: "remember", prompt: "il budget è approvato" });
  expect(parseMeetingVoiceCommand("Conclavia, riepiloga", "Conclavia"))
    .toEqual({ kind: "summary", prompt: "" });
  expect(parseMeetingVoiceCommand("Conclavia, what did we decide?", "Conclavia"))
    .toEqual({ kind: "ask", prompt: "what did we decide?" });
  expect(parseMeetingVoiceCommand("Assistente, quanto fa tre per tre?", "Conclavia"))
    .toEqual({ kind: "ask", prompt: "quanto fa tre per tre?" });
  expect(parseMeetingVoiceCommand("Ciao, mi senti?", "Conclavia"))
    .toEqual({ kind: "ask", prompt: "Mi senti?" });
  expect(parseMeetingVoiceCommand("Questa frase non è un comando", "Conclavia"))
    .toBeUndefined();
  expect(parseMeetingVoiceCommand("Nora, qual è il prossimo punto?", "Nora"))
    .toEqual({ kind: "agenda", prompt: "qual è il prossimo punto?" });
  expect(parseMeetingVoiceCommand("Nora, scaletta", "Nora"))
    .toEqual({ kind: "agenda", prompt: "" });
  expect(parseMeetingVoiceCommand("Conclavia, riepiloga", "Nora"))
    .toBeUndefined();
});

test("interventi: riconosce una correzione certa e attende il permesso rivolto al nome configurato", () => {
  expect(detectElementaryArithmetic("Tre per tre fa dodici.")?.response).toContain("fa 9");
  expect(detectElementaryArithmetic("Tre per tre fa nove.")).toBeUndefined();
  expect(meetingPermissionDecision("Nora, vai pure.", "Nora")).toBe("grant");
  expect(meetingPermissionDecision("Nora, non ora.", "Nora")).toBe("decline");
  expect(meetingPermissionDecision("Conclavia, vai pure.", "Nora")).toBeUndefined();
});

test("servizio: espone uno stato di salute senza cache", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expect(response.json()).resolves.toMatchObject({ status: "ok" });
});

test("trascrizione live: interpreta il messaggio inviato alla pagina del meeting", () => {
  expect(
    parseRecallOutputTranscript({
      transcript: {
        words: [
          {
            text: "Conclavia,",
            start_timestamp: { relative: 12.4 },
            end_timestamp: { relative: 12.9 },
          },
          {
            text: "riepiloga",
            start_timestamp: { relative: 12.9 },
            end_timestamp: { relative: 13.5 },
          },
        ],
        language_code: "it",
        participant: { id: 7, name: "Vincenzo" },
      },
    }),
  ).toEqual({
    speakerName: "Vincenzo",
    text: "Conclavia, riepiloga",
    language: "it",
    startMs: 12_400,
    endMs: 13_500,
  });
});

test("Attendee: verifica e interpreta una trascrizione firmata", () => {
  const payload = {
    idempotency_key: "db00b806-7fd5-4df0-bc72-446c6294481a",
    bot_id: "bot_conclaviae2e",
    bot_metadata: { conclavia_meeting_id: "507f1f77bcf86cd799439011" },
    trigger: "transcript.update",
    data: {
      speaker_name: "Vincenzo",
      timestamp_ms: 12_400,
      duration_ms: 1_100,
      transcription: { transcript: "Conclavia, riepiloga", words: [] },
    },
  };
  const secret = Buffer.from("conclavia-webhook-test").toString("base64");
  const signature = signAttendeeWebhookPayload(secret, payload).toString("base64");
  const headers = new Headers({ "X-Webhook-Signature": signature });

  expect(() => verifyAttendeeWebhook(secret, headers, payload)).not.toThrow();
  const event = parseAttendeeWebhook(payload);
  expect(event).toBeDefined();
  expect(attendeeTranscript(event!)).toEqual({
    speakerName: "Vincenzo",
    text: "Conclavia, riepiloga",
    startMs: 12_400,
    endMs: 13_500,
  });
});
