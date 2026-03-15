/**
 * JSON-backed storage for channel credentials (Telegram, Slack).
 * Follows the same pattern as modelConfig.ts setProviderApiKey.
 *
 * Security:
 * - Raw credentials are stored in data/channel-config.json (gitignored)
 * - getChannelConfigMasked() returns masked tokens for UI display
 * - No endpoint should ever return raw credentials to the browser
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "../config.js";

const CONFIG_PATH = join(config.dataDir, "channel-config.json");

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export interface SlackCredentials {
  botToken: string;
  appToken: string;
  channelId: string;
}

export interface DiscordCredentials {
  botToken: string;
  channelId: string;
}

export interface ChannelConfig {
  telegram?: TelegramCredentials;
  slack?: SlackCredentials;
  discord?: DiscordCredentials;
}

export interface MaskedChannelInfo {
  configured: boolean;
  connected: boolean;
  botToken: string | null;
  chatId?: string | null;
  appToken?: string | null;
  channelId?: string | null;
}

// ── Masking ──────────────────────────────────────────────────────────────────

function maskToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.length <= 8) return "****";
  return token.slice(0, 4) + "****" + token.slice(-4);
}

// ── Storage ──────────────────────────────────────────────────────────────────

export function loadChannelConfig(): ChannelConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const raw = readFileSync(CONFIG_PATH, "utf-8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveRaw(cfg: ChannelConfig): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

/**
 * Save credentials for a channel. Pass null to clear.
 * Also injects into process.env so channels can be (re)started immediately.
 */
export function saveChannelCredentials(
  channel: "telegram",
  creds: TelegramCredentials | null,
): void;
export function saveChannelCredentials(
  channel: "slack",
  creds: SlackCredentials | null,
): void;
export function saveChannelCredentials(
  channel: "discord",
  creds: DiscordCredentials | null,
): void;
export function saveChannelCredentials(
  channel: "telegram" | "slack" | "discord",
  creds: TelegramCredentials | SlackCredentials | DiscordCredentials | null,
): void {
  const cfg = loadChannelConfig();

  if (channel === "telegram") {
    if (creds) {
      const tc = creds as TelegramCredentials;
      cfg.telegram = tc;
      process.env.TELEGRAM_BOT_TOKEN = tc.botToken;
      process.env.TELEGRAM_CHAT_ID = tc.chatId;
    } else {
      delete cfg.telegram;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
    }
  } else if (channel === "slack") {
    if (creds) {
      const sc = creds as SlackCredentials;
      cfg.slack = sc;
      process.env.SLACK_BOT_TOKEN = sc.botToken;
      process.env.SLACK_APP_TOKEN = sc.appToken;
      process.env.SLACK_CHANNEL_ID = sc.channelId;
    } else {
      delete cfg.slack;
      delete process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_APP_TOKEN;
      delete process.env.SLACK_CHANNEL_ID;
    }
  } else {
    if (creds) {
      const dc = creds as DiscordCredentials;
      cfg.discord = dc;
      process.env.DISCORD_BOT_TOKEN = dc.botToken;
      process.env.DISCORD_CHANNEL_ID = dc.channelId;
    } else {
      delete cfg.discord;
      delete process.env.DISCORD_BOT_TOKEN;
      delete process.env.DISCORD_CHANNEL_ID;
    }
  }

  saveRaw(cfg);
}

/**
 * Load saved channel config into process.env on startup.
 * JSON file takes precedence over .env if both are set.
 */
export function injectChannelEnv(): void {
  const cfg = loadChannelConfig();
  if (cfg.telegram) {
    process.env.TELEGRAM_BOT_TOKEN = cfg.telegram.botToken;
    process.env.TELEGRAM_CHAT_ID = cfg.telegram.chatId;
  }
  if (cfg.slack) {
    process.env.SLACK_BOT_TOKEN = cfg.slack.botToken;
    process.env.SLACK_APP_TOKEN = cfg.slack.appToken;
    process.env.SLACK_CHANNEL_ID = cfg.slack.channelId;
  }
  if (cfg.discord) {
    process.env.DISCORD_BOT_TOKEN = cfg.discord.botToken;
    process.env.DISCORD_CHANNEL_ID = cfg.discord.channelId;
  }
}

/**
 * Return channel config with all tokens masked. Safe to send to the browser.
 */
export function getChannelConfigMasked(connected: { telegram: boolean; slack: boolean; discord: boolean }): {
  telegram: MaskedChannelInfo;
  slack: MaskedChannelInfo;
  discord: MaskedChannelInfo;
} {
  const cfg = loadChannelConfig();
  return {
    telegram: {
      configured: !!(cfg.telegram?.botToken && cfg.telegram?.chatId),
      connected: connected.telegram,
      botToken: maskToken(cfg.telegram?.botToken),
      chatId: cfg.telegram?.chatId ?? null,
    },
    slack: {
      configured: !!(cfg.slack?.botToken && cfg.slack?.appToken && cfg.slack?.channelId),
      connected: connected.slack,
      botToken: maskToken(cfg.slack?.botToken),
      appToken: maskToken(cfg.slack?.appToken),
      channelId: cfg.slack?.channelId ?? null,
    },
    discord: {
      configured: !!(cfg.discord?.botToken && cfg.discord?.channelId),
      connected: connected.discord,
      botToken: maskToken(cfg.discord?.botToken),
      channelId: cfg.discord?.channelId ?? null,
    },
  };
}
