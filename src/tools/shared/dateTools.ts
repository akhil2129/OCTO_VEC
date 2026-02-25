/**
 * Date/time tool for VEC agents.
 * Provides the current date in a human-readable format.
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export function getDateTool(): AgentTool {
  return {
    name: "get_current_date",
    label: "Get Current Date",
    description:
      "Get the current date and time. Returns date in YYYY-MM-DD format and full datetime. " +
      "Use this when you need to know today's date.",
    parameters: Type.Object({}),
    execute: async () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      const dayName = days[d.getDay()];
      const monthName = months[d.getMonth()];
      const h = d.getHours();
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      const text =
        `Date: ${dateStr}\n` +
        `Day: ${dayName}\n` +
        `Time: ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}\n` +
        `Full: ${dayName}, ${monthName} ${d.getDate()}, ${d.getFullYear()} at ${h12}:${pad(d.getMinutes())} ${ampm}`;
      return { content: [{ type: "text", text }], details: {} };
    },
  };
}
