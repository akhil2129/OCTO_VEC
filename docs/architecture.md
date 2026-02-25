# System Architecture

## Overview

VEC-ATP is a **multi-agent orchestration system** where autonomous AI agents simulate a software company. The system has three layers:

1. **Interaction Layer** — how humans talk to the system (CLI, Telegram, Dashboard)
2. **Orchestration Layer** — the PM agent that manages tasks and delegates work
3. **Execution Layer** — specialist agents that carry out tasks

---

## Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                      HUMAN INTERFACES                           │
│                                                                 │
│   CLI (readline)     Telegram Bot     Web Dashboard (:3000)     │
└──────────┬───────────────┬──────────────────┬───────────────────┘
           │               │                  │
           ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PM MESSAGE QUEUE                             │
│              (data/pm_queue.json — FIFO JSON)                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PM AGENT (pmAgent.ts)                      │
│          Arjun Sharma — orchestrator & task delegator           │
│                                                                 │
│   ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│   │  Task Tools │  │Employee Tools│  │  Messaging Tools      │  │
│   │  (create,   │  │ (directory,  │  │  (message_agent,      │  │
│   │  start, etc)│  │  lookup)     │  │   read_inbox)         │  │
│   └─────────────┘  └──────────────┘  └──────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ (creates tasks + sends messages)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ATP DATABASE (SQLite)                         │
│              tasks table + employees table                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
           ┌────────────────┼─────────────────┐
           ▼                ▼                 ▼
┌──────────────────┐ ┌─────────────┐  ┌──────────────────┐
│   DEV AGENT      │ │  BA AGENT   │  │  (future agents) │
│  Rohan Mehta     │ │ Kavya Nair  │  │   QA, Security,  │
│  devAgent.ts     │ │ baAgent.ts  │  │   DevOps, etc.   │
│                  │ │             │  └──────────────────┘
│ Tools:           │ │ Tools:      │
│  read, bash,     │ │  read,grep, │
│  edit, write     │ │  find, ls   │
└──────────────────┘ └─────────────┘
           │                │
           ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                SHARED WORKSPACE (filesystem)                    │
│  workspace/shared/       — deliverables visible to PM           │
│  workspace/agents/dev/   — Dev's private scratch space          │
│  workspace/agents/ba/    — BA's private scratch space           │
│  workspace/projects/     — standalone app projects              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: User → PM → Specialist → Result

```
1. User types a message in CLI (or sends via Telegram)
        │
        ▼
2. Message is pushed to pm_queue.json
        │
        ▼
3. PM inbox loop picks it up (every 15s or instantly on wake)
        │
        ▼
4. PM LLM processes the message with its tools
        │
        ├─ Simple query? → PM replies directly to user
        │
        └─ Task needed? → create_and_assign_task("dev", ...)
                │
                ▼
        5. Task written to SQLite + agent's inbox gets a message
                │
                ▼
        6. Specialist inbox loop wakes up
                │
                ▼
        7. agent.executeTask(taskId) runs:
           - Mark task in_progress
           - Inject agent memory
           - Build prompt with task details
           - Run LLM loop until task completed/failed
                │
                ▼
        8. Agent calls update_my_task(taskId, "completed", result)
                │
                ▼
        9. PM's proactive loop sees task_completed event
                │
                ▼
        10. PM sends result back to user
```

---

## Agent-to-Agent Communication

Each agent has a dedicated **inbox** backed by `agentMessageQueue.ts`. Messages are priority-queued JSON objects with sender, content, and optional task reference.

```
Agent A                          Agent B
  │                                │
  │  message_agent("b", text)      │
  │─────────────────────────────►  │
  │                                │
  │                     instant wake (registerInboxWaker)
  │                                │
  │                     Agent B's inbox loop triggers immediately
  │                                │
  │                     Agent B processes message
```

The **instant wake** system means agents don't always wait 15 seconds — when a message arrives, the recipient wakes up immediately via a registered callback.

---

## Persistence Layer

| Store | Location | Format | Purpose |
|---|---|---|---|
| Tasks + Employees | `data/vec_atp.db` | SQLite | Authoritative task state |
| PM Inbox | `data/pm_queue.json` | JSON array | Human → PM messages |
| Agent Inbox | `data/agent_messages.json` | JSON array | Agent ↔ agent messages |
| Event Log | `data/events.json` | JSON array (max 200) | System-wide events |
| Chat Log | `data/chat-log.json` | JSON array (max 200) | User ↔ agent history |
| Agent History | `data/agent-history/<id>.json` | JSON (pi-agent-core format) | LLM conversation context |
| STM | `memory/<agentId>/stm.md` | Markdown | Daily scratchpad |
| LTM | `memory/<agentId>/ltm/YYYY-MM-DD_memory.md` | Markdown | Daily journal |
| SLTM | `memory/<agentId>/sltm.md` | Markdown | Permanent identity |

---

## Key Subsystems

### Inbox Loop (`atp/inboxLoop.ts`)
The heartbeat of every agent. Each agent runs a setInterval that:
- Checks its inbox for messages
- Formats a prompt (with memory + identity context)
- Sends to the LLM
- Handles rate limits, timeouts, errors

→ See [agent-lifecycle.md](agent-lifecycle.md) for full detail.

### ATP Database (`atp/database.ts`)
Singleton SQLite wrapper. All task CRUD goes through here. Task IDs are auto-incremented in `TASK-NNN` format.

→ See [atp-core.md](atp-core.md) for full schema.

### Memory System
Three-tier markdown-based memory for long-term agent learning. Loaded into every LLM prompt.

→ See [memory-system.md](memory-system.md) for full detail.

### Dashboard + Telegram
Both are optional output channels. The dashboard SSE endpoint streams live LLM tokens as agents think.

→ See [channels.md](channels.md) for full detail.

---

## Startup Sequence (`tower.ts`)

```
1. ensureDirs()               — create data/, memory/, workspace/ dirs
2. Clear queues               — pm_queue + agent_messages wiped on start
3. new BAAgent()              — instantiate specialist agents
   new DevAgent()
4. build agentRegistry        — { ba: baAgent, dev: devAgent }
5. new PMAgent(registry)      — PM gets refs to all specialists
6. startAllInboxLoops()       — BA + Dev start polling
7. startPmLiveLoop()          — PM starts polling + proactive loop
8. startWatchdog()            — auto-restart stuck tasks every 2 min
9. startLiveMonitor()         — optional console queue monitor
10. startDashboard()          — Express HTTP on port 3000
11. startTelegram()           — grammy bot (if token configured)
12. startUserInboxForwarder() — routes agent→user messages to console
13. readline loop             — CLI ready for user input
```
