# Octane Arena ? Season 1 Challenges

## Configuration and season

Edit shared/challenges.ts. It contains SEASON_CONFIG, DAILY_CHALLENGES,
WEEKLY_CHALLENGES and SEASON_1_CHALLENGES. There is no random generator or Rocket Pass.

Season 1 runs from October 18, 2026, 00:00 New York (04:00 UTC) to
November 18, 2026, 00:00 New York (05:00 UTC, exclusive). These are explicit
calendar dates, not a 30-day duration; the period includes daylight-saving fallback.
Home and the Season tab derive date labels/countdowns from this configuration.
At the exact endpoint, Season progress freezes and the UI says SEASON COMPLETE.
No Season 2 is generated. Daily and Weekly sets continue on their ordinary schedule.

| Category | Challenge | Requirement | XP |
| --- | --- | --- | ---: |
| Daily | FIRST DRIVE | Complete 1 match | 1,000 |
| Daily | WINNER | Win 1 match | 1,500 |
| Daily | GET INVOLVED | 5 ball touches | 750 |
| Weekly | REGULAR DRIVER | Complete 5 matches | 3,000 |
| Weekly | WINNING FORM | Win 3 matches | 4,000 |
| Weekly | GOAL GETTER | 8 goals | 4,000 |
| Weekly | DEFENDER | 5 saves | 3,500 |
| Weekly | SHOOTER | 15 shots | 3,000 |
| Weekly | MODE HOPPER | Complete 3 distinct modes | 5,000 |
| Season | SEASONED DRIVER | Complete 30 matches | 10,000 |
| Season | CHAMPION | Win 15 matches | 12,500 |
| Season | GOAL MACHINE | 40 goals | 10,000 |
| Season | THE WALL | 25 saves | 10,000 |
| Season | PLAY EVERYTHING | Complete Soccar, Heatseeker, Rumble, Hoops, Dropshot | 15,000 |
| Season | HIGH SCORER | 10,000 authoritative Match Score | 15,000 |

Definitions have stable kebab-case IDs, category, name, description, type, target,
XP reward and optional mode/match-kind filters. Use a new ID if replacing a challenge
with a different task mid-period; changing claimed rewards does not retroactively
pay them again. Specific-mode tasks use filters.modes. Unique-mode tasks retain
a set of completed mode IDs, so repeating Soccar cannot satisfy Mode Hopper.

## Event flow and eligibility

Local matches use Match.stats; party matches use the existing validated authority
snapshots. Challenges.observe converts changed current-match counters into stat
deltas. This adapter is gated by a six-counter fingerprint, not a per-frame scan
of lifetime stats. The reusable engine evaluates definitions only on a real change.
It supports goals, assists, saves, shots, touches, Match Score, completed matches,
wins, specific-mode completions/wins and unique completed modes.

Real action counters progress live during normal matches; completed-match/win/mode
tasks progress only at legitimate completion. The latter use the same participation
eligibility as match XP (20 score OR 3 seconds of meaningful input). Bot matches
and parties count fully in all five normal modes. Bots, spectators, Free Play,
Rings, Training Packs and Dribble Challenge do not count.

Boost usage, aerial goals and demolitions are intentionally not advertised as
supported types: current authoritative MatchStats lacks reliable persistent counters
for them. No substitute/fabricated events are used. More types can be added to the
central engine when their authority counters exist.

## Persistence, resets and deduplication

The existing octane-arena-profile now stores challengeProgress separately from the
legacy challenges field used by Dribble level unlocks. It contains category period
keys, per-definition progress/completed/rewardClaimed/mode sets, compact per-match
stat checkpoints and a pending-reward journal. Existing XP, identity, stats, Garage,
settings and practice records migrate unchanged. Reset Local Profile retains the
new challenge/XP history; its legacy practice reset behavior is preserved.

Daily keys use the New York calendar date and reset at midnight. Weekly keys use
that week's Monday date. DST and browser reopening are handled using timestamps
and Intl calendar parts. Only the changing category resets. Stat checkpoints and
explicitly requested claims survive a reset; unrequested rewards expire with their set.
A backward clock correction does not roll a set backward.
The client clock is local and is not an anti-cheat mechanism.

Stat checkpoints take only positive increases from authoritative cumulative values.
They survive refreshes, replays, kickoffs, bounded network event-history gaps and
out-of-order resyncs. A finalized match is latched and cannot progress again.
Separate match/player IDs isolate participants. No goals or assists are keyed by name.

Completing a challenge journals its immutable reward as READY TO CLAIM, without
awarding XP. Challenges.claim(category, id) persists claimRequested before using
LocalProfile.awardXP. It uses
source CHALLENGE and a deterministic ID:

challenge/CATEGORY/period-key/definition-id

The existing XP ledger makes the reward idempotent. Progress and the pending reward
save before granting XP; rewardClaimed saves after the XP receipt. Only explicitly
requested interrupted grants
recover automatically, including if the XP receipt saved before the claimed flag.
Stale profile saves merge newer progress/checkpoints. Where available, the existing
same-origin Web Lock serializes challenge and XP transactions.

## Presentation and future hooks

The right Home button shows the current three Daily tasks, rewards, fractions,
progress bars and Season identity/date/countdown. Its compact layout shows names,
descriptions and amounts. The full modal has Daily (3), Weekly (6) and Season (6)
tabs, controller focus/card navigation/shoulder tab switching/Back,
shared hover styles, reduced-motion support and the app's hidden-scrollbar rules.
A noninteractive queued CHALLENGE COMPLETE toast slides into/out of the top-right
and says READY TO CLAIM. Ready cards are bright green. Claimed cards are darker green
with a checkmark. Tabs gain a checkmark only when every task is completed and claimed.
Claiming opens the same XPAnimation/ProgressionPanel bar used by match results,
with separate DOM IDs and the same level-up/overflow/skip/reduced-motion behavior.
Completed cards remain in their category until reset.

Home and the modal read the same profile-backed engine state. Profile/Home/party
levels update through the normal XP observer without rebuilding cars. Match results
wait for pending progress writes/requested claims before their normal match-XP
animation; unclaimed challenges do not inflate match XP. Existing claimed rewards
and XP stay intact after upgrading.

The data-driven definitions, period keys, filters, source IDs, completion subscription
and existing XP award subscription leave room for future events, rotations, stages,
rewards or a Rocket Pass. None of those additional systems is implemented here.
Progression remains browser-local, not a cloud account save.

## Verification

npm test includes tests/challenges.ts (deterministic definitions, event deltas,
exclusions, independent players, resets/DST/exact season endpoints, mode sets,
replay/resync dedup, persistence, stale saves, crash recovery and normal level-ups).
Existing profile/XP and gameplay regressions remain enabled.

Browser checks with PLAYWRIGHT_MODULE configured:

- node tests/challenge-claims-browser.cjs: all 15 authoritative completion fixtures, manual claims, controller Claim/Done, ready/claimed colors, category checkmarks, XP bar fill and reload/duplicate safety.
- node tests/challenges-browser.cjs: Home/full UI, desktop/narrow layout, controller
  opening/tabs/cards/Back, real rigid-body ball contacts and live rewards/popups,
  completed-match grants, level updates, refresh and all practice exclusions.
- node tests/progression-browser.cjs: existing match-XP animation, overflow,
  persistence/browser restart, model stability and controller skip, including
  unclaimed challenges do not change the match award.
- node tests/progression-peer-browser.cjs: real PeerJS browser sessions with the
  deterministic final authority fixture, independent human XP/Challenge bonuses,
  party levels, rematch, duplicate guard and Home/Leave lifecycle.

Also run npm run build, npm run build --prefix server and npm test --prefix server.
PeerJS browser-session checks do not establish a two-physical-device field test.
