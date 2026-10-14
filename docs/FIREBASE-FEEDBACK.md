# Firebase feedback setup

The Home screen's top-right FOUND A BUG? button opens a compact modal. Types are Bug, Feature Request and Other. Description is trimmed, must contain text, and is limited to 2,000 characters. Reports automatically use the current local profile username, GAME_VERSION, screen and mode. Firebase adds createdAt using serverTimestamp().

The supplied web configuration for the octane-arena Firebase project is now installed in src/config/firebase.ts. The remaining Firebase-side step is to enable the default Firestore database and publish firestore.rules. Live delivery has not been verified against that project.

## Set up your Firebase project

1. Sign into [Firebase Console](https://console.firebase.google.com/) and create a project. Analytics is optional and is not used by this feature.
2. From Project Overview, register a Web app using the </> icon. Name it Octane Arena. Firebase Hosting is not required; keep using GitHub Pages.
3. In Project settings -> General -> Your apps -> your Web app -> SDK setup and configuration -> Config, copy the Firebase web configuration values.
4. Paste those values into the firebaseConfig object in src/config/firebase.ts. This is the only configuration file. Replace the empty apiKey, authDomain, projectId, storageBucket, messagingSenderId and appId values. Do not paste the entire Firebase initialization snippet: the game already initializes the SDK lazily. measurementId is optional and unnecessary because Analytics is not used.
5. In Build -> Firestore Database, create the default database in Standard edition/native mode. Choose a region near you and start in Production/locked mode.
6. In the database's Rules tab, replace the initial rules with the complete contents of firestore.rules from this repository and press Publish. Do not leave a broad test-mode allow-read/write rule alongside these rules: matching allow rules are combined.
7. Run npm run build and deploy your updated build through your existing GitHub Pages workflow. No VITE_API_URL, custom backend, IP address, Firebase Authentication or Firebase Hosting is needed for feedback.
8. Submit a real report from the game. Sign into your Firebase account and open your project -> Build -> Firestore Database -> Data -> feedbackReports. The collection appears automatically on the first successful submission. Click a document to see username, reportType, description, gameVersion, screen, mode and createdAt.

Official setup references: [Firebase web setup](https://firebase.google.com/docs/web/setup), [Firestore quickstart](https://firebase.google.com/docs/firestore/quickstart).

## Security rules

Paste the entire firestore.rules file, not just its allow-create line. It only permits creation of schema-valid feedbackReports documents, requires the timestamp to match server request time, and denies all player reads, updates and deletes. Unknown fields, unsupported types, blank descriptions and oversized reports are denied too. Other collections are denied by this standalone ruleset; merge deliberately if your Firebase project has other apps/data.

Your Firebase Console access uses your Google account's project permissions; players do not get those permissions. No Admin SDK or service-account credentials are shipped with the game. Firebase web config is public by design; security comes from the rules. See [Firebase API keys](https://firebase.google.com/docs/projects/api-keys) and [field validation](https://firebase.google.com/docs/firestore/security/rules-fields).

The existing Octane profile is browser-local, so username is a reported display name, not a verified Firebase identity. No account/sign-in system is added. The successful-report cooldown is local to this browser, stored as octane-arena-feedback-last-success, and lasts about 120 seconds after server acknowledgment. It is not server-enforced rate limiting.

## Packages and implementation

- firebase 13.0.0: normal modular Firebase web SDK; firebase/app plus firebase/firestore/lite. Lite is used for one-shot reports and has no offline write queue or live report listeners. Firebase code is imported only when a configured submission is attempted.
- re2js: test-only dependency for validating the rule's multiline nonblank regex syntax.
- @grpc/grpc-js is pinned through an npm override to patched 1.14.6 for Firebase's transitive Node transport. The browser feedback path does not use gRPC. npm install reports zero vulnerabilities.

Configuration: src/config/firebase.ts.
Document schema/limits: shared/feedback.ts.
Submission/cooldown: src/game/feedback.ts.
SDK write: src/network/firebase-feedback.ts.
Modal/home button: src/ui/feedback-panel.ts, integrated in src/main.ts.
Security policy: firestore.rules.

No report-read API, edit/delete controls, Formspree or private credentials are included. Failed submissions keep the original text and selected type and can be retried immediately. A pending submission blocks double clicks and form edits. Successful acknowledgment shows Thanks! Your report was submitted., clears the form, and starts the cooldown. Closing the modal does not discard a failed draft.

## Verification

npm run test:feedback validates empty/oversized reports, types/metadata, trimming, pending locking, success-only persistent cooldown, retry/storage fallback and error mapping. It exercises the actual Firebase SDK with a mocked HTTP response and verifies a create-only write precondition, the feedbackReports path, all fields and the server timestamp transform. It does not send reports to a real Firebase project.

After npm run build, tests/feedback-browser.cjs uses the existing production-browser runner to check the modal, responsive layout, mouse/controller input, metadata, retained failed drafts, duplicate-submit prevention, success clearing and reload cooldown. Its writer is mocked. Native security-rule enforcement and actual Console delivery must be checked against your project after configuration; no Firebase project credentials were supplied for this implementation.

Normal regressions: npm test and npm run build. Browser command: set PLAYWRIGHT_MODULE to an installed Playwright package and run node tests/feedback-browser.cjs (uses installed Chrome and the built dist folder).

Final verification: npm test passed after the controller focus correction; npm run build passed; the server build also passed. Production Chrome UI checks passed with a mocked writer at four viewport sizes, including controller traversal and keyboard text entry, pending close/reopen, retry, success clear and reload cooldown. The actual Firebase SDK request format/server timestamp was tested with mocked HTTP responses. The final compact modal screenshot was visually inspected. No live Firebase project or security-rules emulator was used; publish the provided rules and verify delivery in your project after adding its web configuration.
