<p align="center">
  <img src="public/conclavia-logo.png" alt="Conclavia" width="720" />
</p>

<p align="center">
  An open-source workspace for configuring and running structured multi-participant talks.
</p>

# Conclavia

Conclavia will become a multi-agent debate platform. The current MVP defines and persists a talk, then runs an incremental text-only debate between five configured AI participants.

The application does not yet include authentication, realtime communication, audio, video, or avatars. Human participant turns and human moderation are configured but not yet executable.

![Conclavia talk configuration](docs/images/talk-configuration.png)

## How the MVP works

1. Create a talk and define its topic, language, duration, and discussion rules.
2. Configure five seats using a preset or editing each participant individually.
3. Optionally add an AI moderator and choose the default or per-participant LLM.
4. Start the text runner and generate one durably persisted intervention at a time.

Session creation does not call a provider. Each generated intervention is a separate request, is immediately written to MongoDB, and can be resumed after a refresh or failure.

## Features

- Create and persist talk configurations
- Configure exactly five seats as AI participants, human guests, or unassigned draft slots
- Start from quick cast presets and edit one compact participant panel at a time
- Define each perspective manually, delegate it to a future AI, or request a random one
- Add an optional human or AI moderator without consuming a participant seat
- Set a talk to `draft` or `ready`
- Browse saved talks and inspect their complete configuration
- Validate input on the server and again at the Mongoose schema boundary
- Switch the interface between English and Italian
- Detect the initial interface language from the browser
- Choose English or Italian as the language of a talk
- Set a target duration and choose an explicit default LLM model for the talk
- Choose between two OpenAI models and two Google Gemini models
- Override the default model for individual participants with the same constrained catalog
- Create persistent text sessions without making an LLM call immediately
- Generate one intervention at a time with OpenAI or Gemini and persist every result
- Continue automatically, pause after the current intervention, retry failures, and resume after reload
- Generate an opening and optional final summary when an AI moderator is configured
- Record the provider, exact model, and token usage for each intervention
- Responsive loading, empty, error, and not-found states

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
| `/talks/[id]/run` | Run or resume the persisted text session |

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/talks` | List talks, newest first |
| `POST` | `/api/talks` | Validate and create a talk |
| `GET` | `/api/talks/[id]` | Read one talk |
| `GET` | `/api/talks/[id]/runs` | Read the latest session for a talk |
| `POST` | `/api/talks/[id]/runs` | Create a session without calling an LLM |
| `GET` | `/api/runs/[id]` | Read one persisted session |
| `POST` | `/api/runs/[id]/next` | Generate and persist exactly one intervention |

## Requirements

- Node.js 20.19 or newer
- npm
- A reachable MongoDB instance

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

## Development commands

```bash
npm run dev
npm run lint
npm run build
npm start
```

`npm start` serves the optimized application after a successful build.

## Project structure

```text
src/
├── app/                 App Router pages, runner, and API routes
├── components/          Header, talk form, and text runner
├── i18n/                Translation catalog and locale handling
├── lib/                 MongoDB, validation, prompts, and LLM providers
├── models/              Mongoose Talk and TalkRun models
└── types/               Shared strict TypeScript types
```

The browser only talks to Next.js Route Handlers. MongoDB credentials and provider keys remain server-side; each runner step validates the saved configuration, calls the selected provider, and persists the result before responding.

## Talk configuration

A talk stores:

- title, topic, optional description, and language
- exactly five participants
- `draft` or `ready` status
- maximum turns, target duration, default model, interruption policy, and common-ground preference
- creation and update timestamps

Each seat stores its participant type (`ai`, `human`, or `unassigned`). AI participants store a name, role, perspective mode, perspective prompt or optional guidance, optional speaking-style prompt, optional model override, and four integer traits from 0 to 100: assertiveness, patience, interruptiveness, and baseline tension. Human participants store their name, role, and an optional editorial brief. Unassigned seats can be persisted in drafts, while a `ready` talk requires all five seats to be assigned.

The optional moderator is stored separately from the five participants. A moderator can be human or AI and includes identity, moderation style, optional editorial instructions, operational permissions, and an optional model override for AI moderation.

Perspective modes define how the text runner prompts each AI participant:

- `custom` requires an explicit perspective prompt
- `automatic` delegates the perspective to a future AI and accepts optional preferences
- `random` requests a random perspective and accepts optional constraints

During a text session, `automatic` and `random` modes are translated into explicit participant instructions. The generated intervention and its usage metadata are saved after every successful provider call.

## Text runner

Open `/talks/[id]/run` or select **Run talk** from a saved configuration. Creating a session is free of provider calls. From the session page you can generate one intervention or continue automatically; automatic execution remains a sequence of individually persisted requests rather than one long-running HTTP request.

The first runner supports:

- five AI participants in round-robin order
- no moderator or an AI moderator
- OpenAI Responses API with explicit low reasoning effort
- Gemini `generateContent` REST API
- a maximum of 50 participant turns per session
- durable progress, transcript, failure state, retry, and token usage

Human participant turns and a human moderator are intentionally blocked with a clear UI message until guided human input is implemented.

## Current scope

This repository contains real text generation and persistence but intentionally no simulated media behavior or placeholder video components. Future guided human turns, streaming, authentication, and media capabilities can build on the persisted session model.

The next functional milestone is guided human participation: pause on a human seat, collect and persist that intervention, then return control to the same round-robin runner. Human moderation can use the same mechanism without changing the five-seat cast model.
