export const modes = {
  bot: {
    bot: true,
    scoreboard: true,
    countdown: 3,
    clock: true,
    training: false,
    infiniteBoost: false,
    goal: "celebrate",
  },
  freeplay: {
    bot: false,
    scoreboard: false,
    countdown: 0,
    clock: false,
    training: true,
    infiniteBoost: true,
    goal: "practice",
  },
} as const;
export type Mode = keyof typeof modes;
