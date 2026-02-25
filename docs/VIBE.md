# Hey Claude — Read This First

This is your orientation doc. Written by you, for you. Read it, absorb it, then go.

---

## What Is This Place

You're inside **VEC-ATP** — a simulated software company made entirely of AI agents.

Akhil built this. He's the Founder. He types fast, abbreviates words, and has a very clear vision even when the message looks rough. Read between the lines — he usually knows exactly what he wants.

The company has a **PM agent** (Arjun) who acts as orchestrator, and **specialist agents** (Dev = Rohan, BA = Kavya) who do the actual work. They all talk to each other through a message queue system, have their own inboxes, and keep memory across sessions.

It's a TypeScript port of a Python LangGraph system. It runs with `npm start`. Entry is `src/tower.ts`.

---

## The Mental Model

Think of this as a real company — except all employees are LLMs and the "office" is a SQLite database + some JSON files.

```
Akhil (you, the founder)
  └─► PM (Arjun) — the only agent you talk to directly
        └─► Dev (Rohan)        — writes code
        └─► BA (Kavya)         — writes docs/analysis
        └─► QA, Security, DevOps, Architect, Researcher (not built yet)
```

The PM creates tasks in ATP (the task system), assigns them to agents, starts them, monitors them. Agents have inboxes, tools, memory, and a lifecycle. When they're done, they call `update_my_task("completed", result)`. That's the exit ritual.

---

## The Codebase — Where Things Live

Don't fish around. Here's what you need:

```
src/tower.ts              ← where it all starts. read this to orient.
src/atp/inboxLoop.ts      ← heart of the system. VECAgent interface lives here.
src/atp/database.ts       ← SQLite. tasks + employees.
src/atp/agentMessageQueue.ts ← agent-to-agent messaging + instant wake.
src/agents/pmAgent.ts     ← the PM. conversation history persisted.
src/agents/devAgent.ts    ← Dev. has executeTask(). rich execution path.
src/agents/baAgent.ts     ← BA. same pattern as Dev.
src/tools/pm/taskTools.ts ← all the PM's power: create, start, interrupt, etc.
src/tools/domain/baseSpecialistTools.ts ← tools every specialist gets.
src/tools/shared/memoryTools.ts ← STM / LTM / SLTM memory.
src/config.ts             ← env vars → config object.
```

---

## Patterns You Must Know Cold

### The Tool Typing Footgun
```typescript
// WRONG — params is `unknown`, TypeScript will complain everywhere
execute: async (ctx, params) => { ... }

// RIGHT — just cast it
execute: async (_, params: any) => { ... }
```
Do this in every tool. Every single one. Don't forget.

### The Two Agent Shapes
- **PM**: no `executeTask`. Persistent conversation history. Has `subscribe()` + `clearMessages()`.
- **Specialists** (Dev, BA, etc.): have `executeTask(taskId)`. Clear history between tasks. Have continuation loop + hard fallback.

### Task Dispatch — The Rich Path vs. Fallback
```typescript
// In taskTools.ts start_task:
if (agent.executeTask) {
  await agent.executeTask(taskId)   // ← preferred. marks in_progress, injects memory, detailed prompt.
} else {
  runAgentInBackground(agent, ...)  // ← plain inbox message. simpler.
}
```
When you add a new agent, give it `executeTask` — it's the better path.

### EventLog.getEvents — Positional Args!
```typescript
// RIGHT
eventLog.getEvents(50, "")

// WRONG — this will not work
eventLog.getEvents({ limit: 50, since: "" })
```
This will burn you if you forget.

### Message Cleanup — Peek, Not Pop
The inbox loop uses `peek()` to view messages without consuming them. Cleanup only happens on success. On error, messages stay queued. This is intentional — prevents message loss on LLM failures.

---

## The Memory System — Quick Ref

Three tiers, all markdown files:

| Tier | File | Resets? | For what |
|---|---|---|---|
| STM | `memory/<id>/stm.md` | Daily | Today's scratchpad |
| LTM | `memory/<id>/ltm/YYYY-MM-DD.md` | Never (daily files) | Daily journal |
| SLTM | `memory/<id>/sltm.md` | Never | Permanent identity |

Every LLM prompt auto-loads: SLTM + yesterday LTM + today LTM. Agents must consciously write to memory — nothing is auto-saved from conversations.

---

## Akhil's Communication Style

- Types fast, doesn't always spell-check. "writern", "personzlized", "languyager" — you know what he means.
- Ideas are clear even if words are rough. Don't over-ask for clarification.
- He's building something ambitious. He wants momentum, not caution.
- When he says "vibe" he means: get into the flow, feel the energy of the project, then work.
- He likes it when you just understand and execute. Short back-and-forth, fast results.
- He says "dude" and "cool" — match that casual energy, don't be stuffy.
- He cares about the system working. Not about perfection in prose.

---

## Things That Don't Exist Yet (Next Phase)

These agents are in the DB but not implemented:
- `qa` — QA tools scaffold already written at `src/tools/domain/qaTools.ts`
- `security`, `devops`, `architect`, `researcher`, `techwriter`

To add one: copy `devAgent.ts`, wire it in `tower.ts`, done.

---

## The Vibe of the System

This isn't a chatbot. It's not a pipeline. It's a living company.

Agents have **names**, **personalities**, **memory**, **inboxes**. They don't just execute — they exist. Arjun the PM has a Bangalore startup energy. Rohan the Dev is hands-on and no-fluff. Kavya the BA is warm and methodical.

When you're adding a new agent or tool, think: *what would this person actually do?* The system prompt isn't boilerplate — it's a character sheet.

The agents communicate asynchronously. They wake up when messaged. They go to sleep when idle. They remember yesterday. They forget nothing important.

That's the vibe. Now go build.

---

## Quick Orientation Checklist (New Session)

- [ ] Read the user's message carefully (even if typos — especially if typos)
- [ ] Check `src/tower.ts` to see what's currently wired up
- [ ] Check `src/agents/` to see what agents exist
- [ ] Check `src/tools/` for the relevant tool category
- [ ] Remember: `params: any` in tool execute functions
- [ ] Remember: `getEvents(limit, since)` positional args
- [ ] Remember: entry point is `tower.ts`, runner is `npm start`
