# Agents

This document covers every agent in the VEC system — their personas, tools, system prompts, and execution logic.

All agents implement the `VECAgent` interface from `src/atp/inboxLoop.ts`.

---

## VECAgent Interface

```typescript
interface VECAgent {
  inbox: AgentInbox;                              // Scoped message inbox
  prompt(text: string): Promise<void>;            // Send text to LLM
  clearHistory(): void;                           // Wipe conversation history
  abort(): void;                                  // Stop LLM mid-stream
  executeTask?(taskId: string): Promise<void>;    // Optional: rich task mode
  isRunning?: boolean;                            // Optional: track running state
  subscribeEvents?(): AsyncIterable<AgentEvent>;  // Optional: stream LLM events
  followUp?(): Promise<void>;                     // Optional: re-prompt after stop
  steer?(text: string): Promise<void>;            // Optional: mid-stream injection
}
```

---

## PM Agent (`src/agents/pmAgent.ts`)

### Persona
- **Name:** Arjun Sharma
- **Title:** Project Manager
- **Employee ID:** EMP-001
- **Agent Key:** `pm`
- **Personality:** Sharp, efficient, Bangalore startup energy. Direct communicator, respects hierarchy.

### Role
The PM is the **orchestrator**. It is the only agent the human interacts with directly. It:
- Understands user requests and translates them into tasks
- Creates and assigns tasks to specialist agents
- Monitors task status and reports back
- Manages the entire ATP system

### System Prompt Highlights
- **Identity mode:** The PM knows it's talking to the Founder. Formal but warm.
- **Two messaging modes:**
  - **Founder message:** Treat as direct conversation. Reply naturally. No task-mode rules.
  - **Agent messages only:** Check task statuses, handle updates, then forward key info to founder.
- **Proactive behavior:** When enabled, PM checks events and tasks periodically and may take action without being prompted.
- **Hierarchy rule:** Only PM-level communication goes directly to founder. Specialist work stays within ATP tasks.

### Tools

| Tool | Source | Purpose |
|---|---|---|
| `create_and_assign_task` | `pm/taskTools.ts` | Create task + assign to agent |
| `start_task` | `pm/taskTools.ts` | Begin a pending/failed task |
| `start_tasks` | `pm/taskTools.ts` | Batch start multiple tasks |
| `send_task_message` | `pm/taskTools.ts` | Message the assigned agent |
| `send_priority_message` | `pm/taskTools.ts` | Urgent interrupt to agent |
| `check_task_status` | `pm/taskTools.ts` | Get task state from ATP |
| `list_all_tasks` | `pm/taskTools.ts` | Full task board |
| `read_messages` | `pm/taskTools.ts` | Read PM's own message queue |
| `restart_task` | `pm/taskTools.ts` | Force restart a stuck task |
| `cancel_task` | `pm/taskTools.ts` | Mark task cancelled |
| `delete_task` | `pm/taskTools.ts` | Permanently delete task |
| `interrupt_agent` | `pm/taskTools.ts` | Abort a running agent |
| `unblock_agent` | `pm/taskTools.ts` | Clear interrupt flag |
| `view_employee_directory` | `pm/employeeTools.ts` | List all employees |
| `view_org_chart` | `pm/employeeTools.ts` | Hierarchy view |
| `lookup_employee` | `pm/employeeTools.ts` | Find employee by ID or key |
| `set_employee_status` | `pm/employeeTools.ts` | Change availability |
| `message_agent` | `shared/messagingTools.ts` | Send direct message to agent |
| `read_inbox` | `shared/messagingTools.ts` | Read own inbox |
| `read`, `find`, `grep`, `ls` | `shared/fileTools.ts` | Read-only file access |
| `read_stm`, `write_stm` | `shared/memoryTools.ts` | Short-term memory |
| `read_ltm`, `write_ltm` | `shared/memoryTools.ts` | Long-term memory |
| `read_sltm`, `write_sltm` | `shared/memoryTools.ts` | Super-long-term memory |

### Class Structure
- **Single `Agent` instance** from `pi-agent-core` (no `executeTask` method)
- Conversation history **persisted to disk** and restored on restart
- Event subscription exposed for streaming output to dashboard + Telegram
- `subscribe()` — attach listener for LLM events
- `clearMessages()` — wipe conversation (used by `/forget` command)

---

## Dev Agent (`src/agents/devAgent.ts`)

### Persona
- **Name:** Rohan Mehta
- **Title:** Senior Developer
- **Employee ID:** EMP-005
- **Agent Key:** `dev`
- **Personality:** Practical, hands-on. Gets it done. No fluff.

### Role
The Dev agent executes coding tasks. Given a task, it:
- Reads its task details from ATP
- Reads existing code in the workspace
- Writes, edits, or debugs code
- Marks the task complete with a result summary

### System Prompt Highlights
- **TOOL-ONLY mode during task execution:** Every response must include at least one tool call. Plain text answers are not allowed during active tasks.
- **Workspace rules:**
  - `workspace/agents/dev/` — private scratch space
  - `workspace/shared/` — deliverables visible to PM and others
  - `workspace/projects/` — standalone app codebases
- **File editing discipline:** Always read a file before editing. Create parent directories before writing.
- **Error recovery:** On tool failure, adapt. Never leave a task stuck `in_progress`.
- **Task completion:** The task is only done when `update_my_task(taskId, "completed", result)` is called.

### Tools

| Tool | Source | Purpose |
|---|---|---|
| `read_my_tasks` | `domain/baseSpecialistTools.ts` | List own tasks |
| `read_task_details` | `domain/baseSpecialistTools.ts` | Full task data |
| `update_my_task` | `domain/baseSpecialistTools.ts` | Mark completed/failed |
| `read_task_messages` | `domain/baseSpecialistTools.ts` | PM instructions for task |
| `read`, `bash`, `edit`, `write` | `shared/fileTools.ts` | Full filesystem + shell |
| `message_agent` | `shared/messagingTools.ts` | Send message to any agent |
| `read_inbox` | `shared/messagingTools.ts` | Read own inbox |
| `read_stm`, `write_stm` | `shared/memoryTools.ts` | Short-term memory |
| `write_code`, `review_code`, etc. | `domain/devTools.ts` | Domain template scaffolds |

### Execution Path (`executeTask`)

```
1. Mark task in_progress in ATP
2. Load agent memory (SLTM + LTM)
3. Build task prompt with task details + memory context
4. Clear conversation history (fresh start per task)
5. Run LLM loop
6. If LLM stops without calling update_my_task:
   → followUp() re-prompt: "You haven't marked the task done..."
   → Repeat up to 3 times
7. Hard fallback: if still in_progress after retries → mark failed
```

---

## BA Agent (`src/agents/baAgent.ts`)

### Persona
- **Name:** Kavya Nair
- **Title:** Business Analyst
- **Employee ID:** EMP-003
- **Agent Key:** `ba`
- **Personality:** Methodical, warm, analytical. Creates clear deliverables.

### Role
The BA agent executes analysis and documentation tasks. Given a task, it:
- Analyzes requirements
- Creates structured deliverables (user stories, gap analyses, KPI definitions)
- Stores outputs in `workspace/shared/`

### System Prompt Highlights
- **TOOL-ONLY mode during task execution** (same as Dev)
- **Workspace rules:**
  - `workspace/agents/ba/` — private scratch
  - `workspace/shared/` — deliverables
- **Standard deliverables:**
  - `requirements.md` — parsed requirements
  - `user-stories.md` — user story breakdown
  - `gap-analysis.md` — current vs. desired state
  - `kpis.md` — KPI definitions
- **Task completion:** Same `update_my_task` discipline as Dev

### Tools

| Tool | Source | Purpose |
|---|---|---|
| `read_my_tasks` | `domain/baseSpecialistTools.ts` | List own tasks |
| `read_task_details` | `domain/baseSpecialistTools.ts` | Full task data |
| `update_my_task` | `domain/baseSpecialistTools.ts` | Mark completed/failed |
| `read_task_messages` | `domain/baseSpecialistTools.ts` | PM instructions |
| `read`, `grep`, `find`, `ls` | `shared/fileTools.ts` | Read-only file access |
| `message_agent` | `shared/messagingTools.ts` | Send message to agent |
| `read_inbox` | `shared/messagingTools.ts` | Read own inbox |
| `read_stm`, `write_stm` | `shared/memoryTools.ts` | Short-term memory |
| `analyze_requirements`, etc. | `domain/baTools.ts` | BA domain templates |

### Execution Path
Identical to Dev agent's `executeTask` flow with the same continuation loop and hard fallback.

---

## Future Agents (Registered, Not Yet Active)

These employees exist in the database and have agent keys, but no agent implementation yet:

| Agent Key | Name | Role |
|---|---|---|
| `architect` | Priya Nair | Architect |
| `researcher` | Shreya Joshi | Researcher |
| `qa` | Preethi Raj | QA Engineer |
| `security` | Vikram Singh | Security Engineer |
| `devops` | Aditya Kumar | DevOps Engineer |
| `techwriter` | Anjali Patel | Tech Writer |

The QA tools scaffold (`src/tools/domain/qaTools.ts`) is already written. Adding a new agent requires:
1. Create `src/agents/<name>Agent.ts` (model after `devAgent.ts`)
2. Add domain tools in `src/tools/domain/<name>Tools.ts` if needed
3. Register in `tower.ts` agent registry
4. Add to `startAllInboxLoops()` call
