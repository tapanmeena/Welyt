# Welyt

Welyt is a pnpm workspace monorepo for a personal finance application, containing shared Zod
contracts (`packages/shared`), an Expo / React Native / TypeScript client (`apps/mobile`), and a
Fastify / Drizzle ORM / SQLite API (`apps/api`).

`apps/api` provides SQLite persistence via Drizzle ORM, `GET /health`, and full email/password
authentication (registration, sign-in, rotating refresh tokens with reuse revocation, email OTP
verification, forgot/reset password, password updates, and profile preferences). `apps/mobile`
wires Expo Router protected route groups, SecureStore session persistence, single-flight token
refresh, React Query, Zustand, and React Hook Form auth screens. Financial domain screens and
deployment configuration are not implemented yet.

## Project layout

```text
.
├── .github/
│   └── copilot-instructions.md # Repository guidance
├── packages/
│   └── shared/                 # @welyt/shared Zod 4 schemas, auth DTOs, and error codes
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
│       │   │   ├── (app)/      # Protected verified-user workspace and change-password routes
│       │   │   ├── (auth)/     # Sign-in, sign-up, verify-email, forgot/reset-password routes
│       │   │   └── _layout.tsx # Gesture root, QueryClientProvider, splash hydration, guards
│       │   ├── components/auth/# Reusable auth form and shell components
│       │   ├── features/auth/  # Auth API client methods, Zustand store, React Query hooks
│       │   ├── lib/            # Fetch client with 401 refresh queue, SecureStore adapter
│       │   └── theme/          # Brand color palette
│       ├── .env.example        # Mobile environment template
│       ├── app.json            # Expo identity, plugins, permissions, updates
│       ├── eas.json            # Internal development-client build profiles
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

This starts Metro with `--dev-client` in `apps/mobile`. Open an installed Welyt development client
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
| Type-check all workspaces                     | `pnpm run typecheck`                                   |
| Lint / auto-fix all workspaces                | `pnpm run lint` / `pnpm run lint:fix`                  |
| Check / apply formatting                      | `pnpm run format:check` / `pnpm run format`            |
| Check Expo dependency compatibility           | `pnpm run check:dependencies`                          |
| Run format, type, lint, and dependency checks | `pnpm run check`                                       |
| Additional Expo diagnostics (run in mobile)   | `cd apps/mobile && pnpm dlx expo-doctor`               |
| Export Android and iOS JS bundles             | `pnpm run mobile:export:check`                         |
| Generate native projects                      | `pnpm run mobile:prebuild`                             |
| Build and run locally on Android / iOS        | `pnpm run mobile:android` / `pnpm run mobile:ios`      |

`pnpm test` runs the API integration tests (`node --test`) against isolated `:memory:` SQLite
databases. `mobile:export:check` writes JavaScript bundles to `apps/mobile/dist/`; it does not
compile a native client or verify runtime behavior.

## App identity and EAS

[apps/mobile/app.json](./apps/mobile/app.json) is the source of truth for native configuration. Run
EAS CLI commands from `apps/mobile/`.

| Setting                     | Current value                          |
| --------------------------- | -------------------------------------- |
| Display name                | `Welyt`                                |
| Expo slug                   | `Welyt-mobile`                         |
| App version                 | `0.1.0`                                |
| Android package             | `com.tapanmeena.welyt`                 |
| iOS bundle identifier       | `com.tapanmeena.welyt`                 |
| URI scheme                  | `welyt`                                |
| EAS project ID              | `38ca27d6-eb6f-4d3f-8f9f-c3bb59e370dc` |
| Expo Updates runtime policy | `appVersion`                           |

Expo Updates is installed and configured with this project's update URL. EAS uses remote app-version
sourcing. The [EAS configuration](./apps/mobile/eas.json) defines only internal development-client
profiles:

| Profile                 | Configuration                                  | Update channel          |
| ----------------------- | ---------------------------------------------- | ----------------------- |
| `development`           | Development client; Android APK                | `development`           |
| `development-simulator` | Extends development; targets the iOS simulator | `development-simulator` |

No preview or production build profile is defined. EAS configuration does not establish that a
binary has been built, credentials are available, or an update has been published.

### Prepared native capabilities

Config plugins cover routing, the development client, date selection, fonts, splash/status behavior,
secure storage, local authentication, sharing, and notifications. Android app-data backup is disabled.
Biometric permissions and Face ID usage descriptions are configured, but the current screen does not
invoke these APIs or request runtime permissions.

The notifications plugin enables remote-notification configuration in development mode and disables
background remote notifications. Actual remote push delivery still requires platform credentials
and signing/capability setup; no Android Firebase configuration file is referenced in
`apps/mobile/app.json`.

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
