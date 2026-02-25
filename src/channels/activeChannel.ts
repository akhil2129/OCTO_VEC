/**
 * Active channel tracker — which channel sent the most recent message to PM.
 *
 * Used to route PM replies back to the originating channel only:
 *   - telegram  → reply goes to Telegram only (not Dashboard Teams)
 *   - dashboard → reply goes to Dashboard Teams only (not Telegram)
 *   - cli       → reply goes to CLI + Dashboard Teams (default)
 */

export type ActiveChannel = "cli" | "telegram" | "dashboard";

let _current: ActiveChannel = "cli";

export const ActiveChannelState = {
  set(ch: ActiveChannel): void {
    _current = ch;
  },
  get(): ActiveChannel {
    return _current;
  },
};
