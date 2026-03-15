/**
 * ChannelManager — singleton that holds active Telegram/Slack/Discord channel instances
 * and exposes stop/restart capability for hot-reload from the dashboard.
 */

import type { VECChannel } from "./types.js";
import type { PMAgent } from "../agents/pmAgent.js";
import { createTelegramChannel } from "./telegram.js";
import { createSlackChannel } from "./slack.js";
import { createDiscordChannel } from "./discord.js";

type ChannelId = "telegram" | "slack" | "discord";

let _pmAgent: PMAgent | null = null;
const _channels: Record<ChannelId, VECChannel | null> = {
  telegram: null,
  slack: null,
  discord: null,
};

export const channelManager = {
  /** Called once from tower.ts during startup. */
  async initChannels(pmAgent: PMAgent): Promise<void> {
    _pmAgent = pmAgent;
    _channels.telegram = createTelegramChannel(pmAgent);
    if (_channels.telegram) await _channels.telegram.start();
    _channels.slack = createSlackChannel(pmAgent);
    if (_channels.slack) await _channels.slack.start();
    _channels.discord = createDiscordChannel(pmAgent);
    if (_channels.discord) await _channels.discord.start();
  },

  getChannel(id: ChannelId): VECChannel | null {
    return _channels[id];
  },

  isConnected(id: ChannelId): boolean {
    return _channels[id] !== null;
  },

  /** Stop a channel gracefully. */
  async stopChannel(id: ChannelId): Promise<void> {
    const ch = _channels[id];
    if (ch) {
      try { await ch.stop(); } catch { /* best-effort */ }
      _channels[id] = null;
    }
  },

  /** Stop the old instance, create a new one from current process.env, and start it. */
  async restartChannel(id: ChannelId): Promise<{ ok: boolean; error?: string }> {
    if (!_pmAgent) return { ok: false, error: "PM agent not initialized" };

    // Stop existing
    await this.stopChannel(id);

    // Create new from current env
    try {
      const creators: Record<ChannelId, () => VECChannel | null> = {
        telegram: () => createTelegramChannel(_pmAgent!),
        slack: () => createSlackChannel(_pmAgent!),
        discord: () => createDiscordChannel(_pmAgent!),
      };
      const labels: Record<ChannelId, string> = {
        telegram: "Telegram",
        slack: "Slack",
        discord: "Discord",
      };

      const ch = creators[id]();
      if (ch) {
        await ch.start();
        _channels[id] = ch;
        return { ok: true };
      }
      return { ok: false, error: `Missing or invalid ${labels[id]} credentials` };
    } catch (err: any) {
      _channels[id] = null;
      return { ok: false, error: err?.message ?? "Failed to start channel" };
    }
  },
};
