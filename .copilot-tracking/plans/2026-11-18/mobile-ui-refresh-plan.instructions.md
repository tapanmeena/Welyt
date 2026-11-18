<!-- markdownlint-disable-file -->
---
description: 'Plan the Welyt mobile UI refresh from the FinanceView mockups before adding new financial modules.'
applyTo: '.copilot-tracking/plans/2026-11-18/mobile-ui-refresh-plan.instructions.md'
---

# Welyt mobile UI refresh plan

Status: Proposed. Mockup review is complete; implementation has not started.

## User requests

* Review the mockups and use them as inspiration for the existing mobile app. The current UI is a
  proof of concept. Source: November 18 workspace discussion.
* Plan the UI update before taking on Investments or CSV export. Source: the same discussion,
  responding to the proposed next milestones. Include the pending iOS smoke test in refresh validation.

## Research and design direction

The [synthetic FinanceView preview](../../../local/mockups/index.html) already shares Welyt's
cream, ink navy, and rust palette. The bigger difference is hierarchy: financial information
comes first, common tasks have a consistent entry point, and settings are out of the way.
The [current Workspace](<../../../apps/mobile/src/app/(app)/index.tsx>) leads with a signed-in
profile card and combines cash, module links, preferences, and session controls. The verified
[app layout](<../../../apps/mobile/src/app/(app)/_layout.tsx>) is a stack without persistent
navigation. Accounts and planning use working forms and queries, but show most information as
similarly weighted cards and buttons.

| Mockup reference | Adopt for Welyt | Do not carry over |
| ---------------- | --------------- | ----------------- |
| [Overview](../../../local/mockups/index.html) | Dark summary card, prominent amount, visible date and scope, and supporting detail below it | Tracked net worth, sample balances, wealth charts, and goals |
| [Accounts](../../../local/mockups/financeview-accounts-e2e.html) | Searchable directory, dated balance cues, clear account detail and history, and a focused editor | Available-cash deductions, IPO blocks, wallet activity, deletion, and export |
| [Income & Plan](../../../local/mockups/financeview-income-plan-e2e.html) | Clear switch between actual receipts and plans, period controls, and a compact totals breakdown | Salary or EMI-derived forecasts, automatic top-ups, and new allocation groups |
| [Centered Add](../../../local/mockups/financeview-quick-add.js) and [More](../../../local/mockups/financeview-more-e2e.html) | Centered Add opens a chooser without changing tabs. More lists destinations, and Settings owns configuration. | Future-module actions, editable pins, module setup, and demo import/export |

Use the mockups for layout and interaction, not business logic or HTML to port. A color-only reskin
would leave the profile-first screen and long entry paths in place. Copying the prototype would
introduce unsupported data and controls. Reuse Expo Router, React Native, Lucide, and the existing
query and form components to change the experience without replacing the implementation underneath.
Only the synthetic developer handoffs were inspected. Do not copy mockup fixtures, screenshots,
private records, or prototype storage logic into the app.

## Target experience

**Primary navigation: Home · Accounts · ＋ Add · Plan · More.** Accounts and Plan fill the
mockup's two module positions with features that work today. Plan opens the current Monthly Plan
and offers **Monthly Plan / Income History** in the same section. Add is a button, not a tab.
Keep the bottom bar on primary screens; hide it for focused detail and edit screens. Preserve
existing deep-link paths (`/`, `/accounts`, `/accounts/[accountId]`, `/income`, `/monthly-plan`,
`/change-password`), selection and scroll state when dismissing Add, and sensible Back behavior
from both in-app navigation and direct links. Keep routing inside the current verified-user guard.

* Home opens on the **Cash total** or **Known cash subtotal**, with the as-of date, reporting
  scope, and a visible completeness warning when needed. Move the profile and settings off Home.
  Keep the starting action relevant: add an account when there are none; otherwise go to the
  appropriate account or balance picker. Use lightweight links to income and planning, not a second
  set of financial totals.
* Accounts separates active and archived accounts. Show currency, kind, and reporting inclusion.
  Show reported amount and observation date on a row only when already available; every account
  keeps its own history detail. Account and receipt corrections preserve their originals.
* Plan labels forecast and allocations as planned; Income History labels receipts as actual.
  Keep shortfalls visible and non-blocking. Do not show a missing plan as an empty saved plan.
* More links to working destinations only. Move the verified profile, INR and April-March reporting
  information, existing debt preference, change password, sign out, and sign out of all devices
  to grouped settings. Do not add a preference that the app cannot save.
* Add offers **Add account**, **Record balance**, and **Record income**. For a balance, choose an
  active account or offer account creation if none exist. Reuse the same editors and validations
  as the module screens. Close the chooser without writing anything. An editor returns to the
  originating screen on cancel or successful save; guard against accidentally discarding a draft.

The first pass uses the existing light theme and Welyt branding. Defer dark mode, amount masking,
customizable tabs, full net worth, unified History, new financial modules, and CSV/JSON portability.
No new endpoints, migrations, financial calculations, or native dependencies are planned.

## Implementation checklist

### Phase 1: Design foundation and baseline

<!-- parallelizable: false -->

* [ ] Capture the current verified UI with synthetic fixtures: Home with no accounts, complete
  cash and missing FX, Accounts detail, the income history, and a blank and shortfall plan. Use
  the same fixtures for before/after comparison.
* [ ] Extend the existing [theme tokens](../../../apps/mobile/src/theme/colors.ts) with reusable
  typography and spacing. Reuse or extract only the primitives needed by multiple screens:
  page header, summary card, list row, period switcher, buttons, input states, and inline feedback.
  Build on [FinanceScreen](../../../apps/mobile/src/components/FinanceScreen.tsx) and the existing
  auth controls rather than maintaining two visual systems.
* [ ] Pick one treatment for loading, empty, retryable error, stale cached data, validation,
  confirmation, and success. Keep long, signed amounts exact and legible with tabular digits;
  size controls for touch and allow labels and values to reflow at large text sizes.

### Phase 2: Home, navigation, and More

<!-- parallelizable: false -->

* [ ] Add an Expo Router tab shell for the four destinations under the verified stack. Use a
  custom center slot for Add once Phase 5 wires it. Keep the existing public paths, route
  guards, and session hydration. Initially point the tabs at the working module screens.
* [ ] Promote [CashSummary](../../../apps/mobile/src/features/accounts/CashSummary.tsx) to
  the primary card. Reuse its report-date valuation, existing refresh and retry behavior,
  known subtotal, affected-account reasons, and dated FX breakdown. Do not label snapshots
  as live bank balances or infer a zero when a value is missing.
* [ ] Move profile and settings actions out of Home into More and its Settings screen.
  Keep password and session behavior unchanged. Review this first visual slice in Expo web
  and on the Pixel before applying the pattern throughout the app.

### Phase 3: Refresh Accounts & Cash

<!-- parallelizable: true -->

* [ ] After Phase 2, style the [directory](<../../../apps/mobile/src/app/(app)/accounts/index.tsx>)
  with name search, account-kind filtering, and an accessible archived section. Filters affect
  the directory only, not INR totals. Join eligible rows to the
  [existing cached valuation](../../../apps/mobile/src/features/accounts/accounts-api.ts) by ID.
  Excluded and archived accounts are absent from the valuation response: keep their balance in
  account detail rather than showing zero, claiming no observation, or fetching every history.
* [ ] Rework the [account detail](<../../../apps/mobile/src/app/(app)/accounts/[accountId].tsx>)
  around the latest native balance and its observation date, then current and superseded history.
  Keep archived history read-only. Move edit and archive to secondary actions and keep an explicit
  archive confirmation.
* [ ] Make account creation and balance entry/correction focused, keyboard-aware screens with
  visible Save and Cancel. Reuse [AccountForm](../../../apps/mobile/src/features/accounts/AccountForm.tsx)
  and [SnapshotForm](../../../apps/mobile/src/features/accounts/SnapshotForm.tsx) as the shared
  entry points for module actions and Add.

### Phase 4: Refresh Income & Plan

<!-- parallelizable: true -->

* [ ] After Phase 2, give [Income History](<../../../apps/mobile/src/app/(app)/income.tsx>) and
  [Monthly Plan](<../../../apps/mobile/src/app/(app)/monthly-plan.tsx>) a shared header and
  section switch. Keep April-March history and month navigation distinct. Retain the selected
  period when returning from an editor or switching sections.
* [ ] Give receipts a dated, grouped layout with original currency and INR valuation; reveal
  gross, TDS, notes, and FX provenance as supporting detail. Keep a known subtotal and its
  missing/stale explanation visible. Reuse [IncomeReceiptForm](../../../apps/mobile/src/features/income/IncomeReceiptForm.tsx)
  for module and Add entry.
* [ ] Elevate forecast, allocated amount, and remaining amount or shortfall. Group existing
  fixed, flexible, and saving allocations. Keep revision history, Copy Previous Month, the
  saved auto-copy state, and the draft on revision conflict. Preserve all existing save rules
  in [MonthlyPlanEditor](../../../apps/mobile/src/features/income/MonthlyPlanEditor.tsx).

### Phase 5: Connect Add and polish workflow feedback

<!-- parallelizable: false -->

* [ ] After Phases 3 and 4, wire the centered button to an accessible, dismissible chooser using
  the existing stack and editors. Keep only the three supported actions. Handle an empty or
  failed account list explicitly and never offer archived accounts for recording.
* [ ] Keep the existing [swipeable success snackbar](../../../apps/mobile/src/components/SuccessSnackbar.tsx)
  above the bottom bar or editor actions with the right safe-area offset. Preserve both swipe
  directions, the four-second fallback, the user boundary, and announcements. Keep financial
  warnings and form errors inline, with explicit confirmation for discard and archive.
* [ ] Align the [auth shell](../../../apps/mobile/src/components/auth/AuthScreenShell.tsx) and
  change-password styling with the same controls and spacing. Keep sign-in, email verification,
  password recovery, and their routes unchanged.

### Phase 6: Regression and visual sign-off

<!-- parallelizable: false -->

* [ ] Run `pnpm run check` and `pnpm test`. Update the existing
  [Android regression](../../../apps/mobile/e2e/accounts.android.test.mjs) for the new navigation
  without dropping coverage of cold-start session recovery, signed balances and corrections,
  cash and FX, receipt history, and monthly-plan copy and shortfall. Run `pnpm run mobile:test:android`
  on the attached Pixel with the disposable fixture, not the user's account.
* [ ] On Expo web, review 320 px, 390 px, and desktop widths with synthetic fixtures. On Android
  and an iOS simulator or device, verify safe areas, keyboard and Back behavior, modal dismissal,
  the form footer and snackbar, and system text scaling. Before calling the refresh release-ready,
  run the iOS smoke test; a JavaScript bundle export alone is not runtime verification.
* [ ] Test keyboard focus and screen-reader labels, selected tabs, error messages, and the Add
  dialog's focus return. Target at least 44-point touch controls (48 dp on Android), 4.5:1 contrast
  for normal text, and no clipped amounts or unreachable actions at large text sizes. Compare
  before/after screens using the same data and ask for visual sign-off before feature work resumes.

## Acceptance criteria

* Cash is the first financial information on Home. Missing data, stale FX, genuine zero, and
  partial results are visibly different. The same fixture amounts and dates match the current app.
* Every navigation item and Add action lands in a working, verified screen. Closing the chooser
  preserves context; cancelling a dirty editor does not silently lose input. Refresh, direct links,
  Back, and sign-out still work without duplicate writes or leaked state.
* Accounts, income, and plans remain independent. Archive/correction history stays readable;
  recording income or saving a plan does not change cash. Planning shortfalls stay visible after
  the success snackbar clears.
* The redesigned flows work on Android, iOS, and web without new API contracts or a database
  migration. Unsupported mockup features do not appear as placeholders.

## Handoff

Follow the [repository guidance](../../../.github/copilot-instructions.md) and
[financial model](../../../model.md). The Accounts & Cash and Income & Plan implementation plans
remain complete; this is a separate presentation milestone. Task Research and Task Plan informed
this proposal. Use Task Implementation only after the direction is approved. Start with the shared
foundation and Home before moving to the module screens; use the existing Metro development client
for ordinary UI changes.
