<p align="center">
  <img src="public/conclavia-logo.png" alt="Conclavia" width="720" />
</p>

<p align="center">
  An open-source control room for live-format talks with AI and human guests.
</p>

# Conclavia

Conclavia is designed to reproduce a live current-affairs programme: five in-studio seats can be occupied by AI agents or people, while an optional human or AI host controls the editorial direction. The current MVP persists the complete format, runs an evolving multi-agent debate, and presents it inside an experimental virtual studio with automatic camera direction.

The main automatic broadcast warms the complete AI cast in parallel before the first cue, composites every synchronized video stream into the five-seat studio, and sends each generated intervention to the correct avatar. LiveAvatar supplies the voice, motion, expressions, and lip sync; OpenAI or Gemini supplies only the debate content and editorial direction.

<p align="center">
  <img src="docs/images/after-hours-live-punch-in.png" alt="Conclavia After Hours live punch-in for a One Piece studio debate" width="1086" />
  <br />
  <sub>A real English LiveAvatar frame captured on air in After Hours: synchronized voice, lip sync, GPU keying, captions and a tight automatic punch-in.</sub>
</p>

<p align="center">
  <img src="docs/images/after-hours-five-guests.png" alt="Five casual guests in the Conclavia After Hours podcast set" width="1086" />
  <br />
  <sub>The five-seat After Hours preview: a cinematic creator-podcast lounge with depth staging, individual microphones and a smoked-glass foreground desk.</sub>
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
9. The main live action connects the complete AI cast before the first cue, routes every contribution to the correct synchronized video and voice stream, and exposes one stop action for the complete broadcast.
10. During a YouTube stream, the audience desk receives public chat messages and lets the control room show one on air, hand it to the host, direct it to a guest, or use it as an unattributed editorial prompt.

Creating the persisted run does not call a provider. Starting the studio enables the broadcast and opens the declared AI cast sessions together. This trades a single controlled startup for immediate later handoffs, live listening motion from every connected guest, and no per-speaker connection pause. Each generated intervention is a separate LLM request, while selected editorial checkpoints make an additional structured-output request. Editorial checkpoints and preparation of the following turn continue off-air while the current guest speaks.

## Current MVP

### Configuration

- Persist, edit, duplicate, inspect, and delete talks in MongoDB.
- Configure exactly five seats as AI guests, people, or open draft slots.
- Generate a coherent or surprising cast from the central question, then edit or regenerate any guest.
- Choose a custom, automatic, or random perspective and keep each AI guest’s goals, boundaries, style, traits, model, and identity stable.
- Add an optional AI or human host with an independent editorial line.
- Choose Italian or English, duration, pace, studio theme, and a constrained OpenAI/Gemini model catalog. New episodes start from the cinematic After Hours podcast lounge rather than a conventional TV set.
- Derive `draft` or `ready` automatically and validate data both server-side and at the Mongoose boundary.

### Conversation engine

- Select the next useful speaker dynamically instead of following a fixed round robin.
- Persist the discussion thread, participant memories, contested claims, open questions, agreements, conflicts, and a semantic floor queue.
- Vary intentions and duration across replies, challenges, interruptions, questions, clarifications, arguments, and partial agreements.
- Move through positions → conflict → examination → synthesis → conclusion, with periodic editorial checkpoints and an explicit outcome dossier.
- Stream and persist every contribution, prepare the following turn while the current one is on air, and pause cleanly for guided human input.
- Freeze the complete talk snapshot inside every run and record model and usage metadata for each generated intervention.

### Live studio and broadcast output

- Present the talk in a responsive 16:9 five-seat studio with ten selectable visual themes, explicitly grouped into **Pop / creator** and **Editorial / authoritative** families. After Hours is the flagship creator set; Electric Commons, Soft Social and Broadcast Panel provide the more controlled editorial direction.
- Connect the complete LiveAvatar FULL cast in parallel and use synchronized video, neural voice, expressions, and lip sync—without browser TTS or a static broadcast fallback.
- Keep stable, language-appropriate avatars and independently cast voices; respect each configured guest’s sex and let the operator audition every shortlisted voice before going live.
- Offer natural, energetic, and authoritative delivery profiles. Live speech uses Eleven Flash 2.5 with latency-heavy style exaggeration and speaker boost disabled; pace and delivery determine a bounded per-speaker speed instead of forcing every voice to 1.2×.
- Refresh a guest session before it can expire during an intervention; an idle expired session reconnects on its next assignment without stopping the studio.
- Adapt the camera grammar to the selected family. Pop direction uses earlier punch-ins, lateral drifts and faster reaction coverage; editorial direction holds shots longer, reduces movement and gives two-shots and wide cuts more breathing room. Manual overrides remain in the control room.
- Request LiveAvatar’s `very_high` 1080p H.264 stream when the account supports it, fall back explicitly to `high` on plans that reject 1080p, and scale WebGL compositing dynamically for the active close-up while keeping inactive seats lightweight.
- Unlock a shared Web Audio programme bus from the original **Go live** gesture, route every LiveAvatar stream through its own high-pass filter, corrective EQ, compressor and level trim, then protect the shared master with a limiter. Raw video elements stay muted so duplicate audio can never leak into the mix.
- Measure command-to-voice startup and the silence between consecutive speakers inside the control room, so perceived latency is observable instead of guessed.
- Show `On air` only after media is active, expose one immediate stop action, and keep technical telemetry collapsed until needed.
- Provide a separate clean `/broadcast` output with a title slate, animated lower thirds, timed caption chunks, editorial stingers, and a final-result card for OBS, YouTube, or a projector.
- Support one local human camera after explicit browser permission while credentials, avatar allow-lists, and timeouts remain server-side.
- Connect a YouTube live chat to the current run, optionally require manual approval, and persist every selected audience cue alongside the resulting intervention.

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
| `/talks/[id]/broadcast` | Open the clean 16:9 programme output for recording or streaming |

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
| `GET` | `/api/runs/[id]/broadcast-manifest` | Download the deterministic 4K edit decision list for one session |
| `POST` | `/api/runs/[id]/next` | Generate and persist exactly one intervention |
| `POST` | `/api/runs/[id]/next/stream` | Stream, then persist, exactly one intervention |
| `POST` | `/api/runs/[id]/human-turn` | Persist the human contribution currently requested by the director |
| `GET/POST/PATCH/DELETE` | `/api/runs/[id]/audience` | Read, connect, configure, or disconnect the YouTube audience desk |
| `POST` | `/api/runs/[id]/audience/sync` | Fetch the next YouTube live-chat page at the provider’s requested interval |
| `PATCH` | `/api/runs/[id]/audience/messages/[messageId]` | Approve, discard, show, or route one audience message |
| `GET` | `/api/liveavatar/status` | Read sanitized configuration, credit, and timeout status |
| `GET` | `/api/liveavatar/voices/[id]/preview` | Stream an allow-listed voice audition sample without exposing provider credentials |
| `POST` | `/api/liveavatar/sessions` | Mint a short-lived allow-listed LiveAvatar FULL session token |
| `DELETE` | `/api/liveavatar/sessions/[id]` | Stop the paid LiveAvatar session server-side |

## Requirements

- Node.js 20.19 or newer
- npm
- A reachable MongoDB instance
- OpenAI and/or Gemini credentials for AI turns
- A LiveAvatar API key and a plan with enough concurrent sessions for the configured AI cast
- An optional YouTube Data API key for live audience interaction

## Installation

```bash
git clone https://github.com/vgflutter/conclavia.git
cd conclavia
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

## YouTube live audience configuration

Enable **YouTube Data API v3** in a Google Cloud project and add a restricted server key:

```dotenv
YOUTUBE_API_KEY=your_youtube_data_api_key
```

This first audience integration is read-only and therefore does not ask the channel owner to complete OAuth. In the control-room view, open **Live audience desk** and paste the public YouTube live URL or its 11-character video ID. Conclavia resolves the active chat, follows the continuation token and provider polling interval, and stores at most the latest 200 messages with the run.

Manual review is disabled by default. When enabled, incoming messages remain pending until the operator approves or discards them. Without it, messages go straight to the control-room queue, but nothing reaches the programme until the operator chooses an action:

- **Show on air** displays the viewer and message for twelve seconds without changing the conversation.
- **Give to host** makes the next host intervention attribute the message and put it to the selected—or automatically chosen—guest.
- **Ask guest** makes the selected guest answer it on the next useful turn.
- **Use as prompt** injects only the editorial substance and never identifies the viewer on air.

Selected messages are quoted to the LLM as untrusted programme material rather than instructions, persisted on the generated intervention, and rendered in the clean broadcast output. The audience card and broadcast output synchronize through MongoDB, so OBS can remain open in a separate window. See the official [YouTube live-chat resource](https://developers.google.com/youtube/v3/live/docs/liveChatMessages) and [`liveChatMessages.list`](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list) documentation.

The supported model catalog is intentionally explicit:

| Provider | Model | Stored identifier |
| --- | --- | --- |
| OpenAI / ChatGPT | GPT-5.6 Sol | `gpt-5.6-sol` |
| OpenAI / ChatGPT | GPT-5.6 Terra | `gpt-5.6-terra` |
| Google / Gemini | Gemini 3.6 Flash | `gemini-3.6-flash` |
| Google / Gemini | Gemini 3.5 Flash-Lite | `gemini-3.5-flash-lite` |

## LiveAvatar studio configuration

LiveAvatar is required for the broadcast. Static portraits are used only in the offline preview and while a stream is completing its first video frame. During a broadcast, every configured AI seat is connected before the first cue and replaced by its synchronized LiveAvatar stream. Add:

```dotenv
LIVEAVATAR_API_KEY=your_liveavatar_api_key
LIVEAVATAR_PRODUCTION_ENABLED=true
LIVEAVATAR_MAX_SESSION_SECONDS=300
LIVEAVATAR_VIDEO_QUALITY=auto

# Optional purchased custom cast override (repeat for seats 2–5)
LIVEAVATAR_SEAT_1_AVATAR_ID=your_custom_avatar_id
LIVEAVATAR_SEAT_1_VOICE_ID=your_voice_id
LIVEAVATAR_SEAT_1_SEX=female
```

The API key is read only by server Route Handlers. The browser receives short-lived session tokens, never the account key. Sessions are disabled unless `LIVEAVATAR_PRODUCTION_ENABLED=true`; duration is clamped server-side to 20–300 seconds. Keep the flag `false` in shared or untrusted environments.

The **Go live** action opens a clear cost preflight and then connects all configured AI presenters concurrently before the first cue. Later turns therefore reuse an already-moving, already-audible speaker rather than opening a session between contributions. Generated text is sent as `avatar.speak_text` over LiveAvatar’s official `agent-control` channel, so LiveAvatar produces the voice and matching lip-synced video. There is no browser voice and no separate OpenAI TTS fallback. The UI declares that the voices are AI-generated.

The server restricts sessions to curated official green-screen Studio avatars and a deliberately short voice catalog. Avatar and voice are independent: **Auto** assigns distinct language- and sex-compatible voices, while the participant and host forms expose a real provider preview plus an explicit selection. Purchased custom avatars can replace any seat through server-only environment variables; incomplete or sex-inconsistent overrides fail closed. Live delivery uses Eleven Flash 2.5 for Italian and English, `style: 0`, no speaker boost, and bounded profile-specific speed. This materially reduces handoff latency while the audition step catches any voice whose accent or character is wrong for the programme.

`LIVEAVATAR_VIDEO_QUALITY=auto` first requests `very_high` and retries at `high` only when LiveAvatar returns its specific 1080p plan restriction. Set it explicitly to `high` when startup speed matters more than the initial capability check, or to `very_high` when the account must fail rather than downgrade. At the time of the latest verification, the Starter account delivered a real `1280×720` stream after rejecting 1080p; Business or Enterprise is required by the current API for that higher session quality.

Green backgrounds are removed by a two-pass GPU compositor. It samples neighbouring pixels to refine hair and shoulder edges, suppresses reflected green, applies a restrained broadcast grade, and reuses only the semi-transparent edge matte from the previous video frame to prevent flicker. Processing resolution follows the actual shot: `640×360` for background guests in a panel, `960×540` for the active wide-shot speaker, `1280×720` per guest in a two-shot, and up to `1920×1080` for a close-up. The raw media elements retain their real rendered dimensions so LiveKit adaptive streaming does not suspend an avatar that is being composited. A keep-alive protects silent guests while another participant speaks; sessions nearing their per-session limit are recycled safely, and every active stream closes when the talk ends or the operator stops it.

Live audio never depends on the media element’s delayed autoplay attempt. The trusted confirmation click creates and resumes one 48 kHz programme `AudioContext`. Each incoming voice receives a sex- and delivery-aware channel strip—high-pass filtering, low-mid cleanup, presence EQ, conservative compression, and level trim—before a fast master limiter. The visible **Enable audio** action remains only as a browser-policy recovery path. The collapsed LiveAvatar panel reports the latest provider voice-start delay and speaker-to-speaker handoff gap during the programme.

LiveAvatar FULL currently costs 2 credits per active avatar minute. Five AI guests in a five-minute studio therefore have a maximum estimate of 50 credits. An AI moderator also consumes one concurrent session; the total number of AI guests plus an AI moderator cannot exceed five on the current plan. Human seats do not consume LiveAvatar credits.

If the account has **Allow Overage** enabled, a zero plan balance is not treated as a client-side failure: Conclavia requests the session and lets LiveAvatar apply the account’s pay-as-you-go policy. The preflight remains a maximum estimate, not a guarantee of the final bill.

## Seated composition and virtual cameras

The production sets treat each presenter as a chest-up source, which matches LiveAvatar’s real capture model. The flagship After Hours scene places the cast on a subtle depth arc behind a procedural smoked-glass podcast desk with individual microphones and contact lighting. Color Block Club, Electric Commons, Soft Social and the legacy Broadcast Panel use calibrated foreground furniture for the same lower-body occlusion. This creates a coherent panel without stretching or fabricating a presenter’s missing legs. After Hours is the default for every new episode; the older broadcast look remains available only as an explicit stylistic choice.

Camera direction transforms the complete scene—set, presenters, lighting, microphones and foreground desk—as one virtual camera. A full panel establishes the room; `1.52×`, `1.68×` and `1.90×` close-ups let the director move from a relaxed portrait to a deliberate punch-in; and an adjacent two-shot supports direct exchanges. Every camera cue may stay locked, push in slowly or drift laterally. Cuts are instantaneous, with only a two-frame exposure bridge. During one contribution the director can begin loose, tighten on the key claim, insert a two-shot or listener reaction, take a wide breath, and return without interrupting the audio. Shot-aware canvas resolution preserves the active guest instead of enlarging the panel render, while restrained depth-of-field makes every cut read clearly. The AI moderator has a separate keyed host identity and on-camera close-up instead of being voice-only. Animated lower thirds now include an on-air voice meter; timed caption chunks, title and chapter stingers, and the final result card stay inside the 16:9 safe area.

The public green-screen catalog currently exposes five distinct female Studio identities but only three distinct male Studio identities suitable for this shared-set compositor. Additional male seats therefore use alternate official outfits rather than pretending to be new people. A production needing five distinct male presenters should supply purchased custom green-screen avatars through the seat overrides.

LiveAvatar’s official [custom avatar capture guide](https://help.heygen.com/en/articles/9612935-liveavatar-custom-liveavatar-creation-guide) requires chest-up or head-and-shoulders footage and explicitly does not support full-body recordings. Buying a higher plan therefore does not, by itself, create a genuinely seated full-body avatar. If branded custom presenters become important, record each performer while physically seated in a low chair, with restrained posture and a static or green background: their real listening and speaking body language will then match this set. The provider’s [FAQ](https://help.heygen.com/en/articles/12758866-liveavatar-faq) also notes that gestures are learned from the source footage rather than directed dynamically.

For production purchasing, upgrade for an actual delivery requirement—not to solve seating. The current [LiveAvatar plans](https://www.liveavatar.com/) position Essential for longer watermark-free programmes and Business for a bundled 1080p custom avatar and higher concurrency. Starter plus the layered set is enough to validate the format; Business becomes worthwhile only when a consistent proprietary on-air identity matters.

## Broadcast and YouTube workflow

Open `/talks/[id]/run` as the control room and `/talks/[id]/broadcast` as the clean programme output. The episode page labels both destinations explicitly. The output contains no application header, transcript, provider telemetry, or permanent operator buttons. Move the pointer to the upper-right corner to reveal emergency controls; keep it outside the source during recording. The start slate still requires an explicit click and cost confirmation, so a page refresh can never silently open paid sessions. A browser-wide ownership lock guarantees that only one Conclavia window can generate turns or hold paid LiveAvatar sessions for the same episode; a second attempted output stops before provider work starts.

Recommended OBS setup for an initial 1080p production:

1. Add a Browser Source at `1920×1080`, 30 FPS, pointing to the broadcast URL. Enable **Control audio via OBS** so the LiveAvatar programme appears in the OBS mixer.
2. Set the canvas and scaled output to `1920×1080`. Use H.264, CBR at about `8,000 Kbps`, and a two-second keyframe interval for YouTube 1080p30.
3. Use AAC audio at 48 kHz. Add a gentle compressor and a limiter in OBS to keep different guest voices consistent without clipping.
4. Stream to YouTube over RTMPS, or record locally to MKV and remux to MP4 after the show. A local recording is strongly recommended even during a live stream.
5. Run one private/unlisted rehearsal and verify the YouTube stream-health panel before scheduling a public broadcast.

When a run completes, the control room exposes **Download 4K edit plan**. Schema v2 is a deterministic frame-level edit decision list at `3840×2160`, 30 fps, Rec.709 and 48 kHz, with a `-14 LUFS` programme target and `-1 dBTP` ceiling. Every intervention can expand into multiple coverage segments with exact frame ranges, camera IDs, speaker, target, intent, caption, close-up framing, camera motion, adjacent two-shot companion, reaction cue, and hard-cut transition. It is designed as the stable input for a future HyperFrames/FFmpeg or Avatar IV master-render pipeline; it does not pretend that a browser recording is already a native 4K avatar render.

These values follow YouTube’s current [live encoder guidance](https://support.google.com/youtube/answer/2853702) and [upload encoding recommendations](https://support.google.com/youtube/answer/1722171). Increase resolution or bitrate only after measuring the complete machine, network, and five-avatar GPU load.

## Development commands

```bash
npm run dev
npm run lint
npm run build
npm start
```

`npm start` serves the optimized application after a successful build.

## Verified baseline

The current MVP is checked locally with strict TypeScript, linting, and a production build. Runtime QA uses only temporary records in the `conclave` database; every QA talk, run, and audience room is removed afterward without touching the user’s saved episode or any other MongoDB database.

The latest real integration checks used the English question **“Is One Piece the best anime ever?”**. LiveAvatar supplied real H.264 video and audio for five independently warmed guests. In the After Hours run, the same intervention was captured first as a loose lateral portrait and then as a tight moving punch-in while lip sync continued; all five provider sessions subsequently returned a successful stop response. Separate offline captures verified the full panel, close-up and two-shot compositions, desk occlusion, microphone visibility, labels, eye line and the 16:9 safe area. The temporary talk and its run were deleted after verification. These are real integration checks, not a committed automated test suite.

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

The browser only talks to Next.js Route Handlers. MongoDB credentials and provider keys remain server-side; each runner step validates the saved configuration, calls the selected provider, and persists the result before responding. YouTube messages live in a separate `AudienceRoom` collection keyed by run, while the selected cue is copied into the run and final transcript for durable editorial history.

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

Open `/talks/[id]/run` for the control room, or `/talks/[id]/broadcast` for the clean programme feed. The single **Go live** action confirms the maximum LiveAvatar cost, connects the declared AI cast in parallel, creates or resumes the persisted run, and starts automatic direction. Each message is individually persisted. As soon as a turn is ready it is placed in the speech queue; the following contribution can be generated while the current guest is still talking, but synchronized voices never overlap. Persistence and editorial review continue off-air in parallel. If the next guest already has an independent argument ready, the prompt explicitly avoids pretending it is a reply.

The virtual studio has an offline preview before a run begins. During startup, every AI portrait is replaced by its real LiveAvatar feed before the first intervention. Automatic direction uses a full panel for editorial beats, high-resolution close-ups for speakers, short two-shots only when adjacent guests interact, timed listener reactions, and contextual wide cuts. The control room can override this behavior. The badge shows `On air` only while a LiveAvatar is actually speaking.

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
- a YouTube audience desk with optional manual approval and director-controlled routing to the host or any guest
- recent-transcript prompting plus a compact persisted discussion state and per-guest memory
- live text streaming, durable progress, transcript, failure state, retry, and token usage
- a final conclusion card with answer, agreements, disagreements, conditions, and unresolved questions

## Current scope

This repository contains real text generation, guided human turns, persistence, a local-camera proof, and up to five concurrent lip-synced LiveAvatar sessions. Static portraits are offline previews only and are never used as the audiovisual broadcast fallback. Authentication, microphone ingestion, multi-device guests, and recording remain outside this experimental milestone.

When the director selects a human guest or host, the run enters `waiting_for_human`, exposes an on-air input desk, persists the submitted intervention with `origin: human`, and then returns control to the same shared thread. The browser camera is a visual local preview only; the next functional milestone is microphone capture plus realtime transport for remote people and synchronized audio/video direction.
