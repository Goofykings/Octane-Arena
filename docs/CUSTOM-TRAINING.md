# Custom training editor and community packs

Open Play > Extra Modes > Training Packs > Create Training Pack.
Use New Training Pack, enter a name (trimmed, required, maximum 40 characters), then Edit.
Community Packs also has its own entry in Training Packs.

## Shot model

shared/custom-training.ts validates plain serialized data, with a maximum of 50 unique-ID shots:

- id, name, createdAt, updatedAt
- enabled: boolean, default true (including older saved shots missing this field)
- carPosition: {x,y,z} in metres
- carRotation: normalized quaternion {x,y,z,w}
- carVelocity: {x,y,z} in metres/second, initially applied once, capped by P.car.maxSpeed
- ballPosition: {x,y,z} in metres
- ballLaunchDirection: normalized {x,y,z}, separate from ballLaunchSpeed (0 to P.ball.maxSpeed)
- ballAngularVelocity: {x,y,z}, bounded to 100 rad/s
- timeLimit: 1 to 120 seconds

The pack retains its original stable ID, name, millisecond local timestamps, version, and shots.
It adds authorName, ownerUid, publishedDocumentId, publishedAt, publishedVersion and publishedRevision.
Unknown remote fields are stripped; invalid numbers, quaternions, direction vectors, positions,
velocities, duplicated shot IDs, excessive counts and oversized payloads are rejected.
No Three.js/Rapier objects are written to local storage or Firestore.

## Controls and authoring

- The compact vertical shot list stays at the upper left, with room for at least three rows at standard viewport sizes. + at its bottom adds a shot. The small
  X toggle disables/re-enables a shot without deleting any local data. Gray rows are excluded
  from full-pack playback, the test list and publication. At least one shot must be enabled.
- Click and drag the ball/car directly to move along a horizontal plane. Hold Shift while starting
  a drag for camera-plane placement (including height). Every move uses the original collision
  shell/post clamping. Drag empty arena space to orbit; wheel zooms; right-drag pans; FOCUS
  centers the selected object. This authoring camera is independent of Ball Cam.
- Direction/power arrows stay visible. Drag an arrow tip to change both direction and initial
  speed; ball trajectory and numeric values update together. The thick arrows extend up to 18 m for the ball and 13 m for the car at the existing speed caps. Above 55% power their colors smoothly blend toward red, reaching full red at the cap. Dragging farther cannot add more speed. The short car arrow at zero velocity
  can be dragged to introduce motion. Car facing has a separate small green indicator.
- Only the selected object's controls are shown. Transform Controls is OFF by default and opts
  into the existing 3-axis Move and Aim/Rotate gizmos for that object. Selecting the other object
  hides advanced gizmos again. More reveals exact position, direction/power, car rotation/velocity
  and shot time fields; Less hides them. All original numeric ranges are retained.
- Next to the shot list, icon actions provide Undo/Redo, Duplicate, Delete and Move Earlier/Later.
  Duplicate inserts after the original with a new UUID, enabled=true, and selects the copy.
  Trash turns red on hover/controller focus and requires confirmation. The final deleted shot
  is replaced by a default. X is reversible exclusion; trash is deletion.
- Undo/Redo stores at most 80 authored-state changes. Each pointer/gizmo drag is one history step.
  Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes outside text fields. Text fields retain native
  text undo. Selection, camera, menu, More and sidebar visibility are not pack edits.
- PLAY SHOT at top right tests the selected enabled shot using unchanged playback physics.
  Its enabled-only vertical list switches/reset shots immediately without returning to edit.
  Goals play the existing preset goal explosion and physical blast instead of a text-only result.
  SKIP, Space, or controller Jump immediately advances; otherwise the effect finishes before advancing.
  BACK TO EDITOR restores editing without losing draft data. Reset restores authored transforms,
  momentum, boost, camera and shot state. No challenge/XP rewards are awarded here.
- Previous/Next/Focus (or Reset in playback) now sit in a compact right-side action bar.
  The left panel has a left/right handle that slides the entire shot list and selected-object controls
  closed/open in 0.25 seconds. The handle remains visible and hidden controls are inert.
  Training menus and confirmations size to their content, capped to the viewport.
- The top-right hamburger or Escape opens the editor menu: RETURN, PUBLISH, SAVE AND EXIT, EXIT.
  Escape closes this menu; it never leaves the editor directly. Controller Start opens it too.
  RETURN resumes without saving. SAVE AND EXIT saves locally and returns to My Packs; it does
  not publish. Ctrl/Cmd+S is an in-place local save shortcut, including from a numeric field.
- EXIT with authored changes requires UNSAVED CHANGES confirmation. CANCEL keeps the draft;
  EXIT WITHOUT SAVING discards only edits since the last save, preserving the saved pack.
  Browser reload/close retains its unsaved-change warning. Save updates the dirty baseline;
  undoing back to that state clears the warning, while undoing a saved edit makes it dirty.
- PUBLISH uses the existing Firebase flow after saving the current full draft locally. Only
  enabled shots are sent, renumbered contiguously in playback; disabled shots remain locally.
  Errors preserve the draft. Publishing does not insert cloud receipt changes into undo history.
- Buttons, lists, numeric fields, menu and confirmations use the existing controller navigator.
  Precise 3D placement remains a mouse/keyboard operation.

## Trajectory prediction

The dotted preview reuses src/game/ball-prediction.ts, the same sphere-sweep predictor already used
by gameplay. It uses P.gravity, drag, speed cap, restitution, and the actual static arena collision
geometry. Floor, wall, ceiling and backboard bounces are included. It stops at predicted goals.
It does not include car interactions or the full contact solver's spin/friction/grounding response.
It is a planning preview, not a promise of exact post-bounce motion.

The deterministic tests measure about 0.056 m maximum error in a one-second free-flight example.
Over 0.8-second bounce examples, maximum errors were roughly: floor 0.66 m, wall 0.41 m,
ceiling 1.01 m, backboard 0.24 m. Spin and multiple bounces may diverge further.

Only changed parameters trigger prediction, capped to 20 Hz during dragging. 80 instanced sphere dots
are reused; about 1.8 m spacing, 0.19 m near-ball dot radius, tapered/faded along the path.
Animation phase advances with launch speed independently from physical prediction.
There is no per-frame full Rapier re-simulation and no per-frame particle allocation.

## Local storage and playback

CustomTrainingLibrary retains the profile-scoped key:
  octane-arena-custom-training:<localPlayerId>

The versioned localStorage adapter remains replaceable by IndexedDB. Empty foundation packs are
supported; their first edit creates a default shot. Old local-only publication flags without a cloud
ID are treated as drafts. Names, IDs, creation dates and saved contents are retained.
Malformed/unsupported libraries are never silently overwritten.

Play Pack starts the first enabled shot. Disabled shots are omitted without blank levels. Reset retries; Previous/Next or existing training navigation bindings cycle
shots. A time limit completes a shot after a brief delay. A goal plays the equipped explosion
until it finishes or is skipped, then advances to the next enabled shot.
The last shot shows Pack Complete. Reset or a shot tab can restart.
This is generic shot practice; specialized custom save/goal objectives and custom replays are future work.

CustomTrainingSession reuses Simulation, FixedLoop, GameCamera, the original Soccar drawArena and
existing car/ball rendering. It has one controllable car and no bots. Editing runs no simulation steps.
Neither editing nor custom playback emits match completion/stat/challenge/XP events or accrues career play time.
Normal matches, built-in training, Free Play and multiplayer keep their existing paths.

## Publishing and ownership

The existing Firebase web config stays in src/config/firebase.ts. No new production package is needed:
the existing firebase package provides Auth, Firestore and optional App Check.

FirebaseTrainingPacks signs in anonymously lazily before publishing/unpublishing, using Firebase Auth's
normal browser persistence. There is no visible login page and the local Octane profile is unchanged.
The Firebase UID is the security identity; the local username is only the visible authorName.
Clearing site data, using another browser, or losing the anonymous account can lose publication ownership.
Do not enable automatic cleanup of anonymous users if you need long-lived publication ownership.
Account linking/export/recovery can be added in a later pass.

publishedTrainingPacks/<ownerUid>_<packId> contains only:
  packId, ownerUid, authorName, name, version, createdAt, updatedAt, publishedAt,
  shotCount, shots, published:true

Cloud createdAt/updatedAt/publishedAt are serverTimestamp() values, not the client's clock.
Payloads are sanitized before sending and limited to 50 shots and 150 KB locally.
Publishing requires a valid nonempty pack; the old local-only Publish button is replaced.
Only a confirmed successful write marks the local pack published. Errors retain local data.
Editor publishing saves the draft first. Library publishing publishes the saved version.

Updates use a transaction, immutable owner UID and creation timestamp, and monotonically incremented
server version. A stale published version is rejected instead of overwriting a newer publication.
Changed local drafts show Modified / Update Published Pack. Unpublish explicitly deletes the public
record as its owner and keeps the local pack. Deleting locally never silently deletes a public copy.

The browser queries published=true, orders by document ID, requests at most 21 records (20 displayed
plus one to detect another page), and uses a cursor for Load More. Downloaded data is validated again
before read-only playback. Playing another person's pack cannot write back to their document.
There are no ratings, comments, likes or download counters.

## Firebase console setup (required before public use)

1. In the existing octane-arena Firebase project, open Authentication > Sign-in method and enable
   Anonymous. Keep your local Octane profile system; do not create a visible sign-in flow.
2. Under Authentication > Settings > Authorized domains, include goofykings.github.io and your testing
   domain as appropriate. The existing web configuration already targets octane-arena.
3. Open Firestore Database > Rules. Copy the ENTIRE repository firestore.rules file into the editor
   and publish it. This file is the exact combined rule set, including the unchanged create-only
   feedbackReports rules and the new publishedTrainingPacks rules. Do not replace it with allow-all rules.
4. No manually created collection or composite index is needed. First Publish creates the collection.
   You can view records in Firestore Database > Data > publishedTrainingPacks.
5. Deploy the normal frontend build to GitHub Pages. No hosting migration or separate game URL is required.

Rules enforce allowed top-level fields, lengths, immutable UID/pack ID, server timestamps, version increments,
1-50 shots, matching shot count, and bounded published-only listing. Other collections remain denied.
Nested shot numeric/geometry validation is also performed on every client upload/download; Firestore Rules
cannot iterate an arbitrary list to reproduce the full physics schema. A trusted validation/moderation
service and publishing quotas are recommended before large-scale public discovery.

## App Check preparation

Both feedback and publishing use firebaseWebApp(), which initializes App Check before requests if the
PUBLIC VITE_FIREBASE_APP_CHECK_SITE_KEY build variable is set. No private key belongs in this variable.

Register the web app in Firebase App Check with reCAPTCHA Enterprise, authorize the real website domains,
put that public site key in .env.local and the GitHub Pages build environment, and rebuild/deploy.
Monitor App Check metrics first, verify both feedback and publishing from the deployed website, then
turn on Firestore enforcement. Configure development debug tokens separately; never commit them.
See https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider and
https://firebase.google.com/docs/auth/web/anonymous-auth for the console/provider steps.

## Verification commands

- npm test: all existing regressions plus foundation/editor deterministic tests.
- npm run build: production type check and bundle.
- npm run test:custom-training: storage/model/shot editing/geometry/prediction, enabled migration/filtering, dirty-state and history tests.
- npm run test:feedback: unchanged feedback payload and serverTimestamp behavior.
- After a production build, run tests/custom-training-browser.cjs and tests/training-editor-browser.cjs
  with PLAYWRIGHT_MODULE pointing to your installed Playwright module (Chrome is used).
- For isolated Firebase tests, run Firebase CLI emulators:start --only auth,firestore
  --project demo-octane-training using firebase.json, then set FIRESTORE_EMULATOR_HOST=127.0.0.1:8087
  and run npm run test:training-cloud. Java 21+ and Firebase CLI are test prerequisites, not game dependencies.
  tests/training-editor-browser.cjs also targets these emulators in two independent browser sessions.
  Tests never publish fixtures to the live octane-arena project.

The emulator tests verify anonymous publish, independent public read/play, owner updates/versioning,
foreign-UID update/delete denial, unpublish, query limits and unchanged feedback create-only access.
The public Firebase project still needs the console setup above; a live production publication has not been tested.

## Next editor pass

Transform snapping, richer shot objectives, goalie-specific success detection, custom goal
replays, pack import/export/ownership recovery, and more exact spin/friction bounce previews.
Community search/moderation and server-side validation/quotas should precede broad public promotion.
