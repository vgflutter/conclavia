<p align="center">
  <img src="public/conclavia-logo.png" alt="Conclavia" width="720" />
</p>

<p align="center">
  An open-source web application for configuring and saving structured multi-participant talks.
</p>

# Conclavia

Conclavia will become a multi-agent debate platform. This first MVP deliberately focuses on one foundation: defining a talk and persisting its configuration in MongoDB.

The application does not yet generate debates or include AI agents, authentication, realtime communication, audio, video, avatars, or external providers.

## Features

- Create and persist talk configurations
- Configure exactly five participants and their discussion traits
- Set a talk to `draft` or `ready`
- Browse saved talks and inspect their complete configuration
- Validate input on the server and again at the Mongoose schema boundary
- Switch the interface between English and Italian
- Detect the initial interface language from the browser
- Choose English or Italian as the language of a talk
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

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/talks` | List talks, newest first |
| `POST` | `/api/talks` | Validate and create a talk |
| `GET` | `/api/talks/[id]` | Read one talk |

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

## Development

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The interface uses the browser language on the first visit and stores an explicit EN/IT selection in a cookie.

## Validation and production build

```bash
npm run lint
npm run build
```

Run the production server after a successful build:

```bash
npm start
```

## Project structure

```text
src/
├── app/                 App Router pages and API routes
├── components/          Header and talk configuration form
├── i18n/                Translation catalog and locale handling
├── lib/                 MongoDB connection, validation, serialization
├── models/              Mongoose Talk model
└── types/               Shared strict TypeScript types
```

## Talk configuration

A talk stores:

- title, topic, optional description, and language
- exactly five participants
- `draft` or `ready` status
- maximum turns, interruption policy, and common-ground preference
- creation and update timestamps

Each participant stores a name, role, perspective prompt, optional speaking-style prompt, and four integer traits from 0 to 100: assertiveness, patience, interruptiveness, and baseline tension.

## Current scope

This repository contains configuration and persistence only. It intentionally contains no simulated AI behavior or placeholder media components. Future agent and media capabilities can build on the persisted talk model without being faked in the MVP.
