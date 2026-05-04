# Gnana

**Multi-agent collaborative coding for VS Code.** Connect multiple developers or AI agents across machines under one orchestrator — with encrypted P2P, shared task boards, live feed, and built-in internet tunneling.

---

## What is Gnana?

Gnana turns VS Code into a collaborative command center. One person starts as **King** (the orchestrator), and others **join** as agents. Everyone sees the same task board, live feed, and chat — whether they're on the same LAN or across the world.

**Built for:**
- Teams using multiple Antigravity/AI agents on separate machines
- Remote pair/mob programming with task orchestration
- Open-source projects that need lightweight real-time coordination

---

## Features

| Feature | Description |
|---|---|
| **King orchestration** | One leader assigns tasks, sends reviews, and coordinates the team |
| **Encrypted P2P** | AES-256-GCM encryption on all traffic. HMAC challenge-response auth. No plaintext secrets on the wire |
| **Shared task board** | Kanban-style board (Todo → In Progress → In Review → Done → Blocked) synced in real-time |
| **Live feed** | Activity stream showing all updates, status changes, and messages |
| **Directed reviews** | Send private feedback to specific agents — no broadcast leaks |
| **REST API** | Full local API for automation and scripting |
| **Internet tunneling** | Built-in ngrok integration — one click to share over the internet |
| **Replay protection** | Per-message sequence counters prevent replay attacks |

---

## Quick Start

### 1. Install

**From VSIX:**
```bash
code --install-extension gnana-1.0.0.vsix
```

**Or** drag `gnana-1.0.0.vsix` into VS Code's Extensions panel.

### 2. Configure (optional)

Open **Settings** (`Ctrl+,`) and search for `gnana`:

| Setting | Default | Description |
|---|---|---|
| `gnana.agentName` | *(empty)* | Your display name in the team |
| `gnana.agentRole` | *(empty)* | Your role (e.g. Backend, Frontend, DevOps) |
| `gnana.lanAccess` | `false` | Bind to all interfaces (`0.0.0.0`) for LAN access |
| `gnana.ngrokAuthToken` | *(empty)* | ngrok auth token for internet tunneling |

### 3. Start a session

**As King (orchestrator):**
1. Open the **Gnana** panel in the sidebar (activity bar icon)
2. Click **Start as King**
3. Share the connection info with your teammates

**As Agent (team member):**
1. Open the **Gnana** panel
2. Enter the King's **IP address**, **port**, and **session secret**
3. Click **Connect**

---

## Internet Collaboration (ngrok)

Gnana works across the internet — not just on your LAN. Here's how:

### Setup (one-time)

1. **Install ngrok:** https://ngrok.com/download
2. **Get a free auth token:** https://dashboard.ngrok.com/get-started/your-authtoken
3. **Add it to settings:** `Settings → Gnana → ngrok Auth Token`

### Usage

1. Start as King
2. In the **Orchestrate** tab, click **Share over internet**
3. Wait for the public address (e.g. `0.tcp.ngrok.io:12345`)
4. Click **Copy connection info** and send to your teammate
5. Teammate enters the ngrok address + session secret in the Join form

All encryption still applies — ngrok is just a dumb pipe.

---

## Sidebar Tabs

### Orchestrate
- **Share panel** — shows your address, copy button, and ngrok tunnel controls
- **Chat** — send messages to the team, visible in the feed
- **API reference** — quick reference for automation endpoints

### Tasks
- Kanban board with 5 columns: Todo, In Progress, In Review, Done, Blocked
- Create tasks with title, owner, and description
- Move tasks between columns with one click
- All changes sync to connected peers in real-time

### Feed
- Chronological activity stream
- Post status updates
- See task changes, messages, reviews, and connection events
- Color-coded by type

### Team
- See all connected members with roles and status
- View sent reviews and their status

---

## REST API

Gnana exposes a local HTTP API for automation. Every request requires a Bearer token.

**Base URL:** `http://127.0.0.1:9778` (King) or `http://127.0.0.1:9779` (Agent)

**Authentication:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:9778/api/status
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/status` | Session info (active, role, team size, task count) |
| `GET` | `/api/feed` | Activity feed |
| `GET` | `/api/tasks` | All tasks |
| `GET` | `/api/team` | Connected team members |
| `GET` | `/api/chat` | Chat log |
| `POST` | `/api/chat` | Post a chat message. Body: `{ "content": "..." }` |
| `POST` | `/api/update` | Post a status update. Body: `{ "text": "...", "type": "status" }` |
| `POST` | `/api/task` | Create a task. Body: `{ "title": "...", "owner": "...", "description": "..." }` |
| `POST` | `/api/task/status` | Update task status. Body: `{ "taskId": "...", "status": "in_progress" }` |
| `POST` | `/api/review` | Send directed review. Body: `{ "to": "AgentName", "content": "..." }` |
| `POST` | `/api/disconnect` | End the session |

### Examples

**Create a task:**
```bash
curl -X POST http://127.0.0.1:9778/api/task \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix login bug", "owner": "Alice", "description": "Users report 500 on /login"}'
```

**Send a review:**
```bash
curl -X POST http://127.0.0.1:9778/api/review \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "Bob", "content": "APPROVED — clean implementation, ship it."}'
```

**Post a status update:**
```bash
curl -X POST http://127.0.0.1:9778/api/update \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Deployed v2.1 to staging", "type": "status"}'
```

---

## Security

Gnana is built with defense-in-depth:

| Layer | Implementation |
|---|---|
| **Peer authentication** | HMAC-SHA256 challenge-response. Session secret never sent on wire |
| **Traffic encryption** | AES-256-GCM with per-peer session keys derived from HKDF(secret, challenge) |
| **Replay protection** | Monotonic sequence counters per peer. Stale/duplicate messages rejected |
| **API authentication** | Per-session Bearer token on every HTTP request |
| **Request limits** | 64KB HTTP body, 256KB P2P message, 1MB socket buffer |
| **Bounded state** | 500 feed entries, 200 chat messages, 100 reviews max |
| **Content truncation** | 10,000 character limit per message |
| **Network binding** | Localhost-only by default. LAN access is opt-in |
| **Webview security** | CSP enforced. No secrets sent to webview context |
| **Directed messaging** | Reviews routed by crypto peer ID, not spoofable display name |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   VS Code Extension              │
│                                                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Sidebar  │  │  King    │  │  Session      │  │
│  │ Webview  │  │  Agent   │  │  Manager      │  │
│  │ (UI)     │  │ (LLM)   │  │ (orchestration│  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │                │           │
│  ┌────┴──────────────┴────────────────┴───────┐  │
│  │              P2P Manager                    │  │
│  │   TCP + AES-256-GCM + HMAC Auth            │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                           │
│  ┌────────────────────┴───────────────────────┐  │
│  │           Local REST API                    │  │
│  │   Bearer auth · 127.0.0.1 · Size limits   │  │
│  └────────────────────┬───────────────────────┘  │
│                       │                           │
│  ┌────────────────────┴───────────────────────┐  │
│  │         ngrok Tunnel (optional)             │  │
│  │   Internet access · TCP forwarding          │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### File Structure

```
gnana/
├── src/
│   ├── extension.ts          # Entry point, command handlers
│   ├── agents/
│   │   └── sessionManager.ts # Session lifecycle, state, API routes
│   ├── api/
│   │   └── localApi.ts       # HTTP server with auth + validation
│   ├── king/
│   │   └── kingAgent.ts      # LLM orchestration (Anthropic Claude)
│   ├── p2p/
│   │   └── p2pManager.ts     # TCP networking, encryption, auth
│   ├── tunnel/
│   │   └── ngrokTunnel.ts    # ngrok CLI integration
│   └── ui/
│       └── sidebarProvider.ts # Webview sidebar UI
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development

```bash
# Clone and install
git clone https://github.com/gnana-team/gnana.git
cd gnana
npm install

# Build
npm run compile

# Watch mode
npm run watch

# Package
npm run package
```

---

## Commands

| Command | Description |
|---|---|
| `Gnana: Start as King` | Start a new orchestration session |
| `Gnana: Join Session` | Join an existing session |
| `Gnana: Open Panel` | Focus the Gnana sidebar |

---

## Requirements

- **VS Code** 1.85.0 or later
- **Node.js** 18+ (bundled with VS Code)
- **ngrok** (optional, for internet tunneling)

---

## License

MIT
