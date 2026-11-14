# Repository guidance

## Commands

The repository is a pnpm workspace monorepo (`pnpm-workspace.yaml` with `packages/*`, `apps/*`,
`nodeLinker: hoisted`, and `allowBuilds`) containing `packages/shared` (`@welyt/shared` Zod 4
contracts), `apps/mobile` (Expo / React Native / TypeScript), and `apps/api` (Fastify / Drizzle ORM /
SQLite / TypeScript). Run workspace commands from the repository root unless running Expo/EAS CLI
commands specifically inside `apps/mobile`.

| Purpose                                                          | Command                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| Install locked dependencies                                      | `pnpm install --frozen-lockfile`                       |
| Build shared contracts package                                   | `pnpm run shared:build`                                |
| Start Metro for the installed mobile development client          | `pnpm run mobile`                                      |
| Start mobile web development                                     | `pnpm run mobile:web`                                  |
| Start API server in watch mode                                   | `pnpm run api`                                         |
| Build / start compiled API                                       | `pnpm run api:build` / `pnpm run api:start`            |
| Generate / apply API Drizzle migrations                          | `pnpm run api:db:generate` / `pnpm run api:db:migrate` |
| Run API integration tests (`node --test`)                        | `pnpm test`                                            |
| Type-check all workspaces                                        | `pnpm run typecheck`                                   |
| Lint / auto-fix all workspaces                                   | `pnpm run lint` / `pnpm run lint:fix`                  |
| Check / apply formatting                                         | `pnpm run format:check` / `pnpm run format`            |
| Check Expo dependency compatibility                              | `pnpm run check:dependencies`                          |
| Combined checks (format, types, lint, dependency compatibility)  | `pnpm run check`                                       |
| Additional Expo diagnostics                                      | `cd apps/mobile && pnpm dlx expo-doctor`               |
| Export Android and iOS JavaScript bundles to `apps/mobile/dist/` | `pnpm run mobile:export:check`                         |
| Generate native projects                                         | `pnpm run mobile:prebuild`                             |
| Build and run locally on Android / iOS                           | `pnpm run mobile:android` / `pnpm run mobile:ios`      |

`pnpm test` runs Fastify `app.inject()` integration tests against `:memory:` SQLite databases.
`mobile:export:check` checks JavaScript bundling, not native compilation or runtime behavior.

Ordinary mobile screen, style, navigation, and JavaScript changes use the existing development
client and Metro; do not run prebuild or native builds for these changes. Native dependency,
config-plugin, permission, entitlement, identifier, launcher-icon, or native-splash changes require
a new client. Use Expo-compatible dependency selections
(`cd apps/mobile && pnpm exec expo install <package>`) for native packages.

## Architecture

- `packages/shared`: Shared `@welyt/shared` workspace exporting Zod 4 schemas, auth DTOs, and
  standardized API error codes consumed by both `apps/api` and `apps/mobile`.
- `apps/mobile`: Expo/React Native/TypeScript client (`expo-router/entry`), with file-based routes
  in `apps/mobile/src/app/`. `apps/mobile/src/app/_layout.tsx` owns the root `GestureHandlerRootView`,
  `QueryClientProvider`, status bar, splash-screen session hydration, and `Stack.Protected` guards
  separating `(auth)` (sign-in, sign-up, verify-email, forgot-password, reset-password) and `(app)`
  (verified workspace and change-password). Auth state uses Zustand + SecureStore (with web
  AsyncStorage fallback) and a fetch client with single-flight `401` refresh rotation.
- `apps/api`: Fastify/TypeScript API (`apps/api/src/app.ts` and `apps/api/src/server.ts`) backed by
  SQLite (`better-sqlite3`) and Drizzle ORM (`apps/api/src/db/schema.ts`, migrations in
  `apps/api/drizzle/`). Exposes `GET /health` and `/auth/*` routes (`register`, `login`, `refresh`,
  `logout`, `logout-all`, `me`, `verify-email`, `resend-verification`, `forgot-password`,
  `reset-password`, `change-password`) plus `app.authGuards` (`authenticate`, `requireVerifiedEmail`).

Decimal.js, charts, biometric local-auth, document picker, notifications, and financial domain
models remain installed in `apps/mobile` for upcoming financial modules.

`apps/mobile/app.json` is the source for native identity, config plugins, permissions, branding, and
Expo Updates configuration. `apps/mobile/eas.json` defines internal development-client builds:
`development` produces an Android APK, and `development-simulator` extends it for the iOS simulator.
Both have their own update channels. Native projects should be synchronized through prebuild when
native work is requested.

## Conventions and local references

- `tsconfig.base.json` holds shared strict TypeScript settings (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`, `verbatimModuleSyntax`). Use type-only imports
  where required. In `apps/mobile`, the `@/*` alias maps to `apps/mobile/src/*`; keep routes under
  `apps/mobile/src/app/`. In `apps/api`, use `.ts` extensions for relative imports
  (`rewriteRelativeImportExtensions` and `erasableSyntaxOnly` are enabled so `node --watch` runs
  `.ts` directly and `tsc` rewrites extensions on build).
- Current mobile screens use React Native primitives, `StyleSheet.create`, and
  `react-native-safe-area-context`. Preserve the root `GestureHandlerRootView` when adding navigation
  or providers.
- Prettier uses single quotes, trailing commas, and a 100-column print width. EditorConfig specifies
  two-space indentation and LF line endings. `apps/mobile` uses Expo's flat ESLint config plus
  `eslint-config-prettier`; `apps/api` uses `typescript-eslint` plus `eslint-config-prettier`.
- `apps/mobile/assets/logo.svg` is the branding source; raster launcher, adaptive-icon, splash, and
  favicon assets derive from it. The brand colors are navy `#26333c` and peach `#efb397`. The in-app
  logo is loaded from `apps/mobile/assets/icon.png`; updating native branding assets requires
  rebuilding the client.
- `local/` is Git-ignored. Its `mockups/` folder holds browser prototypes and developer-handoff
  references, not production app code. Mockup edits simulate record changes in memory and do not
  update a workbook or application database. The local README's old sibling-project commands are not
  runnable application test commands for this checkout.
- `local/mockups/private-preview/` contains private financial records. Do not force-add, publish,
  upload, or share it, and do not publicly serve the whole mockup directory. Use sanitized developer
  previews or handoffs when sharing designs. Inspect the upload archive before remote builds; do not
  assume Git ignore rules alone protect local material.
