# Omnigalactic

Personal mission control for anyone with a Google account — calendar, tasks,
shopping list, notes, budget, investments, and vendors, in an installable
offline-first PWA. Built with React, Firebase Authentication (Google sign-in),
Firestore, Cloud Functions, and Firebase Hosting.

Live site: https://omnigalactic-e668d.web.app

Sign in with any Google account and you get your own private copy of
everything. Data lives under `users/{uid}` in Firestore; `firestore.rules`
lets each account reach only its own subtree, and there is no shared or
cross-account data.

## Local development

Requires Node.js 22.

```bash
npm ci
npm run dev
```

The app runs at http://localhost:3000. Firestore features use the browser SDK
and its persistent offline cache. The Firebase browser configuration in
`firebase-applet-config.json` identifies the Firebase app and is intentionally
client-visible.

## Validation

```bash
npm run lint            # TypeScript type-check
npm test                # vitest unit tests + node --test script tests
npm run test:rules      # security-rules tests against the Firestore emulator
npm run test:e2e:offline# Playwright offline PWA tests (auth+firestore emulators)
npm run build           # production build
npm run verify:offline  # offline/PWA release checks on the built bundle
```

## Production deployment

```bash
npm run deploy   # builds, then deploys firestore rules + hosting
```

Deploying the Cloud Functions (`firebase-tools deploy --only functions`)
requires the project to be on the Blaze plan. The functions back two hosting
rewrites:

- `/api/quotes` — live stock quotes for the Invest tab (TradingView scanner
  first, Yahoo Finance fallback, 30 s cache). Signed-in, verified accounts
  only; per-IP and per-account rate limits.
- `/api/files` — vendor/purchase attachments (warranties, invoices,
  receipts). The function owns both the Cloud Storage object under
  `userFiles/{uid}/…` and the Firestore metadata doc under
  `users/{uid}/(vendors|purchases)/{id}/files/{fileId}`; clients never touch
  Storage directly and `storage.rules` denies all direct access. Every path
  is scoped by the caller's verified uid, so accounts are isolated
  structurally.

Without the functions deployed, everything else works; Invest falls back to
manual prices and attachments are unavailable.

## Data model

Everything belongs to the signed-in account:

```
users/{uid}
  events/{id}            # calendar, with recurrence
  todos/{id}             # tasks, grouped by person label
  lists/{id}             # task lists
  notes/{id}             # markdown notes (graph view)
  shoppingItems/{id}
  people/{id}            # user-managed labels for organizing tasks
  vendors/{id}           # + files/{fileId} metadata (function-owned)
  purchases/{id}         # + files/{fileId} metadata (function-owned)
  budgets/household/{categories|subcategories}/{id}
  portfolios/household/{holdings|assetClasses|settings}/{id}
```

## Offline use

- The app shell, styles, scripts, and icons are cached by the service worker.
- Firestore uses persistent multi-tab IndexedDB storage with garbage
  collection disabled, plus a best-effort persistent-storage request.
- Adds, edits, and deletes are local-first: they update the UI and device
  cache immediately, then synchronize when connectivity returns.
- A global status reports **Offline · on device**, queued changes, active
  sync, or **Synced**; a background listener per collection keeps every tab's
  cache fresh no matter which tabs are opened.
- Initial sign-in requires a connection; previously cached data and queued
  writes do not.

On iPhone, install the site from Safari using **Share → Add to Home Screen**
and launch it from that icon. Open the app once while online after each
deployment so the updated service worker and app shell are cached.

## Firebase setup (one time, already done for the live site)

1. Create a Firebase project; enable the **Google** sign-in provider.
2. Create a Firestore database (production mode) and a default Storage bucket.
3. Add the web app's config values to `firebase-applet-config.json`.
4. Add the hosting domain under **Authentication → Authorized domains**.
5. In Google Cloud console → **Google Auth Platform → Audience**, set the
   publishing status to **In production** so any Google account can sign in.
6. `npm run deploy`, and optionally deploy functions on the Blaze plan.
