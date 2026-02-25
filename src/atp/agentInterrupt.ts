/**
 * Per-agent interrupt flag store.
 *
 * When an interrupt is requested for an agent, the next tool call that agent
 * makes will throw an Error with [INTERRUPT] prefix, which terminates the
 * agent's LLM loop and surfaces as a task_failed event.
 *
 * Usage:
 *   AgentInterrupt.request("ba", "PM requested stop")  // from PM or CLI
 *   AgentInterrupt.check("ba")                         // inside every tool execute()
 */

type InterruptEntry = { requested: boolean; reason: string };

const flags = new Map<string, InterruptEntry>();

export const AgentInterrupt = {
  /**
   * Request an interrupt for the given agent.
   * The agent will be stopped at its next tool call boundary.
   */
  request(agentId: string, reason = "Interrupted by PM"): void {
    flags.set(agentId, { requested: true, reason });
  },

  /**
   * Check if an interrupt has been requested for agentId.
   * If yes, clears the flag and throws — terminating the agent's LLM loop.
   * Call this at the start of every tool execute().
   */
  check(agentId: string): void {
    const f = flags.get(agentId);
    if (f?.requested) {
      flags.delete(agentId);
      throw new Error(`[INTERRUPT] ${f.reason}`);
    }
  },

  /** Cancel a pending interrupt request (before the agent checks it). */
  clear(agentId: string): void {
    flags.delete(agentId);
  },

  /** Returns true if an interrupt is pending for this agent. */
  isRequested(agentId: string): boolean {
    return flags.get(agentId)?.requested ?? false;
  },

  /** Returns all pending interrupts as { agentId: reason }. */
  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, entry] of flags) {
      if (entry.requested) result[id] = entry.reason;
    }
    return result;
  },
};
