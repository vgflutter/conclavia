<p align="center">
  <img src="public/conclavia-logo.png" alt="Conclavia" width="720" />
</p>

<p align="center">
  An open-source control room for live-format talks with AI and human guests.
</p>

# Conclavia

Conclavia is designed to reproduce a live current-affairs programme: five in-studio seats can be occupied by AI agents or people, while an optional human or AI host controls the editorial direction. The current MVP persists the complete format, runs an evolving multi-agent debate, and presents it inside an experimental virtual studio with automatic camera direction.

The main automatic broadcast pre-connects the next AI speaker on demand, composites the synchronized video stream into the five-seat studio, and sends each generated intervention to the correct avatar. LiveAvatar supplies the voice, motion, expressions, and lip sync; OpenAI or Gemini supplies only the debate content and editorial direction.

<p align="center">
  <img src="docs/images/one-piece-close-up.png" alt="Conclavia close-up preview for a One Piece studio debate" width="1086" />
  <br />
  <sub>Close-up direction with the current casual LiveAvatar cast.</sub>
</p>

<p align="center">
  <img src="docs/images/one-piece-five-guests.png" alt="Five casual LiveAvatar guests configured to debate whether One Piece is the best anime ever" width="1086" />
  <br />
  <sub>Five-seat offline preview in the Pop Garage studio; each portrait becomes its synchronized LiveAvatar stream on air.</sub>
</p>

## How the MVP works

1. Create an episode and define its central question, language, real airtime target, and live format.
2. Build the five-seat cast using AI guests, people, or open draft seats.
3. Optionally add a host and choose an impartial, confrontational, or synthesizing editorial line.
4. Open the live studio: an invisible director moves the discussion through positions, central conflict, examination, synthesis, and conclusion.
5. Follow every intervention while it streams; in automatic mode the next useful guest can begin preparing from claims that are already explicit before the current speaker finishes.
6. At selected milestones, an off-air editorial checkpoint determines what evolved, what still needs testing, and whether an honest conclusion is available.
7. Every completed message, its conversational intent, and the updated editorial state are persisted in MongoDB.
8. A person selected by the director receives a persistent on-air input desk; their intervention then affects the same memories, conflicts, and conclusion as an AI contribution.
9. The main live action pre-connects each LiveAvatar as the director calls that speaker, routes every AI contribution to the correct synchronized video and voice stream, keeps the current speaker in the foreground, and exposes one stop action for the complete broadcast.

Creating the persisted run does not call a provider. Starting the studio enables the broadcast; a paid LiveAvatar session opens only when its AI speaker is first assigned a turn. Each generated intervention is a separate LLM request, while selected editorial checkpoints make an additional structured-output request. Automatic mode prewarms the planned speaker during text generation and begins the synchronized intervention as soon as the text is ready. Editorial checkpoints and preparation of the following turn continue off-air while the current guest speaks, reducing dead air.

## Current MVP

### Configuration

- Persist, edit, duplicate, inspect, and delete talks in MongoDB.
- Configure exactly five seats as AI guests, people, or open draft slots.
- Generate a coherent or surprising cast from the central question, then edit or regenerate any guest.
- Choose a custom, automatic, or random perspective and keep each AI guest’s goals, boundaries, style, traits, model, and identity stable.
- Add an optional AI or human host with an independent editorial line.
- Choose Italian or English, duration, pace, studio theme, and a constrained OpenAI/Gemini model catalog.
- Derive `draft` or `ready` automatically and validate data both server-side and at the Mongoose boundary.

### Conversation engine

- Select the next useful speaker dynamically instead of following a fixed round robin.
- Persist the discussion thread, participant memories, contested claims, open questions, agreements, conflicts, and a semantic floor queue.
- Vary intentions and duration across replies, challenges, interruptions, questions, clarifications, arguments, and partial agreements.
- Move through positions → conflict → examination → synthesis → conclusion, with periodic editorial checkpoints and an explicit outcome dossier.
- Stream and persist every contribution, prepare the following turn while the current one is on air, and pause cleanly for guided human input.
- Freeze the complete talk snapshot inside every run and record model and usage metadata for each generated intervention.

### Live studio

- Present the talk in a responsive 16:9 five-seat studio with five selectable visual themes.
- Connect LiveAvatar FULL sessions on demand and use their synchronized video, neural voice, expressions, and lip sync—without browser TTS or a static broadcast fallback.
- Keep stable, language-appropriate avatars and voices; respect each configured guest’s sex.
- Use the low-latency multilingual voice model at 1.2× speed, with a curated Italian voice rotation when the talk language is Italian.
- Refresh a guest session before it can expire during an intervention; an idle expired session reconnects on its next assignment without stopping the studio.
- Bring the active speaker and addressee forward automatically, with wide, close-up, and two-person framing overrides.
- Show `On air` only after media is active, expose one immediate stop action, and keep technical telemetry collapsed until needed.
- Support one local human camera after explicit browser permission while credentials, avatar allow-lists, and timeouts remain server-side.

## UX principles

- **Useful defaults first:** the central question, AI-assisted cast, duration, pace, model, and theme are enough for most episodes.
- **Everything remains editable:** automation starts the configuration; it never locks the user into an AI choice.
- **Complexity on demand:** cast composition, turn dynamics, safety ceilings, participant traits, and LiveAvatar telemetry remain available behind focused controls.
- **Costs are explicit:** a clear preflight dialog shows duration, possible LiveAvatar count, and maximum estimated credits before going live.
- **Audience and production stay separate:** the default runner is a clean viewing experience; editorial state and provider details live in the control-room view.

## Tech stack

- [Next.js](https://nextjs.org/) with App Router
- TypeScript in strict mode
- Tailwind CSS
- MongoDB
- Mongoose

## Application routes

| Route | Purpose |
| --- | --- |
| `/talks` | List saved talks |
| `/talks/new` | Create a talk and configure all five participants |
| `/talks/[id]` | View a saved talk configuration |
| `/talks/[id]/edit` | Edit or duplicate a saved configuration |
| `/talks/[id]/run` | Run or resume the talk inside the virtual studio and control room |

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/talks` | List talks, newest first |
| `POST` | `/api/talks` | Validate and create a talk |
| `POST` | `/api/cast/generate` | Generate five AI guests or one replacement with structured output |
| `GET` | `/api/talks/[id]` | Read one talk |
| `PATCH` | `/api/talks/[id]` | Validate and update one talk |
| `DELETE` | `/api/talks/[id]` | Delete one talk and its persisted sessions |
| `GET` | `/api/talks/[id]/runs` | Read the latest session for a talk |
| `POST` | `/api/talks/[id]/runs` | Create a session without calling an LLM |
| `GET` | `/api/runs/[id]` | Read one persisted session |
| `POST` | `/api/runs/[id]/next` | Generate and persist exactly one intervention |
| `POST` | `/api/runs/[id]/next/stream` | Stream, then persist, exactly one intervention |
| `POST` | `/api/runs/[id]/human-turn` | Persist the human contribution currently requested by the director |
| `GET` | `/api/liveavatar/status` | Read sanitized configuration, credit, and timeout status |
| `POST` | `/api/liveavatar/sessions` | Mint a short-lived allow-listed LiveAvatar FULL session token |
| `DELETE` | `/api/liveavatar/sessions/[id]` | Stop the paid LiveAvatar session server-side |

## Requirements

- Node.js 20.19 or newer
- npm
- A reachable MongoDB instance
- OpenAI and/or Gemini credentials for AI turns
- A LiveAvatar API key and a plan with enough concurrent sessions for the configured AI cast

## Installation

```bash
git clone https://github.com/vgflutter/conclavia-frontend.git
cd conclavia-frontend
npm install
cp .env.example .env.local
```

Then configure MongoDB and at least one LLM provider in `.env.local`, and run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The interface uses the browser language on the first visit and stores an explicit EN/IT selection in a cookie.

## MongoDB configuration

Set `MONGODB_URI` in `.env.local`:

```dotenv
MONGODB_URI=mongodb://USER:PASSWORD@127.0.0.1:27017/conclave?authSource=AUTH_DB
```

The database selected by the URI is `conclave`. `authSource` identifies the database where the MongoDB user is defined; it does not change the application database.

The application user needs `readWrite` access to `conclave`. A MongoDB administrator can grant it with:

```javascript
db.getSiblingDB("AUTH_DB").grantRolesToUser("USER", [
  { role: "readWrite", db: "conclave" }
])
```

MongoDB creates the database on the first write. An empty `talks` collection can also be created in advance.

Never commit `.env.local` or real credentials. Local environment files are excluded by `.gitignore`.

## LLM provider configuration

Add the provider keys to `.env.local` alongside `MONGODB_URI`:

```dotenv
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
```

These are server-only variables: do not prefix them with `NEXT_PUBLIC_`. Provider calls are made only from Node.js Route Handlers and the keys are never returned to the browser.

The supported model catalog is intentionally explicit:

| Provider | Model | Stored identifier |
| --- | --- | --- |
| OpenAI / ChatGPT | GPT-5.6 Sol | `gpt-5.6-sol` |
| OpenAI / ChatGPT | GPT-5.6 Terra | `gpt-5.6-terra` |
| Google / Gemini | Gemini 3.6 Flash | `gemini-3.6-flash` |
| Google / Gemini | Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` |

## LiveAvatar studio configuration

LiveAvatar is required for the broadcast. Static portraits are used only in the offline preview. During a broadcast, each AI seat is replaced by its synchronized LiveAvatar stream the first time that guest is called on air. Add:

```dotenv
LIVEAVATAR_API_KEY=your_liveavatar_api_key
LIVEAVATAR_PRODUCTION_ENABLED=true
LIVEAVATAR_MAX_SESSION_SECONDS=300
```

The API key is read only by server Route Handlers. The browser receives short-lived session tokens, never the account key. Sessions are disabled unless `LIVEAVATAR_PRODUCTION_ENABLED=true`; duration is clamped server-side to 20–300 seconds. Keep the flag `false` in shared or untrusted environments.

The **Go live** action opens a clear cost preflight and then enables automatic direction. When a turn is planned, its LiveAvatar is pre-connected while the LLM writes; later turns reuse that speaker’s session. Generated text is sent as `avatar.speak_text` over LiveAvatar’s official `agent-control` channel, so LiveAvatar produces the voice and matching lip-synced video. There is no browser voice and no separate OpenAI TTS fallback. The UI declares that the voices are AI-generated.

The server restricts sessions to a curated public avatar catalog, enforces the configured participant sex, uses 480p H.264 to control latency, and configures the LiveAvatar voice pipeline for the talk language. Eleven Flash 2.5 runs at the provider’s supported 1.2× maximum. Green backgrounds are removed in the browser through WebGL. A keep-alive protects silent guests while another participant speaks; sessions nearing their per-session limit are recycled safely, and every active stream closes when the talk ends or the operator stops it.

LiveAvatar FULL currently costs 2 credits per active avatar minute. Five AI guests in a five-minute studio therefore have a maximum estimate of 50 credits. An AI moderator also consumes one concurrent session; the total number of AI guests plus an AI moderator cannot exceed five on the current plan. Human seats do not consume LiveAvatar credits.

## Development commands

```bash
npm run dev
npm run lint
npm run build
npm start
```

`npm start` serves the optimized application after a successful build.

## Verified baseline

The current MVP has been checked locally with strict linting and a production build. A MongoDB smoke test creates, reads, deletes, and confirms removal of a temporary talk; its principal pages have also been rendered at 390, 768, and 1440 pixels without horizontal overflow.

The latest real integration run used the English question **“Is One Piece the best anime ever?”** and connected all five LiveAvatar FULL sessions on demand. It completed 10 participant turns plus an explicit closing in 3:31 wall-clock time, with contributions ranging from 14 to 68 words and about 6 to 25 seconds of estimated speech. The browser reported active audio and video tracks, consecutive close-up frames changed while the guest spoke, all sessions closed after the final intervention, and the run consumed 31 LiveAvatar credits. The studio images above are fresh offline previews of the current casual cast; they consume no credits and the same portraits are replaced by synchronized streams during a broadcast. These are integration checks, not a committed automated test suite.

## Project structure

```text
src/
├── app/                 App Router pages, runner, and API routes
├── components/          Header, talk form, runner, and virtual studio
├── i18n/                Translation catalog and locale handling
├── lib/                 MongoDB, prompts, LLM/LiveAvatar adapters, and video compositing
├── models/              Mongoose Talk and TalkRun models
└── types/               Shared strict TypeScript types
```

The browser only talks to Next.js Route Handlers. MongoDB credentials and provider keys remain server-side; each runner step validates the saved configuration, calls the selected provider, and persists the result before responding.

## Talk configuration

A talk stores:

- title, topic, optional description, and language
- exactly five participants
- automatic `draft` or `ready` status based on whether every seat is complete
- maximum interventions, planned duration, conversation pace, default model, and guest-interaction policy
- the selected virtual-studio theme, persisted with the talk and frozen into every new run snapshot
- creation and update timestamps

Each assigned seat stores its participant type (`ai` or `human`) and sex (`female` or `male`). AI participants also store a name, role, stable perspective, private objectives, non-negotiable points, speaking style, optional model override, and four integer traits from 0 to 100: assertiveness, patience, interruptiveness, and baseline tension. Human participants store their name, role, sex, and an optional editorial brief. Unassigned seats can be persisted in drafts, while a `ready` talk requires all five seats to be assigned.

The optional host is stored separately from the five guests. A host can be human or AI and includes an on-air identity, editorial line, optional production brief, operational permissions, and an optional model override. The editorial line can be impartial, drive open confrontation, or seek mediation and synthesis; it never changes the individual guests’ configured positions.

Perspective modes define how the text runner prompts each AI participant:

- `custom` requires an explicit perspective prompt
- `automatic` delegates the perspective to the selected AI and accepts optional preferences
- `random` requests a random perspective and accepts optional constraints

During a text session, `automatic` and `random` modes are translated into stable participant instructions and reinforced by that guest’s private memory. The generated intervention and its usage metadata are saved after every successful provider call.

## Talk runner and virtual studio

Open `/talks/[id]/run` or select **Open live room** from a saved configuration. The single **Go live** action confirms the maximum LiveAvatar cost, creates or resumes the persisted run, and starts automatic direction. The next speaker is pre-connected on demand while the intervention is generated. Each message is individually persisted. As soon as a turn is ready it is sent to the corresponding LiveAvatar; persistence, editorial review, and preparation of the following turn continue in parallel. If the next guest already has an independent argument ready, the prompt explicitly avoids pretending it is a reply.

The virtual studio has an offline preview before a run begins. During a run, an AI portrait is replaced by its real LiveAvatar video as soon as that speaker connects. Automatic direction keeps all five seats in frame, raises the speaker currently being heard, and gives the addressee secondary emphasis. The control room can override this behavior with wide, close-up, or two-person framing. The badge shows `On air` only while a LiveAvatar is actually speaking. Stock seated avatars render their own complete rooms, so the shared studio deliberately uses the green-screen catalog; a truly seated shared set will require custom green-screen avatars.

The runner treats `maxTurns` as a safety ceiling. The configured duration is an operational airtime budget: every intervention receives an estimated spoken duration, late turns become shorter, and reaching the time or turn ceiling forces an honest editorial close. Structured checkpoints run at selected milestones and may close earlier only after a meaningful minimum and at least one synthesis contribution. A valid ending can be agreement, conditional agreement, clarified disagreement, or an explicitly open outcome. With an AI host, the shared state drives the host’s closing summary; without one, the most patient AI guest gives a final position while staying in character.

The first runner supports:

- any mix of five AI and guided human participants selected dynamically by an invisible director
- no host, an AI host, or a guided human host
- direct replies, challenges, questions, clarifications, partial agreements, and interruptions with explicit targets
- independent prepared arguments that do not force an artificial reference to the previous speaker
- varied reference styles and speaker selection that breaks repetitive back-and-forth pairings
- persisted positions → conflict → examination → synthesis → conclusion progression
- structured editorial checkpoints that decide the next objective and conclusion readiness
- variable word ranges determined by intention and the configured pace
- speculative next-turn preparation during live streaming, with the completed contribution held durably in MongoDB
- active AI host interventions during the discussion
- a semantic floor queue updated by direct calls and editorial checkpoints
- OpenAI Responses streaming and schema-constrained cast generation
- Gemini `streamGenerateContent` and schema-constrained cast generation
- a maximum of 50 participant turns per session
- recent-transcript prompting plus a compact persisted discussion state and per-guest memory
- live text streaming, durable progress, transcript, failure state, retry, and token usage
- a final conclusion card with answer, agreements, disagreements, conditions, and unresolved questions

## Current scope

This repository contains real text generation, guided human turns, persistence, a local-camera proof, and up to five concurrent lip-synced LiveAvatar sessions. Static portraits are offline previews only and are never used as the audiovisual broadcast fallback. Authentication, microphone ingestion, multi-device guests, and recording remain outside this experimental milestone.

When the director selects a human guest or host, the run enters `waiting_for_human`, exposes an on-air input desk, persists the submitted intervention with `origin: human`, and then returns control to the same shared thread. The browser camera is a visual local preview only; the next functional milestone is microphone capture plus realtime transport for remote people and synchronized audio/video direction.
