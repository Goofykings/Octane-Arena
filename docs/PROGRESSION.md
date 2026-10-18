# XP and levels

All balancing and integer-safe level math are in shared/progression.ts (XP_TUNING).

Completed Against Bots and party matches use the same formula in Soccar,
Heatseeker, Rumble, Hoops and Dropshot:

- floor(min(active seconds, 1200) * 4)
- round(authoritative MatchStats.score * 0.10)
- +100 for a win; no win bonus for draws/losses
- +50 for the same matchMvp selected by the results leaderboard

300 active seconds, score 540, win and MVP = **1404 XP**.
A human must score at least 20 OR provide at least 3 seconds of meaningful input
(axes beyond 0.15, jump, boost or powerup). Bots, spectators, disconnected
participants at completion and practice modes receive no persistent XP.

## Authority and lifecycle

Match.start creates a fresh UUID (network matches use NetworkMatch.id). Playing
fixed ticks alone count active time, including overtime; countdowns, pauses,
celebrations, replays, menus and results do not. Input activity is recorded in
local simulation / NetworkMatch, never by presentation prediction. Kickoffs and
replays retain the counters. Match.finish freezes a final completion with the
roster, scores, shared MVP, active duration and each human's activity/participation.
Abandoning a match creates no completion. Unlimited matches still require actual
completion, and counted playtime is capped at 20 minutes.

Network snapshots carry this final completion from the existing host/server
worker. Peer snapshot validation checks the match ID, phase and roster. Compact
motion packets retain the trusted metadata; entering finished sends a full packet.
Clients apply only their own human award. No XP is derived from client-reported
stat packets, display names, UI clocks or replay events.

## Levels and persistence

Level n below 20 requires n * 1000 XP. Level 20 onward requires 20,000 per level.
Level 20 begins at 190,000 total XP. There is no gameplay level cap. Overflow,
large awards and high levels use safe integer arithmetic and constant-time
calculation after the introductory levels.

The existing octane-arena-profile save now contains progression, xpBaseTotal and
xpAwards. Old saves migrate to level 1/0 XP while keeping identity and career
stats. Garage/settings keep their separate saves. The durable award ledger is
keyed by source + match UUID; unlike recent career notices, it is never truncated.
Totals and compact numeric receipts save together; the in-memory API retains full before/after/breakdown objects. Unchanged saved data is cached instead of reparsing the entire ledger on each playtime save. Repeated completion observation returns the
original receipt without emitting another award. Rematches have new UUIDs.
Saves merge existing ledger entries so a stale customization tab cannot erase XP.
Web Locks serialize awards across same-origin tabs where supported; embedded
browsers that deny locks retain the synchronous fallback. Unavailable storage
uses session memory and shows a results warning. Clearing site data erases local
progression; there is no cloud account sync. Reset Local Profile retains XP.

LocalProfile.awardXP(amount, source) and onXPAward are the central API/event hook.
Source types include MATCH, CHALLENGE, EVENT and ROCKET_PASS_BONUS; only MATCH is
implemented. Future systems can subscribe without modifying UI or car physics.

## Presentation

Results show the starting level and XP, a ~2.2-second fill with a short boundary
hold/pulse/sound, overflow into subsequent levels, and nonzero breakdown rows.
SKIP works by mouse, keyboard or existing controller navigation. Reduced-motion
users see final progress immediately. Persistence never waits for animation.
Profile shows level, total XP and XP to next level; home uses the existing level
badge. Party HELLO/appearance shares only cosmetic level, not XP totals/receipts.

## Verification

npm test includes tests/progression.ts and tests/local-profile.ts. It verifies
formula/cap, idle/practice/bot/spectator exclusions, overflow, migration, durable
deduplication, stale saves, denied storage/locks, animation boundaries/skip,
300 active seconds, phase exclusions/overtime, all five authority modes and
party level metadata. Existing physics/gameplay tests remain enabled.

Browser tests (Playwright module available via PLAYWRIGHT_MODULE):

- node tests/progression-browser.cjs: actual zero-clock match-end award, level-up,
  controller skip, desktop/narrow results, rematch, profile, browser refresh and
  actual persistent-browser restart, Garage/settings, Free Play exclusion.
- node tests/progression-peer-browser.cjs: actual PeerJS host/guest sessions with
  a deterministic final-stat/completion fixture at the host Worker boundary;
  independent awards, MVP parity, party levels, duplicate guard, rematch and
  Home/Leave lifecycle. This is browser-session testing, not a two-device field test.

Production build and server build/tests are also required. No car/ball physics
parameters, map geometry, ranked systems or pass/challenge features are changed.
