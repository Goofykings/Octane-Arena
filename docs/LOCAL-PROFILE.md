# Browser-local profile replacement

The home profile button opens Customize Account. Its menu edits Name, shows
read-only stats, and provides Save/Back plus a confirmed local reset. Click the
profile picture to open six icon choices, eight color swatches and a custom color
picker. Icon/color changes save immediately; the name saves with Save. Names are
trimmed, 1–20 characters, without control characters. Player tags are removed
from profiles, displayed identities and LAN metadata. Values are assigned using
textContent/input values rather than interpolating user input into HTML.

`octane-arena-profile` stores a versioned object containing a local UUID, name,
avatar ID/color, stats and recent event IDs used to avoid double counting. Legacy
tags are discarded when loading, preserving names, UUIDs and stats. Corrupt/missing
fields recover to defaults; unavailable/full storage uses a session-only profile.
Writes occur immediately for identity/match events, every five seconds of active
play, and on page hide. Clearing site data can erase it; devices do not sync.

Tracked stats:

- Completed competitive matches, wins and losses (draws only increase matches).
- Goals credited by the existing scorer, excluding own goals. Free Play goals
  do not count as competitive goals.
- Active play time in soccer and Rings, excluding pause/countdown/menu time.
- Rings best progress/time from the existing versioned course records. Their
  working storage is retained.

Assists, saves, shots, boost totals, demos and rank/XP awards are not tracked by
this profile; no placeholder/fake numbers are displayed for them. Garage presets,
cosmetics and settings retain their existing clean local storage. Reset clears
name/avatar and local match/time stats after confirmation, keeping the UUID, event
deduplication history, garage/settings and existing Rings records.

Client login/register/password/logout/cloud-save/session handling and the
server's `/api/auth/*`, `/api/me` and cloud-save routes were removed. The running
server no longer opens the account database. Legacy database/backup modules and
old account data are retained inactive so saved data is not destructively erased.

LAN sends validated localPlayerId/name/avatarId/avatarColor/preset metadata; it does not send
profile stats. The server continues to assign independent anonymous session IDs,
so duplicate display names or tabs sharing a profile cannot collide as entities.
Local IDs cannot change within a live session. Renaming updates the lobby through
the existing appearance stream/poll; icon/color changes update both party clients
and the next match/replay uses the chosen avatar. Current match rosters remain
fixed. Anonymous party tokens remain for transport
continuity and are separate from the removed online account authentication.

Verification is in `tests/local-profile.ts`, `tests/accounts-browser.cjs`,
`tests/play-lan-browser.cjs`, `server/tests/local-profile.test.ts` and the server
suite. Browser QA covers six screen sizes, local save/reload, restored browser
storage after an on-disk Chrome profile is closed/reopened, real goal/win events, reset confirmation/preservation and
corrupt/unavailable storage. LAN QA checks live renaming without changing either
local or server IDs, labels, synchronized icon/color choices and continued matches.
Replay browser checks confirm the selected icon/color appears in both VS Bot and
LAN scorer cards. Client/server production builds
and the server's physics/party/network regression suite are required.
