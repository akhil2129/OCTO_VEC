# Memory System

VEC agents have a **three-tier memory architecture** that persists knowledge between sessions. All memory is stored as plain Markdown files, making it human-readable and grep-searchable.

Memory files live in `memory/<agentId>/`.

---

## The Three Tiers

### STM — Short-Term Memory

**File:** `memory/<agentId>/stm.md`
**Purpose:** Daily scratchpad. Resets every day.
**Max entries:** 20
**Use for:** Current task notes, temporary context, things to remember today.

```markdown
# STM - Short-Term Memory
## 2026-02-25
- Working on TASK-042: authentication module
- Reminder: check the shared/auth-spec.md before starting
- PM wants tests included
```

**Tools:** `read_stm`, `write_stm`, `append_stm`

---

### LTM — Long-Term Memory

**File:** `memory/<agentId>/ltm/YYYY-MM-DD_memory.md`
**Purpose:** Daily journal. One file per day. Accumulates over time.
**Use for:** What tasks were completed, what was learned, important decisions made.

```markdown
# LTM - 2026-02-25
- Completed TASK-040: Built the user login API
- Learned: always use bcrypt with rounds >= 12
- TASK-041 failed: DB schema mismatch, PM notified
```

**Tools:** `read_ltm(date?)`, `write_ltm`, `append_ltm`

Reading without a date defaults to today. Pass `YYYY-MM-DD` to read a past entry.

---

### SLTM — Super-Long-Term Memory

**File:** `memory/<agentId>/sltm.md`
**Purpose:** Permanent identity and knowledge. Never resets.
**Use for:** Core skills, key facts about the project, how you prefer to work, things you must never forget.

```markdown
# SLTM - Permanent Memory

## Who I Am
Rohan Mehta, Senior Developer at VEC. I write clean, practical code.

## Project Knowledge
- Main stack: TypeScript, Node.js, SQLite
- Workspace: D:\Akhil\VEC_PROJECT_SPACE
- Always read files before editing

## Key Lessons
- Never leave tasks in in_progress — either complete or fail them
- Use bcrypt for passwords, never plain text
```

**Tools:** `read_sltm`, `write_sltm`, `append_sltm`

---

## Memory Loading

Memory is **automatically injected** into every agent prompt via `src/memory/agentMemory.ts`.

### What Gets Loaded

```
Every LLM prompt includes:
  1. SLTM (permanent memory — always)
  2. Yesterday's LTM (for continuity)
  3. Today's LTM (for current session context)
```

The loader (`loadAgentMemory`) reads all three files and formats them into a markdown block prepended to the prompt.

### First Interaction Detection

```typescript
isFirstInteraction(agentId: string): boolean
markFirstInteractionDone(agentId: string): void
```

On first ever interaction, a `.first_contact_done` marker file is created in the agent's memory folder. This lets the system give new agents an onboarding prompt.

### Memory Search

```typescript
searchAgentMemory(agentId: string, query: string): string
```

Grep-style search across all memory files (STM, LTM journal files, SLTM). Useful for agents to retrieve past context.

---

## Conversation History

Agent LLM conversation history is **separate from memory files** — it's the raw message array that the LLM uses as context.

**Files:** `data/agent-history/<agentId>.json`
**Format:** pi-agent-core message format (array of `{ role, content }` objects)

### Functions (`src/memory/messageHistory.ts`)

```typescript
saveAgentHistory(agentId: string, messages: Message[]): void
loadAgentHistory(agentId: string): Message[]
clearAgentHistory(agentId: string): void
```

- History is **saved after every prompt** (auto-persistence)
- History is **restored on startup** (agents remember their last conversation)
- `/forget` command calls `clearAgentHistory("pm")` to wipe PM's history

---

## History Compaction (`src/memory/compaction.ts`)

Conversation history can grow too large for the LLM context window. The compaction system trims old messages.

```typescript
makeCompactionTransform(maxMessages: number): (messages: Message[]) => Message[]
```

**Rules:**
- Keep the most recent `maxMessages` messages
- Never cut mid-tool-exchange (finds first clean user message boundary)
- Tool call + tool result pairs are kept together

The transform is applied before each prompt to keep context under the model's limit.

---

## Memory Directory Structure

```
memory/
├── pm/
│   ├── sltm.md
│   ├── stm.md
│   ├── .first_contact_done
│   └── ltm/
│       ├── 2026-02-24_memory.md
│       └── 2026-02-25_memory.md
├── dev/
│   ├── sltm.md
│   ├── stm.md
│   └── ltm/
│       └── ...
└── ba/
    └── ...
```

---

## Design Philosophy

The memory system follows an **"OpenClaw-style"** approach:
- All memory is **plain Markdown** — readable by humans without any tooling
- Files are **grep-searchable** — agents can search their own memory
- **No database** for memory — just files
- Memory tools are **simple string operations** — append, overwrite, read
- The system is **explicit** — agents must consciously write to memory (nothing is auto-saved from conversation history)

This keeps memory transparent, inspectable, and easy to debug.
