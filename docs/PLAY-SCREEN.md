# Play screen and arena selection

Free Play opens a setup screen with the existing four arena choices and an
Enter Free Play button. Its choice remains saved separately from automatic match
selection. Back/Escape returns to the four-card Play screen.

Bot matches choose a soccer arena before starting. `shared/arenas.ts` defines the
valid soccer pool and excludes the previous match's arena. An injectable random
source makes selection repeatable in tests. Extra Modes bypass this selection;
Rings retains its own open course.

The LAN server chooses the arena when creating a match. `arenaId` travels through
the existing shared match snapshot, stays fixed for that match, and is applied by
each client before creating its match view. Saved Free Play choices cannot
override it. Transport, input handling, matchmaking rules and gameplay physics
are unchanged.

The Play screen uses four equal `minmax(0, 1fr)` columns, responsive gaps, card
padding/icon/text sizes, and the available screen height. At widths of 850 pixels
or less it uses two columns. Only Play layout rules are overridden; existing card
art, fonts, hover effects and screen animations remain.

Verification:

- `tests/arena-choice.ts`: valid pool, deterministic samples, no immediate repeats.
- `tests/play-screen-browser.cjs`: 2560×1440, 1920×1080, 1366×768,
  1280×720, 1024×600, 900×600, 800×600, 640×480, 390×844 and 850×500;
  all cards visible, no scrolling/overlap, readable text, hover/click, all four
  Free Play maps, five Bot matches and fixed Rings world.
- `server/tests/network.test.ts`: identical server-selected arena on both sockets,
  stable arena across snapshots, and existing input/physics/match lifecycle checks.
- `tests/play-lan-browser.cjs`: two LAN clients with different saved Free Play
  choices render the same server-selected arena, including a second match without
  repeating the previous arena.
- Client production build and server build.

Browser suites accept `PLAYWRIGHT_MODULE` for an existing Playwright installation.
Existing browser fixtures now include the Free Play setup/launch step.
