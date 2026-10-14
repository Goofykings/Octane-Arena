import { z } from "zod";
export const feedbackTypes = [
  "Bug",
  "Feature Request",
  "Other",
] as const;
export type FeedbackType = (typeof feedbackTypes)[number];
export const FEEDBACK_MAX_LENGTH = 2000;
export const FEEDBACK_COOLDOWN_MS = 120_000;
export const FEEDBACK_COLLECTION = "feedbackReports";
export const feedbackSchema = z
  .object({
    username: z.string().trim().min(1).max(20),
    reportType: z.enum(feedbackTypes),
    description: z
      .string()
      .trim()
      .min(1, "Please describe your report.")
      .max(FEEDBACK_MAX_LENGTH, "Use at most 2000 characters."),
    gameVersion: z.string().min(1).max(32),
    screen: z.string().min(1).max(80),
    mode: z.string().min(1).max(80),
  })
  .strict();
export type FeedbackReport = z.infer<typeof feedbackSchema>;
