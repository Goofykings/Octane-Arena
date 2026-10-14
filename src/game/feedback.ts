import {
  feedbackSchema,
  FEEDBACK_COOLDOWN_MS,
  type FeedbackReport,
} from "../../shared/feedback";
export type FeedbackWriter = (report: FeedbackReport) => Promise<void>;
export const feedbackCooldownKey = "octane-arena-feedback-last-success";
/** UI policy only. The Firestore rules separately enforce document access/validation. */
export class FeedbackService {
  pending = false;
  private lastSuccess: number | null = null;
  constructor(
    private writer: FeedbackWriter,
    private storage?: Pick<Storage, "getItem" | "setItem">,
    private now: () => number = Date.now,
  ) {
    this.readCooldown();
  }
  private readCooldown() {
    try {
      const raw = this.storage?.getItem(feedbackCooldownKey);
      if (raw) {
        const time = Number(raw);
        if (Number.isFinite(time) && time >= 0 && time <= this.now())
          this.lastSuccess = Math.max(
            this.lastSuccess ?? 0,
            Math.min(time, this.now()),
          );
      }
    } catch {}
  }
  get cooldownSeconds() {
    this.readCooldown();
    return this.lastSuccess === null
      ? 0
      : Math.max(
          0,
          Math.ceil(
            (this.lastSuccess + FEEDBACK_COOLDOWN_MS - this.now()) / 1000,
          ),
        );
  }
  async submit(raw: FeedbackReport) {
    if (this.pending) throw Error("Your report is already being submitted.");
    if (this.cooldownSeconds)
      throw Error(
        "Please wait " +
          this.cooldownSeconds +
          " seconds before submitting another report.",
      );
    const parsed = feedbackSchema.safeParse(raw);
    if (!parsed.success) throw Error(parsed.error.issues[0].message);
    this.pending = true;
    try {
      await this.writer(parsed.data);
      this.lastSuccess = this.now();
      try {
        this.storage?.setItem(feedbackCooldownKey, String(this.lastSuccess));
      } catch {}
    } finally {
      this.pending = false;
    }
  }
}
export function feedbackError(error: unknown) {
  const raw = (error as { code?: unknown })?.code;
  const code = typeof raw === "string" ? raw.split("/").pop() : undefined;
  if (code === "permission-denied")
    return "Feedback is unavailable right now. Please try again later. Your text has been kept.";
  if (code === "resource-exhausted")
    return "Feedback is busy right now. Please try again later. Your text has been kept.";
  if (code === "failed-precondition" || code === "invalid-argument")
    return "Feedback is not available yet. Please try again later. Your text has been kept.";
  return "Your report could not be submitted. Check your connection and try again. Your text has been kept.";
}
