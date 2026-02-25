# Channels

Channels are the interfaces through which humans interact with the VEC system. All channels implement the `VECChannel` interface.

```typescript
interface VECChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendToUser(text: string): Promise<void>;
}
```

---

## CLI (Built into `tower.ts`)

The command-line interface is the primary interaction channel. It uses Node.js's `readline` module.

### Features
- Interactive readline loop
- Slash commands for system control
- Live queue monitor toggle
- PM response streaming to console

### Slash Commands

| Command | Description |
|---|---|
| `/board` | Print full task board |
| `/queue` | Print PM message queue |
| `/events` | Print recent event log (last 20) |
| `/dir` | Print employee directory |
| `/org` | Print org chart |
| `/message <agent> <text>` | Send direct message to any agent |
| `/interrupt <agent>` | Request agent stop |
| `/forget` | Clear PM conversation history |
| `/live` | Toggle live queue monitor |
| `/quit` | Exit the process |

### Live Monitor
When toggled on with `/live`, prints a live view of the agent message queue every 2 seconds. Useful for watching agent-to-agent communication happen in real time.

### PM Streaming
The `attachPmStreaming()` function subscribes to PM's `AgentEvent` stream and prints tokens to the console as the PM LLM generates them:
- Text tokens print as they arrive
- Tool calls show `[calling: tool_name]`
- Tool results show `[result: ...]`

---

## Telegram Bot (`src/channels/telegram.ts`)

Optional Telegram integration using the [grammy](https://grammy.dev/) framework. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.

### Authorization
Only the configured `TELEGRAM_CHAT_ID` can interact with the bot. Positive IDs = private chat, negative IDs = group chat. All other users are rejected.

### Features
- All CLI slash commands available as Telegram commands
- PM responses streamed back to Telegram
- Message batching (Telegram max: 4096 chars per message)
- Routes messages through the same PM queue as CLI

### Supported Commands (in Telegram)
```
/board    — Task board
/queue    — PM queue
/events   — Event log
/dir      — Employee directory
/org      — Org chart
```

Any non-command text is forwarded to the PM as a user message.

### Response Flow
```
User sends Telegram message
    ↓
handleText() validates chat ID
    ↓
Message pushed to pm_queue.json
    ↓
PM processes it (same as CLI)
    ↓
PM events streamed via subscribeEvents()
    ↓
flushReply() batches tokens into messages ≤ 4096 chars
    ↓
Bot.api.sendMessage() sends back to Telegram
```

### Setup
1. Create a bot via [@BotFather](https://t.me/botfather)
2. Get your bot token
3. Get your chat ID (send `/start` to the bot, check [https://api.telegram.org/bot<TOKEN>/getUpdates])
4. Add to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=your_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```

---

## Web Dashboard (`src/dashboard/server.ts`)

An Express HTTP server with a self-contained dark-theme dashboard.

**Port:** `VEC_DASHBOARD_PORT` (default: 3000)
**URL:** `http://localhost:3000`

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Full dashboard HTML (self-contained, no CDN) |
| `GET` | `/api/tasks` | All ATP tasks as JSON |
| `GET` | `/api/employees` | All employees as JSON |
| `GET` | `/api/events` | Last 30 events as JSON |
| `GET` | `/api/queue` | PM message queue as JSON |
| `GET` | `/api/agent-messages` | Inter-agent queue as JSON |
| `GET` | `/api/errors` | Recent errors with classification as JSON |
| `GET` | `/api/chat-log` | User ↔ agent chat history as JSON |
| `POST` | `/api/send-message` | Send a message to any agent |
| `GET` | `/api/stream` | SSE endpoint for live LLM token streaming |

### Dashboard UI Features
- **Dark theme** (GitHub-inspired)
- **Left sidebar** with tabs:
  - Tasks — task board with status badges
  - Employees — employee directory
  - Events — event log
  - Queue — PM message queue
  - Errors — error log with classification
  - Chat — user ↔ agent history
  - Stream — live LLM token viewer
- **Auto-refresh** every 3 seconds
- **Real-time streaming** via SSE (Server-Sent Events)
- Responsive grid layout

### SSE Stream (`/api/stream`)

The stream endpoint uses `agentStreamBus.ts` to push live tokens to the browser:

```
Client connects to GET /api/stream
    ↓
Server holds the connection open (SSE)
    ↓
When any agent LLM call produces tokens:
    publishAgentStream(agentId, event) → emits StreamToken
    ↓
Server writes "data: {json}\n\n" to SSE stream
    ↓
Browser receives token, renders in Stream tab
```

Token types displayed:
- `text` — LLM text output
- `thinking` — Extended thinking tokens (if enabled)
- `tool_call` — Agent is calling a tool
- `tool_result` — Tool returned a result
- `error` — LLM or tool error
- `done` — Agent finished

### Error Classification

The `/api/errors` endpoint classifies errors from the event log:

| Category | Triggers |
|---|---|
| `rate_limit` | "rate limit", "429" in message |
| `timeout` | "timeout", "timed out" |
| `network` | "network", "ECONNREFUSED", "ECONNRESET" |
| `quota` | "quota", "billing" |
| `crashed` | "crashed", "fatal" |
| `generic` | Anything else |

### Sending Messages from Dashboard
The `POST /api/send-message` endpoint accepts:
```json
{
  "agent": "pm",
  "message": "What's the status of TASK-001?"
}
```
Routes through the same PM queue or agent message queue as CLI.
