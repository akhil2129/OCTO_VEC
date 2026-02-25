# VEC-ATP Documentation

**VEC** — Virtual Employed Company
**ATP** — Agent Task Portal

A TypeScript multi-agent system where AI agents simulate a real software company. A Project Manager agent delegates tasks to specialist agents (Developer, Business Analyst, QA, etc.), all communicating through an internal messaging and task system.

---

## Quick Start

```bash
npm install
cp .env.example .env   # fill in your API keys
npm start              # launches the system
```

The system starts a CLI loop. Type a message to the PM, or use slash commands:

| Command | Description |
|---|---|
| `/board` | View task board |
| `/queue` | View PM message queue |
| `/events` | Recent event log |
| `/dir` | Employee directory |
| `/org` | Org chart |
| `/message <agent> <text>` | Send message to any agent |
| `/interrupt <agent>` | Stop a running agent |
| `/forget` | Clear PM conversation history |
| `/live` | Toggle live monitor |
| `/quit` | Exit |

---

## Documentation Index

| File | What It Covers |
|---|---|
| [VIBE.md](VIBE.md) | **Start here (for Claude)** — project vibe, patterns, Akhil's style, quick orientation |
| [architecture.md](architecture.md) | System overview, component map, data flow diagrams |
| [agents.md](agents.md) | PM, Dev, BA agent personas, tools, and execution logic |
| [atp-core.md](atp-core.md) | Data models, SQLite database, message queues, event log |
| [tools.md](tools.md) | Every tool available to agents, organized by category |
| [memory-system.md](memory-system.md) | STM / LTM / SLTM memory tiers, history compaction |
| [channels.md](channels.md) | Telegram bot + web dashboard |
| [config.md](config.md) | All environment variables, workspace layout |
| [agent-lifecycle.md](agent-lifecycle.md) | Inbox loops, task execution flow, interrupt system |

---

## Project Structure

```
src/
├── config.ts                   # Env config + workspace paths
├── identity.ts                 # Founder identity (ITS_ME.md)
├── tower.ts                    # Entry point + CLI loop
│
├── atp/                        # Agent Task Portal core
│   ├── models.ts               # TypeScript interfaces + enums
│   ├── database.ts             # SQLite (tasks + employees)
│   ├── messageQueue.ts         # PM inbox (JSON FIFO)
│   ├── agentMessageQueue.ts    # Agent-to-agent messaging
│   ├── eventLog.ts             # Real-time event log
│   ├── chatLog.ts              # User ↔ agent chat history
│   ├── agentInterrupt.ts       # Per-agent interrupt flags
│   ├── inboxLoop.ts            # Inbox loops + VECAgent interface
│   ├── llmDebug.ts             # LLM stall detection
│   └── agentStreamBus.ts       # Token bus for dashboard
│
├── agents/                     # AI agent implementations
│   ├── pmAgent.ts              # Project Manager (orchestrator)
│   ├── devAgent.ts             # Senior Developer
│   └── baAgent.ts              # Business Analyst
│
├── tools/
│   ├── pm/                     # PM-only tools
│   ├── domain/                 # Specialist task tools
│   └── shared/                 # Tools used by all agents
│
├── memory/                     # Memory management
│   ├── agentMemory.ts          # Memory loader
│   ├── compaction.ts           # History compaction
│   └── messageHistory.ts       # Persistent conversation history
│
├── channels/
│   ├── types.ts                # VECChannel interface
│   └── telegram.ts             # Telegram bot (grammy)
│
└── dashboard/
    └── server.ts               # Express HTTP + SSE dashboard
```

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@mariozechner/pi-agent-core` | Agent class, tool system, event streaming |
| `@mariozechner/pi-ai` | LLM provider abstraction (groq, openai) |
| `@mariozechner/pi-coding-agent` | File read/write/bash tools |
| `better-sqlite3` | Synchronous SQLite for tasks + employees |
| `grammy` | Telegram bot framework |
| `express` | Dashboard HTTP server |
| `dotenv` | Environment variable loading |
| `tsx` | TypeScript execution without compilation |

---

## Company Roster

| ID | Name | Role | Agent Key |
|---|---|---|---|
| EMP-001 | Arjun Sharma | Project Manager | `pm` |
| EMP-002 | Priya Nair | Architect | `architect` |
| EMP-003 | Kavya Nair | Business Analyst | `ba` |
| EMP-004 | Shreya Joshi | Researcher | `researcher` |
| EMP-005 | Rohan Mehta | Developer | `dev` |
| EMP-006 | Preethi Raj | QA Engineer | `qa` |
| EMP-007 | Vikram Singh | Security Engineer | `security` |
| EMP-008 | Aditya Kumar | DevOps Engineer | `devops` |
| EMP-009 | Anjali Patel | Tech Writer | `techwriter` |

> Agents currently implemented: `pm`, `dev`, `ba`. Others are registered in the database but not yet active.
