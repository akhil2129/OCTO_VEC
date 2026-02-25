# Agent Lifecycle

This document explains how agents are kept alive, how they receive and process messages, how tasks are executed, and how the interrupt system works.

All lifecycle code lives in `src/atp/inboxLoop.ts`.

---

## The Inbox Loop

Every agent runs a **polling loop** that checks its inbox and dispatches messages to the LLM.

```
┌─────────────────────────────────────────┐
│           INBOX LOOP (per agent)        │
│                                         │
│  every 15s (or instantly on wake):      │
│  ┌─────────────────────────────────┐    │
│  │ 1. peek() agent inbox          │    │
│  │ 2. if empty → skip             │    │
│  │ 3. format prompt               │    │
│  │    (identity + memory +        │    │
│  │     messages + WHAT TO DO NOW) │    │
│  │ 4. send to LLM (2 min timeout) │    │
│  │ 5. SUCCESS:                    │    │
│  │    - cleanup messages          │    │
│  │    - run afterPrompt()         │    │
│  │ 6. ERROR:                      │    │
│  │    - rate limit → backoff      │    │
│  │    - other → cooldown 30s      │    │
│  │    - messages stay for retry   │    │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Key Constants

| Constant | Value | Description |
|---|---|---|
| `POLL_INTERVAL_MS` | 15,000ms | Default inbox check frequency |
| `AGENT_PROMPT_TIMEOUT_MS` | 120,000ms (2 min) | Max time per LLM call |

### Instant Wake

Agents don't always wait for the 15-second timer. When a message arrives in their inbox, they wake up immediately:

```typescript
// In agentMessageQueue.ts
registerInboxWaker(agentId, callback)

// When push(to: agentId, ...) is called:
// → callback() is fired immediately
// → Agent's interval check runs now, not in 15s
```

### Message Cleanup Strategy

The inbox loop uses **peek-then-cleanup** to avoid message loss:

```
1. peek() — view messages WITHOUT consuming them
2. Agent runs. LLM may call read_inbox() tool to get details.
3. On SUCCESS:
   - cleanup: delete only messages that existed at peek time
   - New messages that arrived DURING the LLM call are preserved
4. On ERROR:
   - cleanup is skipped
   - Messages stay in queue for next retry
```

This prevents the case where:
- Message A arrives, agent starts processing
- Agent fails mid-way
- Message A is lost even though it was never handled

---

## PM Live Loop (`startPmLiveLoop`)

The PM has a special loop with two modes:

### Reactive Mode (always on)
Processes messages from `pm_queue.json` (human → PM messages). Same peek-then-cleanup logic.

### Proactive Mode (opt-in via `VEC_PM_PROACTIVE_ENABLED=1`)
Runs on a separate interval (`VEC_PM_PROACTIVE_INTERVAL_SECS`, min 10s). The PM checks:
- Recent events (task completions, failures, agent messages)
- Pending tasks that may need attention
- And takes action if needed (e.g., reassign failed tasks, notify founder)

---

## Prompt Construction

Every LLM call builds a structured prompt:

### For PM (founder message)
```
[identity reminder]
[memory: SLTM + LTM]
[message from Founder: ...]
```
No task-mode rules. The PM responds naturally to the founder.

### For PM (agent messages only)
```
[identity reminder]
[memory: SLTM + LTM]
[messages from agents: ...]
[WHAT TO DO NOW: review updates, check tasks, notify founder if needed]
```

### For Specialists (Dev, BA, etc.)
```
[identity reminder]
[memory: SLTM + LTM]
[inbox messages: ...]
[WHAT TO DO NOW:
  1. If a greeting → greet back
  2. If a question → answer it
  3. If you need to build something → start the task
  4. If you're working on a task → check it
  5. If it's just info → acknowledge
]
```

---

## Task Execution (`executeTask`)

When the PM creates a task with `auto_start=true` or calls `start_task`, the system calls `agent.executeTask(taskId)`.

```
executeTask(taskId):
  ├─ 1. Get task from ATP database
  ├─ 2. Mark task status → in_progress
  ├─ 3. Update employee status → busy
  ├─ 4. Load agent memory (SLTM + LTM)
  ├─ 5. Clear conversation history (fresh context)
  ├─ 6. Build task prompt:
  │      - Who you are
  │      - Memory context
  │      - Task details (ID, description, priority, folder)
  │      - Task messages from PM (if any)
  │      - EXECUTE NOW instruction
  ├─ 7. Run LLM (prompt())
  ├─ 8. CONTINUATION LOOP (up to 3 retries):
  │      - Check if task still in_progress
  │      - If yes → followUp(): "You haven't marked the task done..."
  │      - Wait for LLM to call update_my_task
  └─ 9. HARD FALLBACK:
         - After 3 retries, if still in_progress
         - Mark task failed: "Agent did not complete task"
         - Update employee status → available
```

### Why the Continuation Loop?

LLMs sometimes stop generating (e.g., after a very long tool result) without calling `update_my_task`. The `followUp()` call re-prompts the agent to continue, effectively injecting "keep going" without losing the conversation context.

---

## Agent Lifecycle States

```
                    ┌──────────┐
                    │  idle    │ ← waiting for inbox messages
                    └──────────┘
                         │
          message arrives (instant wake or poll)
                         │
                         ▼
                    ┌──────────┐
                    │ running  │ ← LLM is generating
                    └──────────┘
                    │         │
               success      error/interrupt
                    │         │
                    ▼         ▼
               cleanup    cooldown
                    │         │
                    └────┬────┘
                         │
                         ▼
                    ┌──────────┐
                    │  idle    │ ← ready for next message
                    └──────────┘
```

---

## Interrupt System

The interrupt system lets the PM (or user) stop a running agent between tool calls.

### Flow

```
User: /interrupt dev
  ↓
PM calls interrupt_agent("dev") tool
  ↓
AgentInterrupt.request("dev", "user requested stop")
  ↓
Dev's NEXT tool call execute() runs:
  AgentInterrupt.check("dev")
  → throws Error("Interrupted: user requested stop")
  ↓
Agent loop catches the error
  ↓
Task may be marked failed (if executeTask is running)
  ↓
Agent returns to idle state
```

### In Tool Code

Every specialist tool's `execute` function starts with:

```typescript
execute: async (_, params: any) => {
  AgentInterrupt.check(agentId);  // ← throws if interrupted
  // ... rest of tool logic
}
```

This means interrupts are **not instant** — they take effect at the next tool call boundary, not mid-generation.

### Clearing Interrupts

```typescript
// PM calls unblock_agent("dev") tool
// → AgentInterrupt.clear("dev")
// → Agent can receive tasks again
```

---

## Watchdog

A separate timer runs every 2 minutes and looks for **stuck tasks** — tasks in `in_progress` status that haven't been updated recently.

```
Every 2 minutes:
  1. Query all in_progress tasks
  2. For each task older than threshold:
     → Log warning event
     → Optionally restart task
     → Notify PM
```

This prevents tasks from being stuck forever if an agent crashes without calling `update_my_task`.

---

## Rate Limit Handling

When the LLM API returns a rate limit error (HTTP 429):

```
1. Parse retry-after header (or backoff from message)
2. Log rate_limit event
3. Wait the specified duration
4. Retry the same prompt
5. Messages stay in inbox (not cleaned up)
```

Backoff time is extracted from the error message with a regex that matches common formats like "retry after 30 seconds" or "retry-after: 30".

---

## Error Recovery

On any non-rate-limit error during an LLM call:

```
1. Log error event
2. If in executeTask mode:
   → Mark task failed in ATP
   → Update employee status → available
3. Cooldown 30 seconds
4. Inbox messages stay queued (not lost)
5. Agent returns to idle
```

The 30-second cooldown prevents tight error loops from hammering the API.
