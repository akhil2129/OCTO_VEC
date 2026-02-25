/**
 * Shared interface for all TOWER input channels (Telegram, future: Discord, Slack...).
 */

export interface VECChannel {
  /** Start the channel listener (non-blocking). */
  start(): Promise<void>;
  /** Gracefully stop the channel listener. */
  stop(): Promise<void>;
  /** Push a proactive message to the user (e.g. PM inbox forwarding). */
  sendToUser(text: string): Promise<void>;
}
