import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { parseMeetingVoiceCommand } from "../../src/lib/meeting-command";
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
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await test.step("crea il meeting dalla schermata cliente", async () => {
      await page.goto("/meetings/new");
      await waitForClientReady(page);
      await expect(
        page.getByRole("heading", { name: "Prepara il collega digitale" }),
      ).toBeVisible();

      await page.getByLabel("Titolo del meeting").fill(title);
      await page.getByLabel("Obiettivo del meeting").fill(objective);
      await page.getByPlaceholder("Es. Approvare la roadmap").fill("Confermare la roadmap");
      await page.getByLabel("Link Microsoft Teams").fill(teamLink);
      await page.getByLabel("Data e ora").fill(futureLocalDateTime(3));

      const automaticJoin = page.getByRole("checkbox", {
        name: /Programma l.ingresso automatico/,
      });
      await expect(automaticJoin).toBeDisabled();
      await expect(
        page.getByText("L’ingresso automatico non è ancora attivo.", { exact: false }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Memorizza meeting" }).click();
      await page.waitForURL(/\/meetings\/[a-f0-9]{24}$/);
      meetingId = page.url().match(/\/meetings\/([a-f0-9]{24})$/)?.[1];
      expect(meetingId).toBeTruthy();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByText("Confermare la roadmap")).toBeVisible();

      const meetingResponse = await request.get(`/api/meetings/${meetingId}`);
      expect(meetingResponse.ok()).toBeTruthy();
      const meetingPayload = (await meetingResponse.json()) as {
        meeting: { bot: { outputToken: string } };
      };
      const outputResponse = await request.get(
        `/api/meeting-room/${meetingPayload.meeting.bot.outputToken}/state`,
      );
      expect(outputResponse.ok()).toBeTruthy();
      expect(Object.keys(await outputResponse.json()).sort()).toEqual(["status"]);

      const protectedTranscript = await request.post(
        `/api/meeting-room/${meetingPayload.meeting.bot.outputToken}/transcript`,
        { data: { speakerName: "E2E", text: "Conclavia riepiloga" } },
      );
      expect(protectedTranscript.status()).toBe(409);
    });

    await test.step("aggiorna la scaletta e usa i comandi del collega", async () => {
      await page.getByRole("button", { name: "Coperto" }).click();
      await expect(page.getByText("1 di 1 punto completato")).toBeVisible();

      await page
        .getByPlaceholder("Es. Ricorda che il lancio è fissato al 15 ottobre")
        .fill(rememberedFact);
      await page.getByRole("button", { name: "Esegui" }).click();
      await expect(
        page.getByText("Ricevuto. L’ho salvato nella memoria del meeting."),
      ).toBeVisible();

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
  expect(parseMeetingVoiceCommand("Questa frase non è un comando", "Conclavia"))
    .toBeUndefined();
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
