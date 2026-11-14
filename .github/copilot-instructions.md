# Repository guidance

## Commands

The repository is an npm workspace monorepo (`workspaces: ["apps/*"]`) containing `apps/mobile`
(Expo / React Native / TypeScript) and `apps/api` (Fastify / TypeScript). Run workspace commands
from the repository root unless running Expo/EAS CLI commands specifically inside `apps/mobile`.

| Purpose                                                          | Command                                         |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| Install locked dependencies                                      | `npm ci`                                        |
| Start Metro for the installed mobile development client          | `npm run mobile`                                |
| Start mobile web development                                     | `npm run mobile:web`                            |
| Start API server in watch mode                                   | `npm run api`                                   |
| Build / start compiled API                                       | `npm run api:build` / `npm run api:start`       |
| Type-check all workspaces                                        | `npm run typecheck`                             |
| Lint / auto-fix all workspaces                                   | `npm run lint` / `npm run lint:fix`             |
| Check / apply formatting                                         | `npm run format:check` / `npm run format`       |
| Check Expo dependency compatibility                              | `npm run check:dependencies`                    |
| Combined checks (format, types, lint, dependency compatibility)  | `npm run check`                                 |
| Additional Expo diagnostics                                      | `cd apps/mobile && npx expo-doctor`             |
| Export Android and iOS JavaScript bundles to `apps/mobile/dist/` | `npm run mobile:export:check`                   |
| Generate native projects                                         | `npm run mobile:prebuild`                       |
| Build and run locally on Android / iOS                           | `npm run mobile:android` / `npm run mobile:ios` |

There is no configured application test runner or test suite yet. `mobile:export:check` checks
JavaScript bundling, not native compilation or runtime behavior.

Ordinary mobile screen, style, navigation, and JavaScript changes use the existing development
client and Metro; do not run prebuild or native builds for these changes. Native dependency,
config-plugin, permission, entitlement, identifier, launcher-icon, or native-splash changes require
a new client. Use Expo-compatible dependency selections (`cd apps/mobile && npx expo install <package>`)
for native packages.

## Architecture

- `apps/mobile`: Expo/React Native/TypeScript starter (`expo-router/entry`), with file-based routes
  in `apps/mobile/src/app/`. `apps/mobile/src/app/_layout.tsx` owns the root gesture-handler view,
  status bar, and headerless router stack. `apps/mobile/src/app/index.tsx` is currently the only
  screen: a safe-area-aware Hello World view with the logo.
- `apps/api`: Minimal Fastify/TypeScript starter (`apps/api/src/app.ts` and
  `apps/api/src/server.ts`) currently exposing `GET /health`. There is no database, authentication,
  financial data model implementation, or deployment configuration wired up yet.

React Query, Zustand, React Hook Form/Zod, Decimal.js, storage/security APIs, charts, and other
native libraries are installed in `apps/mobile` for future features. They are not yet wired into
application providers or runtime flows; do not assume those integrations already exist.

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
