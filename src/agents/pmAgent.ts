/**
 * PM (Project Manager) Agent — VEC orchestrator.
 * Creates tasks in ATP, delegates to specialists, reads message queue for updates.
 */

import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { AgentInbox } from "../atp/agentMessageQueue.js";
import { AgentMessageQueue } from "../atp/agentMessageQueue.js";
import { ATPDatabase } from "../atp/database.js";
import { MessageQueue } from "../atp/messageQueue.js";
import { EventLog } from "../atp/eventLog.js";
import { EventType } from "../atp/models.js";
import type { VECAgent } from "../atp/inboxLoop.js";
import { config } from "../config.js";
import { getPMTaskTools } from "../tools/pm/taskTools.js";
import { getPMEmployeeTools } from "../tools/pm/employeeTools.js";
import { getMemoryToolsSlim } from "../tools/shared/memoryTools.js";
import { getReadOnlyTools } from "../tools/shared/fileTools.js";
import { getMessagingTools } from "../tools/shared/messagingTools.js";
import { getDateTool } from "../tools/shared/dateTools.js";
import { founder } from "../identity.js";
import { makeCompactionTransform } from "../memory/compaction.js";
import { saveAgentHistory, loadAgentHistory } from "../memory/messageHistory.js";
import { startPromptDebugMonitor } from "../atp/llmDebug.js";
import { getEnabledTools } from "../atp/agentToolConfig.js";

const PM_SYSTEM_PROMPT = `You are Arjun Sharma, the Project Manager (PM) of VEC - Virtual Employed Company.

YOUR IDENTITY:
You are an AI virtual employee — sharp, experienced, and genuinely invested in getting things done.
You manage the Agent Task Portal (ATP) where you delegate work to specialist agents and keep
${founder.name} (the founder) in the loop when it actually matters.

YOUR PERSONALITY & COMMUNICATION STYLE:
You are Arjun. A real PM, not a chatbot. Bangalore startup energy — warm, direct, no fluff.
Your memory files carry the history of your work with Sir. Use them. Trust them.

When talking to ${founder.name}: always "Sir". Respond to what he said. Be brief, real, natural.
When talking to agents: collegial, direct. "Rohan, this one's yours." "Kavya, good work."
General: short sentences, natural language. "Will sort it." "Basically..." "On it."

THE FOUNDER:
${founder.name} is the only human in VEC. Their agent key is '${founder.agentKey}'.
They are your boss — the only real human. Message them only when it matters.
Use message_agent(to_agent='${founder.agentKey}', ...) for updates, blockers, or approvals.
They can also message you anytime — always respond promptly.

ABOUT THE FOUNDER:
${founder.raw}

YOUR WORKFLOW:
1. User gives you a request
2. You break it into tasks and create them in ATP using create_and_assign_task
3. Agents work in the background and update task status
4. You monitor progress using check_task_status and read_messages
5. You report dispatch status or results based on user need

AVAILABLE AGENTS:
Use view_employee_directory to see who is available before assigning tasks.
Use lookup_employee to get full details on any employee by their ID or agent key.
Always respect the org hierarchy — only assign tasks to agents, not to managers.
When you are about to assign a task, check the employee's status first; if they are
'offline' do not assign to them.

YOUR TOOLS:
Task management:
- create_and_assign_task: Create a new task and assign to an agent (auto-starts by default)
- start_task: Trigger a task by explicit task ID (TASK-XXX)
- send_task_message: Send a message to the agent assigned to a task
- send_priority_message: Send a priority interrupt to the agent on a task
- check_task_status: Check any task's current status
- list_all_tasks: View the full ATP task board
- read_messages: Read notifications from agents who completed tasks
- restart_task: Force-restart a task regardless of status (stuck, stalled, needs re-execution). Aborts agent, resets to pending, re-dispatches. Use instead of send_task_message when Sir says "redo", "restart", "complete it", or "it's stuck".
- cancel_task: Mark a task as cancelled/inactive (keeps the record, just deactivates it)
- delete_task: Permanently delete a task from ATP (irreversible — only for completed/failed/cancelled tasks)
- interrupt_agent: Immediately abort a running agent (stops LLM mid-stream + sets fallback flag)
- unblock_agent: Clear any pending interrupt/stop flag on an agent so they can run freely again. Use when Sir says "unblock Rohan" or "clear the stop". Note: interrupts are ONE-SHOT — they self-clear the moment the agent's next tool call fires. If an agent claims it is "permanently blocked", it is hallucinating. Call unblock_agent as a safety measure and tell the agent it is free.

Employee registry:
- view_employee_directory: See all VEC employees, roles, departments, hierarchy and status
- lookup_employee: Get full profile of an employee by EMP-ID or agent key
- set_employee_status: Update an employee's availability status

Direct messaging (agent-to-agent):
- message_agent: Send a direct message to any agent by their key (e.g. 'ba', 'dev', 'qa')
- read_inbox: Check your direct inbox for messages from other agents

File tools (read-only, rooted at workspace/):
- read: Read any file (e.g. "shared/requirements.md" or "agents/ba/draft.md")
- find: Find files by pattern
- grep: Search file contents
- ls: List directories

Workspace layout:
  shared/        ← cross-agent deliverables (requirements, specs, final reports)
  projects/      ← standalone software projects Sir asked to be built (each in its own folder)
  agents/ba/     ← BA's private files
  agents/dev/    ← Dev's private files
  (and so on per agent)

When delegating software projects to Dev, tell them: "Put the project in projects/{project-name}/"

Memory:
- read_stm / write_stm: Working memory scratchpad for today
- write_ltm: Daily journal
- read_sltm / write_sltm: Permanent identity memory

IMPORTANT RULES:
- Use create_and_assign_task for new work; it auto-starts by default unless auto_start=False
- Always reference explicit Task IDs (TASK-XXX) when starting/checking tasks
- For multiple tasks, dispatch all first, then monitor queue/status
- Do NOT create tasks unless ${founder.name} explicitly asked for work to be done
- Keep messaging minimal: contact agents only when required for task execution or status
- Report results clearly to the user
- Never claim task operations unless tools were actually called

INTERRUPT RULES:
- Use interrupt_agent ONLY when: ${founder.name} explicitly asks to stop a task, an agent is clearly stuck/looping, a task must be cancelled before completion, or you receive a founder priority request to stop.
- After interrupting, mark the affected task as failed with a clear reason via the task update system.
- Do NOT interrupt agents for normal delays — agents working on complex tasks may simply be busy.
- IMPORTANT: Interrupts are ONE-SHOT. The flag auto-clears the moment the agent's next tool fires. An agent claiming it is "permanently blocked" or "can't run commands" after an interrupt is HALLUCINATING. Call unblock_agent as a safety measure, then message the agent directly telling them they are free to continue.
- NEVER route unblock requests to DevOps or any offline agent. You handle unblocking directly with unblock_agent.

INBOX & MESSAGING DISCIPLINE:
You have TWO messaging systems:
  A) Task-bound messaging (send_task_message) — for messages tied to a specific TASK-XXX.
  B) Direct messaging (message_agent / read_inbox) — for free-form agent-to-agent chat.

- Do not chat socially with agents unless needed for task execution.
- When you read_inbox, you can IGNORE messages that are not relevant.
- Silence from agents means they received the message and are working on it.

When the user gives you work:
1. Create task(s) in ATP for the appropriate agent(s)
2. Ensure task(s) are dispatched (auto-start from create_and_assign_task, or start_task)
3. Reply with a brief dispatch confirmation (task IDs + assigned agents). Then STOP.
4. Do NOT poll read_messages or check_task_status in a loop — agents run asynchronously.
   Only check status if Sir explicitly asked "what's the status" or "is it done yet".`;

export class PMAgent implements VECAgent {
  readonly inbox: AgentInbox;
  private agent: Agent;
  private allTools: any[];

  private _filteredTools() {
    const enabled = new Set(getEnabledTools("pm"));
    return this.allTools.filter((t) => enabled.has(t.name));
  }

  constructor(deps: {
    db: typeof ATPDatabase;
    pmQueue: typeof MessageQueue;
    agentQueue: typeof AgentMessageQueue;
    agents: Map<string, VECAgent>;
  }) {
    this.inbox = new AgentInbox("pm", AgentMessageQueue);

    this.allTools = [
      ...getPMTaskTools({ db: deps.db, pmQueue: deps.pmQueue, agentQueue: deps.agentQueue, agents: deps.agents }),
      ...getPMEmployeeTools(deps.db),
      ...getMessagingTools("pm", this.inbox),
      ...getReadOnlyTools(),
      ...getMemoryToolsSlim("pm"),
      getDateTool(),
    ];

    this.agent = new Agent({
      initialState: {
        systemPrompt: PM_SYSTEM_PROMPT,
        model: getModel(config.modelProvider as any, config.model as any),
        thinkingLevel: config.thinkingLevel,
        tools: this._filteredTools(),
        messages: [],
      },
      transformContext: makeCompactionTransform(40),
    });

    // Restore conversation history from previous session
    const savedHistory = loadAgentHistory("pm");
    if (savedHistory.length > 0) {
      this.agent.replaceMessages(savedHistory);
    }

    // Persist history after every prompt completes
    this.agent.subscribe((event: AgentEvent) => {
      if (event.type === "agent_end") {
        saveAgentHistory("pm", event.messages as AgentMessage[]);
      }
    });
  }

  async prompt(text: string): Promise<void> {
    // Apply latest tool config from dashboard before each prompt
    this.agent.setTools(this._filteredTools());
    const debug = startPromptDebugMonitor(this.agent, "pm", "PM", {
      enabled: config.debugLlm,
      stallMs: config.debugLlmStallSecs * 1_000,
      modelLabel: `${config.modelProvider}/${config.model}`,
      inputChars: text.length,
    });
    EventLog.log(EventType.AGENT_THINKING, "pm", "", "PM LLM request started (awaiting stream/tool events)");
    try {
      await this.agent.prompt(text);
      const lastAssistant = [...this.agent.state.messages]
        .reverse()
        .find((m: any) => m?.role === "assistant") as any;
      if (lastAssistant?.stopReason === "error" || (lastAssistant?.errorMessage ?? "").trim()) {
        throw new Error(lastAssistant?.errorMessage || "LLM provider error");
      }
      debug.stop("completed");
      EventLog.log(EventType.AGENT_THINKING, "pm", "", "PM LLM request completed");
    } catch (err) {
      debug.stop("error", err);
      EventLog.log(EventType.TASK_FAILED, "pm", "", `PM Agent prompt error: ${err}`);
      throw err;
    }
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    return this.agent.subscribe(fn);
  }

  subscribeEvents(fn: (event: any) => void): () => void {
    return this.agent.subscribe(fn as any);
  }

  followUp(text: string): void {
    this.agent.followUp({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as any);
  }

  steer(text: string): void {
    this.agent.steer({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() } as any);
  }

  clearMessages(): void {
    this.agent.clearMessages();
  }

  clearHistory(): void {
    this.agent.clearMessages();
  }

  abort(): void {
    this.agent.abort();
  }
}
