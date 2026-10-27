# Fridge Board

A shared household list of what's in the fridge and what meals we could make,
edited by everyone in the household from their phones and computers.

This repository is **public**. It contains no secrets and no household email
addresses: who can sign in is stored in the database, not in the code (see
[Security](#security)).

## Features

- **Sign in with Google.** Only accounts on the household list get in;
  anyone else sees "Not on the list yet".
- **Fridge, Leftovers and Meals tabs.** Each tab shows how many items on it
  aren't crossed off yet.
- **Adding:** the "+ Add…" button at the top of each tab opens a popup to
  enter the name and, optionally, quantity, use-by date, note and the
  "Added on" date (today unless changed, to backdate food that was already
  in the fridge).
- **Fridge and Leftovers order:** oldest first, so forgotten food rises to the
  top. Items with a use-by date within 2 days, or past it, are flagged in red.
- **Age markers:** fridge items added more than 7 days ago show a clock and
  their age (for example "9d"). Leftovers show it from day 3, and it turns red
  from day 5, following the USDA guidance that cooked leftovers keep 3 to 4
  days.
- **Meals order:** the order they were added. Meals have no quantity, use-by
  date or age marker, but can carry a note or a recipe link.
- **Cross off** with the checkbox. Crossed-off items stay visible, struck
  through, for 24 hours; tap again to undo. After 24 hours they move to the
  Archive automatically. Nothing is deleted unless you delete it.
- **Edit** by tapping an item: the same popup opens with its details filled
  in, plus Delete (which needs two taps).
- **Account menu:** tap your name at the top right for Archive, People and
  Sign out.
- **Archive:** the 100 most recently archived items, each with Restore.
- **People** (owner only): add or remove the Google accounts that can sign
  in, including any shared device's account.
- **Live updates:** a change on one phone shows on every other open page
  within seconds.
- **Offline:** the last lists stay visible and changes sync when the
  connection returns.
- **Add to home screen:** on iPhone, Share > Add to Home Screen; on Android,
  the browser menu > Install app. It then opens like an app.

## How it works

```
                                   ┌── Firebase Authentication (Google sign-in)
Browsers ── Firebase Hosting ──────┤
            (serves the pages)     └── Cloud Firestore (lists + allowlist)
```

There is no server code. Firebase Hosting serves plain HTML, CSS and
JavaScript files, and the pages talk directly to Firebase. The security rules
in `firestore.rules` decide who may read or write what. Everything fits
Firebase's free Spark plan.

### Files

| Path | What it is |
| --- | --- |
| `public/index.html` | Page layout: sign-in, "not on the list", main view, account menu and the add/edit popup |
| `public/app.js` | Page behaviour: sign-in, live data, drawing the tabs, the add/edit popup, saving changes |
| `public/items.js` | List rules: which lists exist and in what order, sort order, 24-hour hide, age and use-by flags. Kept free of Firebase code so it's easy to test and other pages can reuse it |
| `public/style.css` | Styles, mobile-first, light and dark |
| `public/firebase-config.js` | The project's public Firebase web settings, and the stand-in settings used with the local emulators |
| `public/manifest.webmanifest`, `public/icon*` | Home-screen app name and icons |
| `firestore.rules` | Security rules: allowlist check and item validation |
| `firestore.indexes.json` | Database indexes (none needed yet) |
| `firebase.json` | Hosting, rules and local emulator settings |
| `.firebaserc` | Which Firebase project `npx firebase` commands act on |
| `package.json` | Developer tools (Firebase command-line tools, test libraries) and the `npm run` commands |
| `package-lock.json` | Exact versions of those tools, so every install gets the same ones |
| `.gitignore` | Files Git leaves out: installed tools, Firebase's cache, logs, test screenshots |
| `.gitattributes` | Keeps line endings consistent across computers (added by GitHub Desktop) |
| `tests/items.test.js` | Unit tests for the list rules |
| `tests/rules.test.js` | Security rules tests |
| `tests/e2e.mjs` | Browser test of the whole page at phone size |

### Data model

One Firestore collection, `items`, holds every list. The `list` field says
which list an item belongs to, so another list can be added without changing the database.

| Field | Type | Notes |
| --- | --- | --- |
| `list` | string | `fridge`, `leftovers` or `meals` (`freezer` is also accepted) |
| `name` | string | Required, up to 120 characters |
| `qty` | string or null | Free-form, e.g. "2", "half" |
| `use_by` | `YYYY-MM-DD` or null | Drives the red use-by flag |
| `note` | string or null | e.g. "uses the spinach", or a recipe link |
| `added_at` | timestamp | Drives the oldest-first order and the age marker; editable |
| `added_by` | email or null | Who added it |
| `done_at` | timestamp or null | Set when crossed off; null means active |
| `done_by` | email or null | Who crossed it off |
| `archived_at` | timestamp or null | Set 24 hours after crossing off; archived items leave the lists |

The `allowlist` collection has one document per Google account. The document
ID is the lowercase email address, and the `role` field is `owner` or
`member`. Members can read only their own entry; the owner manages the rest.

The 24-hour period and the 2-day use-by warning are constants at the top of
`public/items.js`. Each list's age-marker thresholds are set in the `LISTS`
table in the same file. To add a list, add an entry there and its id to the
allowed values in `firestore.rules`.

## Setup

You need [Node.js](https://nodejs.org/) 20 or later and a Google account.
These steps take about 20 minutes and are done once.

### 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   choose **Create a project**. Name it, for example, `fridge-board`. Turn
   **off** Google Analytics (this app uses no trackers).
2. **Build > Authentication > Get started > Sign-in method > Google**:
   enable it, pick a support email, save.
3. **Build > Firestore Database > Create database**: pick a location near you
   (for example `us-west1`), then **Start in production mode**.
4. **Project settings (gear icon) > General > Your apps > Web (`</>`)**:
   register an app called "Fridge Board". Copy the `firebaseConfig` values it
   shows.

### 2. Configure and deploy

1. In this folder, run `npm install`.
2. Open `public/firebase-config.js` and replace `null` with your config.
   Change `authDomain` to `<your-project-id>.web.app` (more reliable sign-in
   on iPhones). Google must also be told this address is allowed, or sign-in
   fails with "Access blocked: This app's request is invalid": in the
   [Google Cloud credentials page](https://console.cloud.google.com/apis/credentials),
   open **Web client (auto created by Google Service)**, add
   `https://<your-project-id>.web.app/__/auth/handler` under **Authorized
   redirect URIs**, and save. It can take a few minutes to take effect.
3. Run `npx firebase login`. (`.firebaserc` already points at the
   project. If you set up a different project, run `npx firebase use --add`
   and pick it.)
4. Run `npm run deploy`. This publishes the pages and the security rules. The
   app is now at `https://<your-project-id>.web.app`.

### 3. Make yourself the owner

The first owner has to be added by hand, because the app only lets an owner
add people.

1. In the Firebase console, open **Firestore Database > Data > Start
   collection**.
2. Collection ID: `allowlist`. Document ID: your Google email address in
   lowercase. Add a field `role` (string) with the value `owner`. Save.
3. In any browser, go to `https://<your-project-id>.web.app` (the Hosting
   URL that `npm run deploy` printed) and click **Sign in with Google**, using
   the account you just added. Then open **People** from the menu under your
   name to add everyone else.

### 4. Optional: App Check

App Check stops other websites and scripts from using your Firebase project.
In the console, open **Build > App Check**, register the web app with
reCAPTCHA v3, paste the site key into `APPCHECK_SITE_KEY` in
`public/firebase-config.js`, and deploy. Check the app still works, then turn
on **Enforce** for Cloud Firestore.

## Local development

Everything can run on your computer against the Firebase emulators, with fake
accounts and data that never touch the real project.

```sh
npm install
npm run dev
```

Then open <http://127.0.0.1:5000>. On `localhost` or `127.0.0.1` the page
always uses the emulators, never the live project.

The local database starts empty, so make yourself an owner first: open the
emulator dashboard at <http://127.0.0.1:4000>, go to **Firestore**, and add a
document `allowlist/<email>` with field `role` = `owner`. Then sign in on the
app with "Add new account" and that same email. The emulators need Java 11 or
later installed.

## Tests

```sh
npm test                       # list rules + security rules (15 tests)
npx playwright install chromium  # once, for the browser test
npm run test:e2e               # whole page in a phone-sized browser
```

The browser test seeds a household, signs in through the emulator's fake
Google sign-in, and checks sign-in refusal, ordering, flags, adding through
the popup (with quantity, use-by and backdating), cancelling, crossing off and
undo, editing, delete, the Leftovers age markers, the Meals tab, the account
menu, archiving and restore, managing people, and signing out. It saves screenshots to
`test-results/`.

## Security

- **Firebase web settings are public by design.** The values in
  `firebase-config.js` identify the project but grant no access. The security
  rules and the allowlist decide who can read or write.
- **No secrets in this repository, ever.** A future private key (for weather
  or AI features, say) goes in server-side configuration, never in code.
- **No email addresses in this repository.** The household list lives in
  Firestore. Keep it that way: don't commit exported data.
- **Commit with your GitHub no-reply address.** In GitHub, **Settings >
  Emails > Keep my email addresses private**, then run
  `git config user.email "<id>+<username>@users.noreply.github.com"` in this
  folder.
- **Removing someone** on the People page cuts off their access immediately.
- On the free Spark plan, heavy misuse can only exhaust the free quota and
  pause the app until it resets; it can't run up a bill.

## Requirements

Comments in the code refer to requirement IDs (FR-, ED-, HW-, NF-) from the
project's requirements document, which is kept outside this public
repository because it contains household details.
