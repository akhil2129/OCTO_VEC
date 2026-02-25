# Tools Reference

Every tool available to agents in the VEC system, organized by category.

All tools are built using `AgentTool` from `@mariozechner/pi-agent-core`.

> **TypeScript tip:** `AgentTool` has a default generic that makes `params` type `unknown`. Use `execute: async (_, params: any) => {` in all tool implementations to avoid type errors.

---

## PM Tools — Task Management (`src/tools/pm/taskTools.ts`)

Only the PM agent has access to these tools.

### `create_and_assign_task`
Create a new task in ATP and assign it to a specialist agent.

| Param | Type | Description |
|---|---|---|
| `description` | string | What the agent should do |
| `agent_id` | string | "dev", "ba", "qa", etc. |
| `priority` | string | "high", "medium", "low" |
| `auto_start` | boolean | Start immediately after creating |

**Returns:** Task object + confirmation. If `auto_start=true`, triggers `executeTask()` on the agent.

### `start_task`
Begin a pending or failed task.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | "TASK-001" format |

**Task dispatch logic:**
1. If the agent has `executeTask(taskId)` → call it (rich path: marks in_progress, injects memory, detailed prompt)
2. Otherwise → `runAgentInBackground()` (sends a plain inbox message)

Timeout: 6 minutes max.

### `start_tasks`
Batch start multiple tasks.

| Param | Type | Description |
|---|---|---|
| `task_ids` | string[] | Array of task IDs |

### `send_task_message`
Send a message to the agent assigned to a task.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Target task |
| `message` | string | Message content |
| `priority` | string | "high", "medium", "low" |

### `send_priority_message`
Urgent message that interrupts the agent's current work.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Target task |
| `message` | string | Urgent message |

### `check_task_status`
Get current state of a task.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to check |

### `list_all_tasks`
Get all tasks. Returns a formatted board view.

No parameters. Equivalent to `/board` CLI command.

### `read_messages`
Read messages from PM's own inbox.

| Param | Type | Description |
|---|---|---|
| `agent_id` | string | Filter by sender |
| `task_id` | string | Filter by task |

### `restart_task`
Force-restart a stuck task (sets status back to pending then starts it).

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to restart |
| `reason` | string | Why it's being restarted |

### `cancel_task`
Mark a task as cancelled.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to cancel |

### `delete_task`
Permanently delete a task from ATP.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to delete |

### `interrupt_agent`
Set an interrupt flag on an agent (stops it at next tool boundary).

| Param | Type | Description |
|---|---|---|
| `agent_id` | string | Agent to interrupt |

### `unblock_agent`
Clear an interrupt flag (allows agent to resume).

| Param | Type | Description |
|---|---|---|
| `agent_id` | string | Agent to unblock |

---

## PM Tools — Employee Management (`src/tools/pm/employeeTools.ts`)

### `view_employee_directory`
List all employees with optional filtering.

| Param | Type | Description |
|---|---|---|
| `status_filter` | string | "available", "busy", "offline" |
| `department_filter` | string | Filter by department name |

### `view_org_chart`
Display hierarchy tree of all employees.

No parameters.

### `lookup_employee`
Find an employee by ID or agent key.

| Param | Type | Description |
|---|---|---|
| `identifier` | string | "EMP-001" or "dev" or "ba" etc. |

### `set_employee_status`
Update an employee's availability.

| Param | Type | Description |
|---|---|---|
| `agent_id` | string | Agent key ("dev", "ba", etc.) |
| `status` | string | "available", "busy", "offline" |

---

## Specialist Tools — Task Management (`src/tools/domain/baseSpecialistTools.ts`)

All specialist agents (Dev, BA, QA, etc.) get these tools. They also call `AgentInterrupt.check(agentId)` at the start of every execute function.

### `read_my_tasks`
List tasks assigned to this agent.

| Param | Type | Description |
|---|---|---|
| `status` | string | Optional filter: "pending", "in_progress", etc. |

### `read_task_details`
Get full details of a specific task.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to read |

### `update_my_task`
Mark a task as completed or failed. This is the **required exit tool** — every task execution must end with this call.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to close |
| `status` | string | "completed" or "failed" |
| `result` | string | Summary of what was done (or error description) |

### `read_task_messages`
Read PM messages related to a specific task.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Task to read messages for |
| `priority` | string | Optional priority filter |

---

## Shared Tools — Messaging (`src/tools/shared/messagingTools.ts`)

Available to all agents.

### `message_agent`
Send a message to another agent.

| Param | Type | Description |
|---|---|---|
| `to_agent` | string | Recipient agent key |
| `message` | string | Message content |
| `task_id` | string | Optional task reference |
| `priority` | string | "high", "medium", "low" |

### `read_inbox`
Read and consume messages from own inbox.

| Param | Type | Description |
|---|---|---|
| `task_id` | string | Optional filter by task |
| `from_agent` | string | Optional filter by sender |
| `priority` | string | Optional priority filter |

### `broadcast_message`
Send to all agents except self.

| Param | Type | Description |
|---|---|---|
| `message` | string | Message content |
| `task_id` | string | Optional task reference |
| `priority` | string | "high", "medium", "low" |
| `exclude` | string[] | Agent keys to exclude |

---

## Shared Tools — Memory (`src/tools/shared/memoryTools.ts`)

All agents get access to the three-tier memory system. See [memory-system.md](memory-system.md) for full details.

### STM (Short-Term Memory)

| Tool | Description |
|---|---|
| `read_stm` | Read today's scratchpad |
| `write_stm` | Overwrite scratchpad |
| `append_stm` | Add entry to scratchpad |

### LTM (Long-Term Memory)

| Tool | Description |
|---|---|
| `read_ltm(date?)` | Read journal for a date (default: today) |
| `write_ltm` | Overwrite today's journal |
| `append_ltm` | Add entry to today's journal |

### SLTM (Super-Long-Term Memory)

| Tool | Description |
|---|---|
| `read_sltm` | Read permanent memory |
| `write_sltm` | Overwrite permanent memory |
| `append_sltm` | Add to permanent memory |

---

## Shared Tools — Files (`src/tools/shared/fileTools.ts`)

Thin wrappers over `@mariozechner/pi-coding-agent` tools.

### Coding Tools (`getCodingTools(cwd)`) — Dev, DevOps agents

| Tool | Description |
|---|---|
| `read` | Read any file |
| `bash` | Execute shell commands |
| `edit` | In-place file editing |
| `write` | Create or overwrite a file |

### Read-Only Tools (`getReadOnlyTools(cwd)`) — All other agents

| Tool | Description |
|---|---|
| `read` | Read any file |
| `grep` | Search file contents |
| `find` | Find files by pattern |
| `ls` | List directory contents |

Both default to `config.workspace` as the root directory.

---

## Shared Tools — Date (`src/tools/shared/dateTools.ts`)

### `get_current_date`
Returns current date and time info.

**Returns:**
```
Date: Wednesday, 2026-02-25
Time: 14:32:07
Full: Wednesday, 2026-02-25 14:32:07
```

---

## Domain Tools — Developer (`src/tools/domain/devTools.ts`)

Template scaffold tools that help structure the Dev agent's thinking. These don't call external services — they return formatted prompt templates.

| Tool | Description |
|---|---|
| `write_code(description, language, task_id)` | Code writing template |
| `review_code(code_snippet, task_id)` | Code review checklist template |
| `debug_issue(error_description, task_id)` | Debugging analysis template |
| `refactor_code(code_description, refactoring_goals, task_id)` | Refactoring plan template |

---

## Domain Tools — Business Analyst (`src/tools/domain/baTools.ts`)

Template scaffold tools for the BA agent.

| Tool | Description |
|---|---|
| `analyze_requirements(requirement_text, task_id)` | Requirements breakdown template |
| `create_user_story(feature_description, task_id)` | User story template (As a... I want... So that...) |
| `perform_gap_analysis(current_state, desired_state, task_id)` | Gap analysis template |
| `define_kpis(project_description, task_id)` | KPI definition template |

---

## Domain Tools — QA (`src/tools/domain/qaTools.ts`)

Template scaffold tools for the QA agent (when implemented).

| Tool | Description |
|---|---|
| `create_test_plan(feature_description, task_id)` | Test plan structure template |
| `write_test_cases(feature_description, test_type, task_id)` | Test case template |
| `report_bug(bug_description, severity, task_id)` | Bug report template |
| `analyze_test_coverage(codebase_description, task_id)` | Coverage analysis template |

---

## Tool Access Matrix

| Tool Category | PM | Dev | BA | QA | Others |
|---|---|---|---|---|---|
| Task management (PM) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Employee management | ✅ | ❌ | ❌ | ❌ | ❌ |
| Specialist task tools | ❌ | ✅ | ✅ | ✅ | ✅ |
| Messaging | ✅ | ✅ | ✅ | ✅ | ✅ |
| Memory (STM/LTM/SLTM) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Coding tools (bash, edit, write) | ❌ | ✅ | ❌ | ❌ | DevOps ✅ |
| Read-only files | ✅ | ✅ | ✅ | ✅ | ✅ |
| Date tool | ✅ | ✅ | ✅ | ✅ | ✅ |
| Domain tools | ❌ | dev | ba | qa | varies |
