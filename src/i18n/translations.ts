export type Locale = "en" | "it";
export const LOCALE_COOKIE = "conclavia_locale";

const english = {
  appDescription: "Configure and save structured multi-participant talks.",
  navLabel: "Primary navigation",
  navTalks: "Talks",
  navNewTalk: "New talk",
  interfaceLanguage: "Interface language",
  localeEnglish: "English",
  localeItalian: "Italiano",
  library: "Library",
  talksTitle: "Talks",
  talksIntro: "Configure the people, dynamics, and boundaries of a discussion.",
  createTalk: "Create a talk",
  noTalksTitle: "No talks yet",
  noTalksDescription:
    "Create the first configuration. You can save it as a draft or mark it ready.",
  createFirstTalk: "Create the first talk",
  fiveParticipants: "5 participants",
  updated: "Updated",
  statusDraft: "Draft",
  statusReady: "Ready",
  loadingTalks: "Loading talks",
  loadErrorTitle: "We could not load the talks",
  loadErrorDescription: "Check the MongoDB connection and try again.",
  tryAgain: "Try again",
  notFoundTitle: "Talk not found",
  notFoundDescription: "This talk does not exist or may have been removed.",
  backToTalks: "Back to talks",
  allTalks: "All talks",
  configuration: "Configuration",
  createTalkTitle: "Create a talk",
  createTalkIntro:
    "Define the subject, five participant perspectives, and the rules of the discussion.",
  step1: "Step 1",
  step2: "Step 2",
  step3: "Step 3",
  talkDetails: "Talk details",
  title: "Title",
  language: "Talk language",
  topic: "Topic",
  description: "Description",
  optional: "optional",
  status: "Status",
  titlePlaceholder: "The future of public space",
  topicPlaceholder:
    "State the question or proposition that the participants will discuss.",
  descriptionPlaceholder: "Add context for editors or future readers.",
  talkLanguageEnglish: "English",
  talkLanguageItalian: "Italiano",
  participants: "Participants",
  participantsDescription: "Every talk has exactly five configured perspectives.",
  participantNumber: "Participant {number}",
  exactlyFive: "Exactly five",
  name: "Name",
  role: "Role",
  participantNamePlaceholder: "Participant name",
  participantRolePlaceholder: "Urban planner, resident, researcher…",
  perspectivePrompt: "Perspective prompt",
  perspectivePlaceholder: "Describe the participant’s point of view and priorities.",
  speakingStylePrompt: "Speaking style prompt",
  speakingStylePlaceholder: "Concise, analytical, uses concrete examples…",
  assertiveness: "Assertiveness",
  patience: "Patience",
  interruptiveness: "Interruptiveness",
  baselineTension: "Baseline tension",
  talkSettings: "Talk settings",
  maximumTurns: "Maximum turns",
  allowInterruptions: "Allow interruptions",
  allowInterruptionsHelp: "Participants may interrupt one another.",
  seekCommonGround: "Seek common ground",
  seekCommonGroundHelp: "The discussion should work toward shared positions.",
  cancel: "Cancel",
  saveTalk: "Save talk",
  saving: "Saving…",
  reviewConfiguration: "Please review the configuration:",
  saveError: "Unable to save the talk. Please review the configuration.",
  networkError: "The server could not be reached. Please try again.",
  created: "Created",
  perspective: "Perspective",
  speakingStyle: "Speaking style",
  interruptions: "Interruptions",
  commonGround: "Common ground",
  allowed: "Allowed",
  disabled: "Disabled",
  sought: "Sought",
  notRequired: "Not required",
} as const;

export type TranslationKey = keyof typeof english;

const italian: Record<TranslationKey, string> = {
  appDescription: "Configura e salva talk strutturati con più partecipanti.",
  navLabel: "Navigazione principale",
  navTalks: "Talk",
  navNewTalk: "Nuovo talk",
  interfaceLanguage: "Lingua dell’interfaccia",
  localeEnglish: "English",
  localeItalian: "Italiano",
  library: "Archivio",
  talksTitle: "Talk",
  talksIntro: "Configura partecipanti, dinamiche e confini di una discussione.",
  createTalk: "Crea un talk",
  noTalksTitle: "Nessun talk presente",
  noTalksDescription:
    "Crea la prima configurazione. Puoi salvarla come bozza o contrassegnarla come pronta.",
  createFirstTalk: "Crea il primo talk",
  fiveParticipants: "5 partecipanti",
  updated: "Aggiornato",
  statusDraft: "Bozza",
  statusReady: "Pronto",
  loadingTalks: "Caricamento dei talk",
  loadErrorTitle: "Impossibile caricare i talk",
  loadErrorDescription: "Controlla la connessione a MongoDB e riprova.",
  tryAgain: "Riprova",
  notFoundTitle: "Talk non trovato",
  notFoundDescription: "Questo talk non esiste o potrebbe essere stato rimosso.",
  backToTalks: "Torna ai talk",
  allTalks: "Tutti i talk",
  configuration: "Configurazione",
  createTalkTitle: "Crea un talk",
  createTalkIntro:
    "Definisci l’argomento, le prospettive dei cinque partecipanti e le regole della discussione.",
  step1: "Passaggio 1",
  step2: "Passaggio 2",
  step3: "Passaggio 3",
  talkDetails: "Dettagli del talk",
  title: "Titolo",
  language: "Lingua del talk",
  topic: "Argomento",
  description: "Descrizione",
  optional: "opzionale",
  status: "Stato",
  titlePlaceholder: "Il futuro dello spazio pubblico",
  topicPlaceholder: "Indica la domanda o la tesi che i partecipanti discuteranno.",
  descriptionPlaceholder: "Aggiungi contesto per gli editor o i futuri lettori.",
  talkLanguageEnglish: "English",
  talkLanguageItalian: "Italiano",
  participants: "Partecipanti",
  participantsDescription: "Ogni talk contiene esattamente cinque prospettive configurate.",
  participantNumber: "Partecipante {number}",
  exactlyFive: "Esattamente cinque",
  name: "Nome",
  role: "Ruolo",
  participantNamePlaceholder: "Nome del partecipante",
  participantRolePlaceholder: "Urbanista, residente, ricercatore…",
  perspectivePrompt: "Prompt della prospettiva",
  perspectivePlaceholder: "Descrivi il punto di vista e le priorità del partecipante.",
  speakingStylePrompt: "Prompt dello stile espositivo",
  speakingStylePlaceholder: "Conciso, analitico, usa esempi concreti…",
  assertiveness: "Assertività",
  patience: "Pazienza",
  interruptiveness: "Propensione a interrompere",
  baselineTension: "Tensione iniziale",
  talkSettings: "Impostazioni del talk",
  maximumTurns: "Numero massimo di turni",
  allowInterruptions: "Consenti interruzioni",
  allowInterruptionsHelp: "I partecipanti possono interrompersi a vicenda.",
  seekCommonGround: "Cerca un terreno comune",
  seekCommonGroundHelp: "La discussione dovrebbe convergere verso posizioni condivise.",
  cancel: "Annulla",
  saveTalk: "Salva talk",
  saving: "Salvataggio…",
  reviewConfiguration: "Controlla la configurazione:",
  saveError: "Impossibile salvare il talk. Controlla la configurazione.",
  networkError: "Impossibile raggiungere il server. Riprova.",
  created: "Creato",
  perspective: "Prospettiva",
  speakingStyle: "Stile espositivo",
  interruptions: "Interruzioni",
  commonGround: "Terreno comune",
  allowed: "Consentite",
  disabled: "Disabilitate",
  sought: "Ricercato",
  notRequired: "Non richiesto",
};

export const translations: Record<Locale, Record<TranslationKey, string>> = {
  en: english,
  it: italian,
};

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "it";
}

export function localeFromLanguageTag(value: string | null): Locale {
  return value?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values?: Record<string, string | number>,
): string {
  const message = translations[locale][key];

  if (!values) {
    return message;
  }

  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    message,
  );
}

export function talkLanguageLabel(locale: Locale, language: string): string {
  const normalized = language.trim().toLowerCase();

  if (["it", "italian", "italiano"].includes(normalized)) {
    return translate(locale, "talkLanguageItalian");
  }

  if (["en", "english", "inglese"].includes(normalized)) {
    return translate(locale, "talkLanguageEnglish");
  }

  return language;
}
