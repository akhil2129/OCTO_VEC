/**
 * TOWER — VEC entry point.
 * Initialises all infrastructure, creates agents, starts inbox loops,
 * and runs an interactive readline loop for the founder (Akhil) to talk to the PM.
 */

import readline from "readline";
import fs from "fs";

import { config, sharedWorkspace, agentWorkspace, WORKSPACE_DIRS } from "./config.js";
import { founder } from "./identity.js";
import { loadAgentMemory, isFirstInteraction, markFirstInteractionDone } from "./memory/agentMemory.js";
import { ATPDatabase } from "./atp/database.js";
import { MessageQueue } from "./atp/messageQueue.js";
import { AgentMessageQueue, AGENT_DISPLAY_NAMES } from "./atp/agentMessageQueue.js";
import { EventLog } from "./atp/eventLog.js";
import { EventType } from "./atp/models.js";
import { startAllInboxLoops, startPmLiveLoop } from "./atp/inboxLoop.js";
import type { VECAgent } from "./atp/inboxLoop.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

import { BAAgent } from "./agents/baAgent.js";
import { DevAgent } from "./agents/devAgent.js";
import { PMAgent } from "./agents/pmAgent.js";
import { startDashboardServer } from "./dashboard/server.js";
import { AgentInterrupt } from "./atp/agentInterrupt.js";
import { createTelegramChannel } from "./channels/telegram.js";
import { ActiveChannelState } from "./channels/activeChannel.js";
import { UserChatLog } from "./atp/chatLog.js";
import { clearAgentHistory } from "./memory/messageHistory.js";
import { publishAgentStream } from "./atp/agentStreamBus.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [config.dataDir, config.memoryDir, ...WORKSPACE_DIRS]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function printBanner(): void {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║       VEC — Virtual Employed Company              ║");
  console.log("║       TOWER  |  Agent Task Portal                 ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Model    : ${config.modelProvider}/${config.model}`);
  console.log(`  Thinking : ${config.thinkingLevel}`);
  console.log(
    `  LLM Debug: ${
      config.debugLlm ? `ON (stall>${config.debugLlmStallSecs}s)` : "OFF (set VEC_DEBUG_LLM=1)"
    }`
  );
  console.log(`  Workspace: ${config.workspace}`);
  console.log(`    Shared : workspace/shared/         (cross-agent deliverables)`);
  console.log(`    Agents : workspace/agents/{id}/    (per-agent private folders)`);
  console.log(`  Proactive: ${config.pmProactiveEnabled ? `ON (every ${config.pmProactiveIntervalSecs}s)` : "OFF"}`);
  console.log(`  Dashboard: http://localhost:${config.dashboardPort}`);
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  console.log(`  Telegram : ${tgChatId ? `active (chat ${tgChatId})` : "disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable)"}`);
  console.log(`  CLI      : ${config.cliEnabled ? "ON" : "OFF (headless — set VEC_CLI_ENABLED=1 to enable)"}`);
  if (config.cliEnabled) {
    console.log("  /board   — Task board (SQLite)");
    console.log("  /queue   — PM message queue");
    console.log("  /events  — Recent event log (last 20)");
    console.log("  /dir     — Employee directory");
    console.log("  /message   — Message any agent directly");
    console.log("  /interrupt — Stop a running agent mid-task");
    console.log("  /forget    — Clear PM conversation history");
    console.log("  /live      — Toggle live queue monitor");
  }
  if (config.cliEnabled) console.log("  /quit      — Exit");
  console.log("");
}

// ── PM event handler for streaming output ─────────────────────────────────

function attachPmStreaming(pmAgent: PMAgent): void {
  let headerPrinted = false;
  let onNewLine = true;
  let capturedText = "";
  let messageAgentCalled = false;

  pmAgent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        headerPrinted = false;
        onNewLine = true;
        capturedText = "";
        messageAgentCalled = false;
        publishAgentStream("pm", event);
        break;

      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta" && ae.delta) {
          publishAgentStream("pm", event);
          capturedText += ae.delta;
          if (!headerPrinted) {
            process.stdout.write("\nArjun (PM): ");
            headerPrinted = true;
            onNewLine = false;
          }
          process.stdout.write(ae.delta);
          onNewLine = ae.delta.endsWith("\n");
        }
        break;
      }

      case "tool_execution_start":
        if (!onNewLine) process.stdout.write("\n");
        process.stdout.write(`  [${event.toolName}] `);
        onNewLine = false;
        if (event.toolName === "message_agent") messageAgentCalled = true;
        publishAgentStream("pm", event);
        break;

      case "tool_execution_end":
        process.stdout.write(event.isError ? "ERROR\n" : "done\n");
        onNewLine = true;
        publishAgentStream("pm", event);
        break;

      case "agent_end": {
        if (!onNewLine) process.stdout.write("\n");
        onNewLine = true;
        publishAgentStream("pm", event);
        // Fallback: if PM generated text but never called message_agent,
        // the model output plain text instead of a tool call (Kimi K2 quirk).
        // Capture it directly so it appears in Teams chat.
        // Skip if this was a Telegram-originated prompt — Telegram handles its own reply.
        const text = capturedText.trim();
        if (text && !messageAgentCalled && ActiveChannelState.get() !== "telegram") {
          UserChatLog.log({ from: "pm", to: "user", message: text, channel: "agent" });
        }
        capturedText = "";
        messageAgentCalled = false;
        break;
      }

      default:
        break;
    }
  });
}

// ── Live PM queue monitor ──────────────────────────────────────────────────

function startLiveMonitor(): { toggle: () => boolean; interval: NodeJS.Timeout } {
  let enabled = true;
  const seen = new Set<string>();

  const interval = setInterval(() => {
    if (!enabled) return;
    const messages = MessageQueue.peek();
    for (const msg of messages) {
      const key = `${msg.timestamp}|${msg.from_agent}|${msg.task_id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const tag =
        msg.type === "error"
          ? "[ERR]"
          : msg.type === "status_update"
          ? "[UPDATE]"
          : "[INFO]";
      const taskRef = msg.task_id ? ` ${msg.task_id}` : "";
      console.log(
        `\n  ${tag} ${msg.from_agent.toUpperCase()}${taskRef}: ${msg.message.substring(0, 120)}`
      );
    }
  }, 2_000);

  return {
    toggle: () => {
      enabled = !enabled;
      return enabled;
    },
    interval,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Ensure all data/memory/workspace directories exist
  ensureDirs();

  // 2. Clear transient state from previous run
  AgentMessageQueue.clear();
  AgentMessageQueue.clearFlowLog();
  EventLog.clear();

  // 3. Create specialist agents
  const deps = {
    db: ATPDatabase,
    pmQueue: MessageQueue,
    agentQueue: AgentMessageQueue,
  };

  const baAgent = new BAAgent(deps);
  const devAgent = new DevAgent(deps);

  // 4. Build agent registry (all specialist agents PM can dispatch to)
  const agentRegistry = new Map<string, VECAgent>([
    ["ba", baAgent],
    ["dev", devAgent],
  ]);

  // 5. Create PM agent with full deps + agent registry
  const pmAgent = new PMAgent({ ...deps, agents: agentRegistry });

  // 6. Attach streaming output to PM agent
  attachPmStreaming(pmAgent);

  // 7. Start background inbox loops.
  //    afterPromptFactory: after each inbox prompt, if the agent left any tasks
  //    in_progress without calling update_my_task, route them through executeTask()
  //    so the re-prompt loop kicks in and drives the task to completion.
  const specialistHandles = startAllInboxLoops(
    agentRegistry,
    undefined,
    (agentId, agent) => {
      if (typeof agent.executeTask !== "function") return undefined;
      return async () => {
        const inProgress = ATPDatabase.getAllTasks("in_progress").filter(
          (t) => t.agent_id === agentId
        );
        for (const task of inProgress) {
          await agent.executeTask!(task.task_id).catch(() => {});
        }
      };
    }
  );
  const pmHandles = startPmLiveLoop(pmAgent, config.pmProactiveIntervalSecs * 1_000);
  const allHandles: NodeJS.Timeout[] = [...specialistHandles, ...pmHandles];

  // 7b. Watchdog — detects tasks stuck in_progress and auto-restarts them via executeTask().
  //     Runs every 2 minutes. Restarts any task that hasn't had a status update in >5 minutes.
  const STALE_TASK_MS = 5 * 60_000;
  const watchdogHandle = setInterval(() => {
    const staleTasks = ATPDatabase.getAllTasks("in_progress").filter((t) => {
      const age = Date.now() - new Date(t.updated_at).getTime();
      return age > STALE_TASK_MS;
    });
    for (const task of staleTasks) {
      const agent = agentRegistry.get(task.agent_id);
      if (!agent) continue;
      agent.abort(); // stop any hung LLM call
      ATPDatabase.updateTaskStatus(task.task_id, "pending", "Watchdog: auto-restart (stuck in_progress)");
      EventLog.log(
        EventType.TASK_FAILED, "system", task.task_id,
        `WATCHDOG: ${task.task_id} stuck in_progress for >${STALE_TASK_MS / 60_000}min — auto-restarting`
      );
      // Re-dispatch via rich executeTask() path if available
      if (typeof agent.executeTask === "function") {
        agent.executeTask(task.task_id).catch((e: unknown) => {
          ATPDatabase.updateTaskStatus(task.task_id, "failed", `Watchdog retry failed: ${e}`);
          EventLog.log(EventType.TASK_FAILED, "system", task.task_id, `WATCHDOG retry failed: ${e}`);
        });
      }
    }
  }, 2 * 60_000);
  allHandles.push(watchdogHandle);

  // 8. Start live queue monitor
  const monitor = startLiveMonitor();
  allHandles.push(monitor.interval);

  function shutdown(): void {
    console.log("\nShutting down VEC... goodbye.");
    for (const h of allHandles) clearInterval(h);
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 9. Start dashboard HTTP server
  startDashboardServer();

  // 10. Start Telegram channel (optional — requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)
  const telegram = createTelegramChannel(pmAgent);
  if (telegram) await telegram.start();

  // 11. User inbox forwarder — delivers messages sent to 'user' by PM (or other agents)
  //     to the CLI console and, if active, to the Telegram channel.
  const userInboxHandle = setInterval(async () => {
    const msgs = AgentMessageQueue.popForAgent("user");
    for (const msg of msgs) {
      const sender = AGENT_DISPLAY_NAMES[msg.from_agent] ?? msg.from_agent;
      const tag = msg.priority === "priority" ? " [PRIORITY]" : "";
      const line = `[${sender}${tag}]: ${msg.message}`;
      const ch = ActiveChannelState.get();
      console.log(`\n  [→ You] ${line}\n`);
      // Route reply to origin channel only:
      // - telegram session → forward to Telegram (not Dashboard Teams)
      // - dashboard session → log to UserChatLog (not Telegram)
      // - cli session → log to UserChatLog (Telegram not notified for CLI messages)
      if (telegram && msg.from_agent === "pm" && ch === "telegram") {
        await telegram.sendToUser(line).catch(() => {});
      }
      if (ch !== "telegram") {
        UserChatLog.log({ from: msg.from_agent, to: "user", message: msg.message, channel: "agent" });
      }
    }
  }, 5_000);
  allHandles.push(userInboxHandle);

  // 12. Print banner
  printBanner();

  // 13. Interactive readline loop (skipped in headless mode)
  if (!config.cliEnabled) {
    console.log("  Running in headless mode. Use dashboard or Telegram to interact.\n");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // When stdin closes (piped input, Ctrl+D), stop the askLine loop cleanly
  let rlClosed = false;
  rl.on("close", () => { rlClosed = true; });

  const askLine = (): void => {
    if (rlClosed) return;
    rl.question("You: ", async (raw) => {
      const input = raw.trim();

      if (!input) {
        askLine();
        return;
      }

      // ── Slash commands ────────────────────────────────────────────────

      if (input === "/quit" || input === "/exit") {
        rl.close();
        shutdown();
        return;
      }

      if (input === "/board") {
        console.log("\n" + ATPDatabase.taskBoard());
        askLine();
        return;
      }

      if (input === "/queue") {
        const msgs = MessageQueue.peek();
        if (!msgs.length) {
          console.log("\n[PM Queue] Empty.");
        } else {
          console.log(`\n[PM Queue] ${msgs.length} message(s):`);
          for (const m of msgs) {
            const taskRef = m.task_id ? ` ${m.task_id}` : "";
            console.log(`  [${m.type}] ${m.from_agent}${taskRef}: ${m.message.substring(0, 80)}`);
          }
        }
        askLine();
        return;
      }

      if (input === "/events") {
        const events = EventLog.getEvents(20);
        if (!events.length) {
          console.log("\n[Events] None recorded yet.");
        } else {
          console.log(`\n[Events] Last ${events.length}:`);
          for (const e of events) {
            const ts = e.timestamp
              ? new Date(e.timestamp).toLocaleTimeString()
              : "?";
            const taskRef = e.task_id ? ` | ${e.task_id}` : "";
            console.log(
              `  ${ts} [${e.event_type}] ${e.agent_id || "-"}${taskRef} — ${(e.message || "").substring(0, 80)}`
            );
          }
        }
        askLine();
        return;
      }

      if (input === "/dir") {
        console.log("\n" + ATPDatabase.employeeDirectory());
        askLine();
        return;
      }

      if (input === "/org") {
        console.log("\n" + ATPDatabase.orgChart());
        askLine();
        return;
      }

      if (input.startsWith("/message")) {
        // Agents available to message (all except "user" = Akhil himself)
        const AGENTS = Object.entries(AGENT_DISPLAY_NAMES).filter(([id]) => id !== "user");

        // Parse inline args: /message [agentKey] [message...]
        const parts = input.slice("/message".length).trim().split(/\s+/);
        let targetKey = "";
        let inlineMsg = "";

        if (parts[0] && AGENTS.some(([id]) => id === parts[0].toLowerCase())) {
          targetKey = parts[0].toLowerCase();
          inlineMsg = parts.slice(1).join(" ").trim();
        }

        // Step 1: pick agent if not given inline
        const pickAgent = (): Promise<string> => {
          if (targetKey) return Promise.resolve(targetKey);
          console.log("\n  Who do you want to message?");
          AGENTS.forEach(([, name], i) =>
            console.log(`    ${String(i + 1).padStart(2)}. ${name}`)
          );
          console.log("");
          return new Promise((resolve) => {
            rl.question("  Pick number (or agent key): ", (ans) => {
              const trimmed = ans.trim().toLowerCase();
              const byNum = AGENTS[parseInt(trimmed, 10) - 1];
              if (byNum) { resolve(byNum[0]); return; }
              if (AGENTS.some(([id]) => id === trimmed)) { resolve(trimmed); return; }
              console.log("  [Invalid selection — cancelled.]");
              resolve("");
            });
          });
        };

        // Step 2: ask for message text if not given inline
        const pickMessage = (agentKey: string): Promise<string> => {
          if (!agentKey) return Promise.resolve("");
          if (inlineMsg) return Promise.resolve(inlineMsg);
          const name = AGENT_DISPLAY_NAMES[agentKey] ?? agentKey;
          return new Promise((resolve) => {
            rl.question(`  Message to ${name}: `, (ans) => resolve(ans.trim()));
          });
        };

        const agentKey = await pickAgent();
        const msgText = await pickMessage(agentKey);

        if (agentKey && msgText) {
          AgentMessageQueue.push("user", agentKey, "", msgText, "normal");
          const name = AGENT_DISPLAY_NAMES[agentKey] ?? agentKey;
          console.log(`  [Sent to ${name}]`);
        }

        askLine();
        return;
      }

      if (input.startsWith("/interrupt")) {
        // Available specialist agents (exclude pm and user)
        const SPEC_AGENTS = Object.entries(AGENT_DISPLAY_NAMES).filter(
          ([id]) => id !== "user" && id !== "pm"
        );

        // Parse inline args: /interrupt [agentKey] [reason...]
        const iParts = input.slice("/interrupt".length).trim().split(/\s+/);
        let iTargetKey = "";
        let iReason = "";

        if (iParts[0] && SPEC_AGENTS.some(([id]) => id === iParts[0].toLowerCase())) {
          iTargetKey = iParts[0].toLowerCase();
          iReason = iParts.slice(1).join(" ").trim();
        }

        // Pending interrupts summary
        const pending = AgentInterrupt.getAll();
        const pendingCount = Object.keys(pending).length;
        if (pendingCount) {
          console.log(`\n  [Pending interrupts: ${Object.entries(pending).map(([id, r]) => `${id}=${r}`).join(", ")}]`);
        }

        const pickAgent = (): Promise<string> => {
          if (iTargetKey) return Promise.resolve(iTargetKey);
          console.log("\n  Which agent do you want to interrupt?");
          SPEC_AGENTS.forEach(([, name], i) =>
            console.log(`    ${String(i + 1).padStart(2)}. ${name}`)
          );
          console.log("");
          return new Promise((resolve) => {
            rl.question("  Pick number (or agent key): ", (ans) => {
              const trimmed = ans.trim().toLowerCase();
              const byNum = SPEC_AGENTS[parseInt(trimmed, 10) - 1];
              if (byNum) { resolve(byNum[0]); return; }
              if (SPEC_AGENTS.some(([id]) => id === trimmed)) { resolve(trimmed); return; }
              console.log("  [Invalid selection — cancelled.]");
              resolve("");
            });
          });
        };

        const pickReason = (agentKey: string): Promise<string> => {
          if (!agentKey) return Promise.resolve("");
          if (iReason) return Promise.resolve(iReason);
          return new Promise((resolve) => {
            rl.question("  Reason (or Enter to skip): ", (ans) => resolve(ans.trim() || "Interrupted by founder"));
          });
        };

        const iKey = await pickAgent();
        const reason = await pickReason(iKey);

        if (iKey) {
          const r = reason || "Interrupted by founder";
          // Native abort — stops LLM generation mid-stream
          agentRegistry.get(iKey)?.abort();
          // Flag fallback — caught at next tool boundary
          AgentInterrupt.request(iKey, r);
          const name = AGENT_DISPLAY_NAMES[iKey] ?? iKey;
          console.log(`  [${name} aborted (mid-stream) + flagged (next tool boundary)]`);
        }

        askLine();
        return;
      }

      if (input === "/forget") {
        pmAgent.clearMessages();
        clearAgentHistory("pm");
        console.log("[PM conversation history cleared.]");
        askLine();
        return;
      }

      if (input === "/live") {
        const now = monitor.toggle();
        console.log(`[Live queue monitor: ${now ? "ON" : "OFF"}]`);
        askLine();
        return;
      }

      // ── Send to PM agent ──────────────────────────────────────────────

      // Mark this as a CLI-originated message so replies go to Dashboard only
      ActiveChannelState.set("cli");

      // Log Sir's message to Teams chat history
      UserChatLog.log({ from: "user", to: "pm", message: input, channel: "cli" });

      try {
        const memory = loadAgentMemory("pm");
        const firstTime = isFirstInteraction("pm");
        if (firstTime) markFirstInteractionDone("pm");
        const founderPrompt =
          (memory ? `${memory}\n\n` : "") +
          (firstTime
            ? `[FIRST INTERACTION — Sir is messaging you for the first time.]\n` +
              `Introduce yourself briefly and warmly — one sentence. Then respond to what he said. Natural, not robotic.\n\n`
            : "") +
          `[Message from ${founder.name} (Sir) — agent key: '${founder.agentKey}']\n` +
          `Sir says: ${input}`;
        await pmAgent.prompt(founderPrompt);
      } catch (err) {
        console.error("\n[Error talking to PM]", err);
      }

      askLine();
    });
  };

  askLine();
}

main().catch((err) => {
  console.error("[Fatal startup error]", err);
  process.exit(1);
});
