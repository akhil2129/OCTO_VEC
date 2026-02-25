# ATP Core

The **Agent Task Portal (ATP)** is the backbone of the VEC system. It handles task management, inter-agent messaging, event logging, and agent lifecycle control.

All ATP files live in `src/atp/`.

---

## Data Models (`models.ts`)

### Enums

```typescript
enum TaskStatus {
  pending     = "pending",
  in_progress = "in_progress",
  completed   = "completed",
  failed      = "failed",
  cancelled   = "cancelled"
}

enum Priority {
  high   = "high",
  medium = "medium",
  low    = "low"
}

enum MessageType {
  status_update = "status_update",
  error         = "error",
  info          = "info"
}

enum EmployeeStatus {
  available = "available",
  busy      = "busy",
  offline   = "offline"
}

enum EventType {
  task_created    | task_started     | task_completed
  task_failed     | task_cancelled   | task_updated
  agent_started   | agent_completed  | agent_error
  message_sent    | system_event
}
```

### Key Interfaces

**Task**
```typescript
interface Task {
  task_id: string;          // "TASK-001", "TASK-002", ...
  description: string;      // What needs to be done
  agent_id: string;         // "dev", "ba", "qa", etc.
  priority: Priority;
  status: TaskStatus;
  folder_access?: string;   // Optional workspace path hint
  created_at: string;       // ISO timestamp
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  result?: string;          // Agent's completion summary
}
```

**Employee**
```typescript
interface Employee {
  employee_id: string;      // "EMP-001"
  agent_id: string;         // "pm", "dev", "ba", ...
  name: string;
  designation: string;
  department: string;
  hierarchy_level: number;  // 1 = top, higher = lower
  reports_to?: string;      // employee_id of manager
  status: EmployeeStatus;
  skills: string[];
}
```

**AgentMessage**
```typescript
interface AgentMessage {
  from_agent: string;
  to_agent: string;
  task_id?: string;
  priority: Priority;
  message: string;
  timestamp: string;
}
```

**Event**
```typescript
interface Event {
  timestamp: string;
  event_type: EventType;
  agent_id?: string;
  task_id?: string;
  message: string;
  details?: Record<string, unknown>;
}
```

---

## SQLite Database (`database.ts`)

A **singleton** SQLite database using `better-sqlite3` (synchronous).

**File:** `data/vec_atp.db`

### Tables

**`tasks` table**
```sql
CREATE TABLE tasks (
  task_id      TEXT PRIMARY KEY,
  description  TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  priority     TEXT NOT NULL DEFAULT 'medium',
  status       TEXT NOT NULL DEFAULT 'pending',
  folder_access TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  started_at   TEXT,
  completed_at TEXT,
  result       TEXT
);
```

**`employees` table**
```sql
CREATE TABLE employees (
  employee_id    TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  designation    TEXT NOT NULL,
  department     TEXT NOT NULL,
  hierarchy_level INTEGER NOT NULL DEFAULT 5,
  reports_to     TEXT,
  status         TEXT NOT NULL DEFAULT 'available',
  skills         TEXT NOT NULL DEFAULT '[]'  -- JSON array
);
```

### Key Methods

**Task operations:**
```typescript
createTask(description, agentId, priority?, folderAccess?): Task
getTask(taskId): Task | null
getTasksForAgent(agentId, status?): Task[]
updateTaskStatus(taskId, status, result?): Task | null
getAllTasks(status?, agentId?): Task[]
deleteTask(taskId): boolean
getNextTaskId(): string      // "TASK-001", auto-incremented
```

**Employee operations:**
```typescript
registerEmployee(employee): Employee
getEmployee(employeeId): Employee | null
getEmployeeByAgentId(agentId): Employee | null
listEmployees(statusFilter?, departmentFilter?): Employee[]
updateEmployeeStatus(agentId, status): Employee | null
```

**Reports:**
```typescript
taskBoard(): string           // Formatted ASCII task board
employeeDirectory(): string   // Formatted employee list
orgChart(): string            // ASCII hierarchy tree
getDirectReports(employeeId): Employee[]
```

### Seeded Employees (on first run)

| ID | Name | Role | Agent | Dept | Level | Reports To |
|---|---|---|---|---|---|---|
| EMP-001 | Arjun Sharma | PM | `pm` | Management | 1 | — |
| EMP-002 | Priya Nair | Architect | `architect` | Engineering | 2 | EMP-001 |
| EMP-003 | Kavya Nair | BA | `ba` | Strategy | 2 | EMP-001 |
| EMP-004 | Shreya Joshi | Researcher | `researcher` | Research | 3 | EMP-002 |
| EMP-005 | Rohan Mehta | Dev | `dev` | Engineering | 3 | EMP-002 |
| EMP-006 | Preethi Raj | QA | `qa` | Quality | 3 | EMP-002 |
| EMP-007 | Vikram Singh | Security | `security` | Security | 3 | EMP-002 |
| EMP-008 | Aditya Kumar | DevOps | `devops` | Infrastructure | 3 | EMP-002 |
| EMP-009 | Anjali Patel | TechWriter | `techwriter` | Documentation | 3 | EMP-002 |

---

## PM Message Queue (`messageQueue.ts`)

A **JSON file-backed FIFO queue** for messages from humans to the PM.

**File:** `data/pm_queue.json`

```typescript
// Push a message (CLI, Telegram, Dashboard → PM)
push(message: string): void

// Remove and return N messages
pop(count?: number): string[]

// Drain entire queue
popAll(): string[]

// View without consuming
peek(): string[]

// Utilities
isEmpty(): boolean
count(): number
clear(): void
```

Messages in this queue are plain strings. The PM inbox loop reads them and formats them into LLM prompts.

---

## Agent Message Queue (`agentMessageQueue.ts`)

**JSON file-backed priority queue** for agent-to-agent communication.

**File:** `data/agent_messages.json`

### Core Functions

```typescript
// Send from one agent to another
push(from: string, to: string, message: string, taskId?, priority?): void

// Consume messages for an agent
popForAgent(agentId: string, taskId?, from?, priority?): AgentMessage[]

// View without consuming
peekForAgent(agentId: string, taskId?, from?, priority?): AgentMessage[]

// Send to all agents except sender
broadcast(from: string, message: string, taskId?, priority?): void
```

### Instant Wake System

When a message arrives, the recipient agent doesn't need to wait for the next poll cycle:

```typescript
// Agent registers a callback when it starts
registerInboxWaker(agentId: string, callback: () => void): void

// When push() is called:
// 1. Message written to file
// 2. Recipient's waker callback fired immediately
// 3. Agent loop wakes up without waiting for timer
```

### Valid Agent IDs

```
ba, dev, pm, qa, security, devops, techwriter, architect, researcher, user
```

The `user` agent ID is used to route messages back to the human.

### AgentInbox Class

A **scoped inbox** for per-agent use (avoids passing agentId everywhere):

```typescript
class AgentInbox {
  send(to, message, taskId?, priority?): void
  read(taskId?, from?, priority?): AgentMessage[]
  peek(taskId?, from?, priority?): AgentMessage[]
  hasMessages(taskId?, from?): boolean
  count(): number
  broadcast(message, taskId?, priority?): void
}
```

---

## Event Log (`eventLog.ts`)

**JSON file-backed event log**, max 200 entries, newest first.

**File:** `data/events.json`

```typescript
log(type: EventType, agentId?, taskId?, message?, details?): void
getEvents(limit?: number, since?: string): Event[]
clear(): void
```

> **Important:** `getEvents` takes positional args — `getEvents(50, "")` — NOT an object `getEvents({ limit: 50 })`.

Events are displayed in the dashboard and via the `/events` CLI command.

---

## Chat Log (`chatLog.ts`)

User ↔ agent conversation history, max 200 entries.

**File:** `data/chat-log.json`

```typescript
interface ChatEntry {
  id: string;
  timestamp: string;
  from: string;        // "user" or agent key
  to: string;
  message: string;
  channel: "cli" | "telegram" | "dashboard" | "agent";
}

log(from, to, message, channel?): void
getRecent(limit?: number): ChatEntry[]
clear(): void
```

---

## Agent Interrupt (`agentInterrupt.ts`)

Per-agent **interrupt flags** for stopping agents between tool calls.

```typescript
// PM calls this when user wants to stop an agent
request(agentId: string, reason?: string): void

// Called at the START of every tool execute() function
// Throws an error if flagged, terminating the agent loop
check(agentId: string): void

// PM calls this to let an agent resume
clear(agentId: string): void

isRequested(agentId: string): boolean
getAll(): Record<string, { reason?: string, timestamp: string }>
```

**Flow:**
```
User: /interrupt dev
  → PM calls interrupt_agent("dev")
  → AgentInterrupt.request("dev", "user requested stop")
  → Dev's next tool call: AgentInterrupt.check("dev") throws
  → Dev agent loop catches the error + exits
  → Task may be marked failed
```

---

## LLM Debug Monitor (`llmDebug.ts`)

Detects when an agent's LLM call is stalled (no output for N seconds).

Enabled via `VEC_DEBUG_LLM=1` environment variable.

```typescript
startPromptDebugMonitor(agentId: string): { stop: () => void }
```

Tracks:
- Text deltas emitted
- Thinking deltas emitted
- Tool calls initiated
- Time since last activity

If no activity for `VEC_DEBUG_LLM_STALL_SECS` (default: 20s), logs a warning to EventLog.

---

## Agent Stream Bus (`agentStreamBus.ts`)

**EventEmitter** that broadcasts LLM token events to the dashboard's SSE endpoint.

```typescript
interface StreamToken {
  agentId: string;
  type: "text" | "thinking" | "tool_call" | "tool_result" | "error" | "done";
  content?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  isError?: boolean;
}

// Convert an AgentEvent from pi-agent-core → StreamToken → emit
publishAgentStream(agentId: string, event: AgentEvent): void
```

The dashboard subscribes via `GET /api/stream` (SSE) and renders tokens in real time.
