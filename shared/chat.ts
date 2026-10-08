import { z } from "zod";
export const CHAT = {
  maxLength: 180,
  intervalMs: 1000,
  history: 20,
  fadeDelayMs: 2500,
} as const;
export interface ChatMessage {
  id: number;
  playerId: string;
  text: string;
  timestamp: number;
}
export const chatMessageSchema = z.object({
  id: z.number().int().positive(),
  playerId: z.string().max(80),
  text: z.string().max(CHAT.maxLength * 2),
  timestamp: z.number().finite(),
});
export function chatText(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 1000) return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text && Array.from(text).length <= CHAT.maxLength ? text : null;
}
export class MatchChat {
  readonly messages: ChatMessage[] = [];
  private sent = new Map<string, number>();
  private sequence = 0;
  accept(playerId: string, raw: unknown, now: number) {
    const text = chatText(raw);
    if (!text) return { error: "Enter a message of up to 180 characters." };
    if (now - (this.sent.get(playerId) ?? -Infinity) < CHAT.intervalMs)
      return { error: "Please wait before sending another message." };
    this.sent.set(playerId, now);
    const message: ChatMessage = {
      id: ++this.sequence,
      playerId,
      text,
      timestamp: now,
    };
    this.messages.push(message);
    if (this.messages.length > CHAT.history) this.messages.shift();
    return { message };
  }
}
