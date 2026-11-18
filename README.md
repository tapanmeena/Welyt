---
title: Welyt
description: Develop and build the Welyt mobile app and API in a pnpm workspace.
---

Welyt is a pnpm workspace monorepo for a personal finance application, containing shared Zod
contracts (`packages/shared`), an Expo / React Native / TypeScript client (`apps/mobile`), and a
Fastify / Drizzle ORM / SQLite API (`apps/api`).

`apps/api` provides SQLite persistence via Drizzle ORM, `GET /health`, and full email/password
authentication (registration, sign-in, rotating refresh tokens with reuse revocation, email OTP
verification, forgot/reset password, password updates, and profile preferences). `apps/mobile`
wires Expo Router protected route groups, SecureStore session persistence, single-flight token
refresh, React Query, Zustand, and React Hook Form auth screens. Verified users can also manage
accounts and balance snapshots in Accounts & Cash. Other financial screens and deployment
configuration are not implemented yet.

## Project layout

```text
.
├── .github/
│   └── copilot-instructions.md # Repository guidance
├── packages/
│   └── shared/                 # @welyt/shared Zod 4 auth and account contracts
├── apps/
│   ├── api/                    # Fastify + Drizzle + SQLite API
│   │   ├── drizzle/            # Generated SQLite SQL migrations
│   │   ├── src/
│   │   │   ├── __tests__/      # Fastify inject + in-memory SQLite integration tests
│   │   │   ├── config/         # Environment validation
│   │   │   ├── db/             # Drizzle schema, client, and migration runner
│   │   │   ├── lib/            # Password scrypt, JWT, OTP crypto, errors, mailer
│   │   │   ├── modules/auth/   # Auth service and routes (/auth/*)
│   │   │   ├── plugins/        # Bearer JWT and verified-email route guards
│   │   │   ├── app.ts          # Fastify app builder, plugins, and routes
│   │   │   └── server.ts       # HTTP server entry point
│   │   ├── .env.example        # API environment template
│   │   ├── drizzle.config.ts   # Drizzle Kit configuration
│   │   ├── eslint.config.js    # API ESLint flat config
│   │   ├── package.json        # API dependencies and scripts
│   │   └── tsconfig.json       # API TypeScript config
│   └── mobile/                 # Expo (Android, iOS, web) client
│       ├── assets/             # Source logo and raster branding assets
│       ├── src/
│       │   ├── app/
│       │   │   ├── (app)/      # Verified tabs, account detail, and password change
│       │   │   ├── (auth)/     # Sign-in, sign-up, verify-email, forgot/reset-password routes
│       │   │   └── _layout.tsx # Gesture root, QueryClientProvider, splash hydration, guards
│       │   ├── components/auth/# Reusable auth form and shell components
│       │   ├── features/accounts/ # Accounts API integration, account and balance forms
│       │   ├── features/auth/  # Auth API client methods, Zustand store, React Query hooks
│       │   ├── lib/            # Fetch client with 401 refresh queue, SecureStore adapter
│       │   └── theme/          # Brand color palette
│       ├── .env.example        # Mobile environment template
│       ├── app.config.ts       # Variant identities, plugins, permissions, updates
│       ├── eas.json            # Development, preview APK, and production AAB profiles
│       ├── eslint.config.js    # Expo flat config and Prettier compatibility
│       ├── package.json        # Mobile dependencies and scripts
│       └── tsconfig.json       # Mobile TypeScript config
├── model.md                    # Financial and authentication data-model notes
├── package.json                # Workspace root scripts
├── pnpm-lock.yaml              # Single workspace lockfile
├── pnpm-workspace.yaml         # Workspace packages, hoisted linker, and build approvals
├── tsconfig.base.json          # Shared strict TypeScript compiler options
└── local/                      # Git-ignored local references; not application source
```

Expo Router loads through `expo-router/entry` inside `apps/mobile` and uses file-based routes under
`apps/mobile/src/app/`. The `@/*` import alias in `apps/mobile` maps to `apps/mobile/src/*`. Shared
validation schemas and DTOs live in `@welyt/shared` (`packages/shared`).

## Getting started

Install Node.js and pnpm compatible with the workspace packages, then install the locked
dependencies from the repository root:

```bash
pnpm install --frozen-lockfile
```

### Run the mobile app (development client)

```bash
pnpm run mobile
```

This starts Metro with `--dev-client` in `apps/mobile`. Open an installed Welyt Dev development client
and connect it to Metro. A compatible development client must be built and installed first;
`pnpm run mobile` does not create a native binary.

For ordinary screen, style, navigation, and JavaScript changes, keep using Metro and the existing
client.

### Run mobile for web

```bash
pnpm run mobile:web
```

This starts Expo's web development server for `apps/mobile`. Native-only features will need
platform-specific handling when implemented.

### Run the API server

Copy `apps/api/.env.example` to `apps/api/.env` if you want custom settings, then start the server:

```bash
pnpm run api
```

This builds `@welyt/shared`, runs pending Drizzle SQLite migrations against `DATABASE_URL`
(defaulting to `apps/api/data/welyt.db`), and starts the Fastify server in watch mode on
`http://localhost:3000` (configurable with `HOST` and `PORT`). Set `SMTP_USER` (your Gmail address)
and `SMTP_PASS` (your 16-character Google App Password) in `apps/api/.env` to deliver real
verification and password reset emails over Gmail SMTP; when left blank, codes and `welyt://` deep
links are logged to the API console.

For development email deep links, set `APP_SCHEME=welyt-dev` in `apps/api/.env`, as shown in the
environment template. Use `welyt-preview` for a preview API and `welyt` for production.

### Daily exchange rates

The running API fetches [Frankfurter v2](https://frankfurter.dev/) reference rates on startup and
daily at 22:00 India time. No API key is required. The job converts the provider's quotes to INR
per unit of foreign currency and stores the original publication dates. It sends no account or
user data to the provider.

The launch catalog contains INR, USD, EUR, GBP, AED, CAD, AUD, SGD, JPY, and CHF. If today's
quote has not been published, valuation can use a prior quote up to seven calendar days old.
Missing or older rates leave the INR total incomplete. The job does not backfill history.

To preview a historical import into the configured API database, pass both dates:

```bash
pnpm run api:fx:backfill --from 2020-04-01 --to 2026-11-17 --dry-run
```

The database must already have the API migrations. Both dates are inclusive. Use the last
completed day in India as the end date, then remove `--dry-run` to save the available rates.
The importer preserves existing rates and manual overrides, and reports days Frankfurter did
not return. If it stops, rerun the range to fill remaining gaps without duplicating rows.

Set `FX_AUTO_REFRESH=false` in `apps/api/.env` to disable the job without removing saved rates.
If several API processes share the database, enable the job on only one of them.

### Navigate the app

Sign in with a verified email to see **Home**, **Accounts**, **Plan**, and **More**.
**Plan** opens Monthly Plan and links to Income History. **More** contains your profile,
financial preferences, password change, and sign-out controls. Account details and open
editors hide the tab bar.

### Use Accounts & Cash

Open **Accounts** and choose a currency when creating an account. Open the account to record
a dated balance in that currency, review its history, or correct a snapshot. Corrections retain
the original balance in history, and archived accounts are read-only.

The Home cash summary values included active accounts in INR. It shows the report date,
the dates of exchange rates used, and a subtotal when some accounts cannot be valued.

### Track actual income

Open **Plan** and select **Income History** to record or correct receipts and review April-to-March
history. Receipts stay in their original currency. The report uses the latest stored FX rate
on or before each receipt date and labels missing or stale rates as incomplete. Recording income
does not change account balances. If the receipt migration is pending, run `pnpm run api:db:migrate`.

### Plan a month

Open **Plan** in the bottom navigation. Enter expected net income and fixed, flexible,
or saving allocations in INR. A shortfall is shown before saving but does not block the save.
Each save creates a revision you can revisit.

Routine successes use a brief in-app snackbar. Swipe it left or right to dismiss it early.
Warnings such as a shortfall stay on the screen after the snackbar disappears.

Use **Copy Previous Month** to prefill a blank month's draft, or enable **Month-start auto-copy**
to save a copy automatically at the next India-local month boundary. Auto-copy never replaces
a saved plan. Neither copy option moves money or changes actual receipts and account balances.
Apply pending planner migrations with `pnpm run api:db:migrate`.

### Create or refresh a native mobile client

`apps/mobile` does not currently contain generated `android/` or `ios/` directories. Generate them
when needed through Expo prebuild:

```bash
pnpm run mobile:prebuild
```

With the appropriate Android SDK or Xcode environment configured, build and run locally using:

```bash
pnpm run mobile:android
# or
pnpm run mobile:ios
```

Native dependencies, config plugins, permissions, entitlements, app identifiers, launcher icons,
and native splash changes require a new client. Install Expo-compatible native dependencies inside
`apps/mobile` (`cd apps/mobile && pnpm exec expo install <package>`), and synchronize generated
native projects through prebuild when changing native configuration.

## Commands

Run workspace commands from the repository root:

| Purpose                                       | Command                                                |
| --------------------------------------------- | ------------------------------------------------------ |
| Install locked dependencies                   | `pnpm install --frozen-lockfile`                       |
| Build shared contracts package                | `pnpm run shared:build`                                |
| Start Metro for the mobile development client | `pnpm run mobile`                                      |
| Start mobile web development                  | `pnpm run mobile:web`                                  |
| Start API server in watch mode                | `pnpm run api`                                         |
| Build / start compiled API                    | `pnpm run api:build` / `pnpm run api:start`            |
| Generate / apply API Drizzle migrations       | `pnpm run api:db:generate` / `pnpm run api:db:migrate` |
| Run API integration test suite                | `pnpm test`                                            |
| Run Android hardware regression tests         | `pnpm run mobile:test:android`                         |
| Test mobile variant and update configuration  | `pnpm --filter welyt-mobile run test:config`           |
| Type-check all workspaces                     | `pnpm run typecheck`                                   |
| Lint / auto-fix all workspaces                | `pnpm run lint` / `pnpm run lint:fix`                  |
| Check / apply formatting                      | `pnpm run format:check` / `pnpm run format`            |
| Check Expo dependency compatibility           | `pnpm run check:dependencies`                          |
| Run format, type, lint, and dependency checks | `pnpm run check`                                       |
| Additional Expo diagnostics (run in mobile)   | `cd apps/mobile && pnpm dlx expo-doctor`               |
| Export Android and iOS JS bundles             | `pnpm run mobile:export:check`                         |
| Create Android production AAB                 | `pnpm run mobile:build:android:production`             |
| Create Android preview APK                    | `pnpm run mobile:build:android:preview`                |
| Publish Expo updates (specify channel/env)     | `pnpm run mobile:update`                               |
| Generate native projects                      | `pnpm run mobile:prebuild`                             |
| Build and run locally on Android / iOS        | `pnpm run mobile:android` / `pnpm run mobile:ios`      |

`pnpm test` runs the API integration tests (`node --test`) against isolated `:memory:` SQLite
databases. `mobile:export:check` writes JavaScript bundles to `apps/mobile/dist/`; it does not
compile a native client or verify runtime behavior.

### Android hardware regression tests

Connect an unlocked Android phone over USB, authorize it in `adb devices -l`, and install the
Welyt development client. Run `pnpm run mobile:test:android` from the repository root. Set
`ANDROID_SERIAL` if more than one USB device is attached. No existing Metro or API server is
required.

The suite drives the phone and cold-restarts Welyt, so keep the phone unlocked and leave it alone
while the cases run. It uses a disposable API database, fixed FX fixtures, and separate
development-only sign-in keys. The regular Welyt session and local API database are not used.
The cases cover verified sign-in, INR valuation with an FX date, incomplete totals, correction
history, and session recovery after a restart. They also cover receipt correction, income history,
and saving or copying a monthly plan without changing receipts or cash.

## App identity and EAS

[apps/mobile/app.config.ts](./apps/mobile/app.config.ts) is the source of truth for native configuration. The
package scripts below run from the repository root and invoke EAS inside the mobile workspace.
Run direct EAS CLI commands from `apps/mobile/`.

| Setting                     | Current value                          |
| --------------------------- | -------------------------------------- |
| Production display name     | `Welyt`                                |
| Expo slug                   | `Welyt-mobile`                         |
| App version                 | `0.1.1`                                |
| Production Android package  | `com.tapanmeena.welyt`                 |
| Production iOS bundle ID    | `com.tapanmeena.welyt`                 |
| Production URI scheme       | `welyt`                                |
| EAS project ID              | `38ca27d6-eb6f-4d3f-8f9f-c3bb59e370dc` |
| Expo Updates runtime policy | `appVersion`                           |

`APP_VARIANT` selects the native identity. Local Expo commands default to `development`; EAS build
profiles set the variable explicitly. Unknown values fail configuration instead of selecting
another app.

| Variant       | Display name    | Android package and iOS bundle ID | URI scheme      |
| ------------- | --------------- | --------------------------------- | --------------- |
| `development` | `Welyt Dev`     | `com.tapanmeena.welyt.dev`         | `welyt-dev`     |
| `preview`     | `Welyt Preview` | `com.tapanmeena.welyt.preview`     | `welyt-preview` |
| `production`  | `Welyt`         | `com.tapanmeena.welyt`             | `welyt`         |

These variants can coexist on one device. The iOS simulator profile inherits the development
identity. Only development registers Expo's generated development-client scheme, so Metro links
do not open preview or production. Configure each API's `APP_SCHEME` to match its variant.

Rebuild and reinstall the native clients after this migration. The Expo version is now `0.1.1`,
which also changes the `appVersion` update runtime so new bundles do not target older clients.
Development and preview use new application IDs and do not inherit the old installation's local
session or data. Production keeps its existing identifier.

Expo Updates is installed and configured with this project's update URL. EAS uses remote app-version
sourcing. The [EAS configuration](./apps/mobile/eas.json) defines these build profiles:

| Profile                 | Configuration                                  | Update channel          |
| ----------------------- | ---------------------------------------------- | ----------------------- |
| `development`           | Development client; Android APK                | `development`           |
| `development-simulator` | Extends development; targets the iOS simulator | `development-simulator` |
| `preview`               | Standalone Android APK; no development client  | `preview`               |
| `production`            | Store-distributed Android App Bundle (AAB)     | `production`            |

EAS configuration does not establish that a binary has been built, credentials are available, or
an update has been published.

### Build Android releases and publish updates

The `preview` and `production` profiles use their matching EAS environments and run without Metro.
Set `EXPO_PUBLIC_API_URL` in each environment to an API URL reachable from the device, not
`localhost`. This value is bundled into the app and must not contain secrets. The scripts require
EAS CLI (`eas`) on your PATH and an Expo login.

Before any remote build, inspect the upload archive to ensure it excludes private local material.
Then choose the production AAB or preview APK command from the repository root:

```bash
pnpm run mobile:build:android:production
pnpm run mobile:build:android:preview
```

The `eas-build-post-install` hook compiles `@welyt/shared` on the build worker before the release
bundle is generated. Install the preview APK on an Android device or emulator; distribute the
production AAB through Google Play.

To publish JavaScript and asset updates to preview, run from the repository root:

```bash
pnpm run mobile:update --channel preview --environment preview --platform android --message "Describe the update"
```

The update script builds shared contracts first, sets `APP_VARIANT` from `--environment`, and
forwards flags to `eas update`. The environment must be `development`, `preview`, or `production`.
To target production, use `--channel production --environment production` instead. Keep any
`APP_VARIANT` variable configured in EAS aligned with that environment.

Use the same EAS environment for builds and updates so their bundled configuration matches.
The profile's `channel` controls which update stream the app receives; change it for future builds
and use the matching `--channel` when publishing. Update URL and runtime settings remain configurable
in [apps/mobile/app.config.ts](./apps/mobile/app.config.ts).

Updates must match the installed app's runtime. With the `appVersion` policy, bump the config's `version`
and build a new binary whenever native dependencies or native configuration change. Compatible updates
are checked on app launch and normally applied on a subsequent launch; force close and reopen the
app twice to test a published update.

### Prepared native capabilities

Config plugins cover routing, the development client, date selection, fonts, splash/status behavior,
secure storage, local authentication, sharing, and notifications. Android app-data backup is disabled.
Biometric permissions and Face ID usage descriptions are configured, but the current screen does not
invoke these APIs or request runtime permissions.

The notifications plugin enables remote-notification configuration in development mode and disables
background remote notifications. Actual remote push delivery still requires platform credentials
and signing/capability setup; no Android Firebase configuration file is referenced in
[apps/mobile/app.config.ts](./apps/mobile/app.config.ts).

## Installed libraries

`apps/mobile` currently specifies Expo SDK 58, React 19.3, React Native 0.88, and TypeScript 6, and
`apps/api` uses Fastify 5 on Node.js with TypeScript 6. See [apps/mobile/package.json](./apps/mobile/package.json),
[apps/api/package.json](./apps/api/package.json), and [pnpm-lock.yaml](./pnpm-lock.yaml) for
exact dependency selections.

| Area                   | Libraries                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------ |
| API server & security  | Fastify, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `jose`           |
| Database & validation  | Drizzle ORM, `better-sqlite3`, Drizzle Kit, Zod 4 (`@welyt/shared`)                  |
| Routing and layout     | Expo Router, React Native Screens, Safe Area Context, Gesture Handler                |
| UI and animation       | Reanimated, Worklets, Bottom Sheet, Keyboard Controller, SVG, Lucide, DateTimePicker |
| Data and forms         | TanStack React Query, Zustand, React Hook Form, Zod, Hook Form resolvers             |
| Calculations and dates | Decimal.js, date-fns                                                                 |
| Storage and security   | AsyncStorage, SecureStore, Local Authentication                                      |
| Device and files       | NetInfo, Document Picker, File System, Sharing, Notifications, Haptics, Linking      |
| Charts and lists       | Gifted Charts, Linear Gradient, FlashList                                            |
| Expo support           | Dev Client, Constants, Font, Splash Screen, Status Bar, System UI, Updates, Insights |
| Web                    | React DOM, React Native Web, Expo Metro Runtime                                      |

Authentication, session rotation, SecureStore token persistence, React Query, Zustand, React Hook
Form, and Expo Router protected route groups are wired up across `packages/shared`, `apps/api`, and
`apps/mobile`. Financial tracking modules and charts remain to be wired.

## Branding and conventions

[apps/mobile/assets/logo.svg](./apps/mobile/assets/logo.svg) is the branding source. The brand
colors are navy `#26333c` and peach `#efb397`; the raster assets provide the launcher icon, Android
adaptive/themed icons, native splash image, and web favicon. The mobile screen currently loads
`apps/mobile/assets/icon.png`.

[tsconfig.base.json](./tsconfig.base.json) defines shared strict TypeScript settings across both
workspaces, including unchecked-index and exact-optional-property checks, explicit return-path
checks, and `verbatimModuleSyntax`. Use type-only imports where required. Mobile screens use React
Native primitives and `StyleSheet.create`; preserve the root `GestureHandlerRootView` when adding
providers or navigation.

Prettier uses single quotes, trailing commas, and a 100-column print width. EditorConfig specifies
two-space indentation and LF line endings. Mobile uses Expo's flat ESLint config with
`eslint-config-prettier`, and the API uses `typescript-eslint` with `eslint-config-prettier`.

## Local references and privacy

`local/` is Git-ignored and holds local mockups and handoff references, not production application
code. Browser prototypes simulate changes in memory; they do not update a workbook or application
database.

`local/mockups/private-preview/` contains private financial records. Do not commit, publish, upload,
or publicly serve that directory or the entire mockup directory. Use sanitized previews when
sharing designs, and inspect the upload archive before any remote build rather than relying on
Git ignore rules alone.

## License

See [LICENSE](./LICENSE).
