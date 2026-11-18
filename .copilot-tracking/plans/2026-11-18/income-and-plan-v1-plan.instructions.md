<!-- markdownlint-disable-file -->
---
description: 'Implementation plan for historical FX backfill, actual income receipts, and later monthly planning.'
applyTo: '.copilot-tracking/plans/2026-11-18/income-and-plan-v1-plan.instructions.md'
---

# Income & Plan implementation plan

## User requests

- Plan Income & Plan before implementation. Source: the workspace discussion selecting
  the first suggested next step.
- Fetch historical daily FX from the provider API and save it. Report income in INR
  using rates for the date the income was received. Source: the income reporting
  choices confirmed during planning.
- Start the historical FX backfill on April 1, 2020, or use the first available date
  for any currency without a rate on that date. Source: the implementation request.
- Keep monthly plans in INR and allow saving a shortfall after showing a warning.
  Start months blank, offer manual copying, and let users opt in to saving a copy at
  the start of the next month. Source: the monthly planning decisions confirmed in chat.

## Scope and dependencies

Release actual receipts and financial-year history after adding a historical FX importer.
Monthly forecasting and allocations follow as a separate milestone. Recording income
must work without an account and must not adjust snapshot-only balances or the Home
cash total.

Follow the [Income & Plan model](../../../model.md#income--plan),
[repository guidance](../../../.github/copilot-instructions.md), and Task Plan workflow.
Reuse the [currency catalog and FX tables](../../../apps/api/src/db/schema.ts),
[India date and exact decimal helpers](../../../apps/api/src/lib/financial-values.ts),
and [verified-user route pattern](../../../apps/api/src/modules/accounts/accounts.routes.ts).

[Frankfurter v2](https://frankfurter.dev/#time-series) supports bounded `from` and `to`
queries and CSV output. A read-only sample for April 1 through April 3, 2020 returned 27
dated quotes across USD, EUR, GBP, AED, CAD, AUD, SGD, JPY, and CHF.

## Implementation checklist

### Phase 1: Backfill stored daily FX

<!-- parallelizable: false -->

- [x] Extend the [Frankfurter adapter](../../../apps/api/src/modules/fx/frankfurter.provider.ts)
  to request `/v2/rates.csv` with `base=INR`, the supported foreign currencies in `quotes`,
  and inclusive `from` and `to` dates. Request bounded chunks of up to 31 calendar days.
  Reuse strict CSV validation and exact reciprocal calculation: store INR per one unit
  of foreign currency at the existing eight-decimal scale.
- [x] Add an operator-run API workspace command with explicit date bounds and an optional
  dry run. Reject invalid or future India-local dates before contacting the provider.
  Do not run backfill at startup, from an income read, or as a public write endpoint.
- [x] Validate each full chunk before writing. Reject unknown pairs, dates outside the
  request, invalid rates, and duplicate pair/date rows. Store each actual provider date
  and the fetch timestamp in the existing `fx_rates` table. Do not generate rows for
  dates Frankfurter did not return.
- [x] Insert missing shared Frankfurter rows by currency pair and `rateOn` in a transaction.
  Skip any already-current row for that source and date, even if the historical quote
  differs; leave manual overrides and the daily refresh job unchanged. An interrupted
  import retains completed chunks. Report the failed date range and counts by currency
  so the operator can retry without duplicating rates.
- [x] Test malformed and interrupted batches, reruns, existing daily rows, and user-owned
  overrides against disposable SQLite. Test a bounded live import into a disposable
  database. Once verified, run the approved range into the configured API database and
  report actual coverage and gaps.

Phase 1 added `pnpm run api:fx:backfill`. The local import saved 21,798 rates across all
nine currencies from April 1, 2020 through November 17, 2026, the last completed day
in `Asia/Kolkata`. Every pair had a rate for every day in that range, so no lead-in was
needed. The nine existing November 18 rates remained present. All 42 API tests, API
type-check, lint, and build passed. A bounded live import and its read-only preview
were also verified in disposable SQLite.

### Phase 2: Store and expose actual receipts

<!-- parallelizable: false -->

- [x] Add one additive Drizzle migration for `income_receipts` and the shared Zod contracts.
  Store a generated ID, owner, India-local `receivedDate`, type, source text, currency,
  actual amount received, optional gross, optional TDS, notes, and UTC creation time.
  Reuse `users` and `currencies` foreign keys. Do not add an account or movement link.
- [x] Store money as integer hundredths; accept and return decimal strings. The received
  amount must be positive, dates cannot be future India dates, and inputs must honor the
  currency's minor units. Gross and TDS describe the same receipt and remain optional;
  TDS cannot be negative.
  When gross is provided, it cannot be below the net receipt; when both are provided, TDS
  cannot exceed the difference. Other deductions may exist, so do not infer missing amounts.
- [x] Allow distinct receipts on the same date, even with identical amounts. Correct a
  current receipt by retiring it and inserting a linked replacement atomically. Enforce
  same-user replacement references and one successor per version. Archive mistaken
  receipts without deleting history. Only current, non-archived rows count in totals.
  Index owner and received date for fiscal history.
- [x] Register verified-user list, create, correct, and archive routes under `/income`.
  Take the owner from the token, not request data. Return not-found for other owners'
  records and conflict for corrections against a superseded or archived receipt.
  Preserve existing auth and Accounts data during migration.

Phase 2 added [0003_income_receipts.sql](../../../apps/api/drizzle/0003_income_receipts.sql)
and the verified-user receipt API. The list excludes archived and superseded receipts unless
`includeInactive=true`. All 47 API tests passed, including upgrade preservation, ownership,
amount validation, correction history, and unchanged snapshots. Type-check, lint, API
build, and Drizzle validation passed. The local database was not migrated.

### Phase 3: Deliver INR income history

<!-- parallelizable: false -->

- [x] Default to the current Indian financial year; use April 1 inclusive through the next
  April 1 exclusive, and group history by calendar month. Show original currency and
  amount alongside the INR valuation. A correction that changes the receipt date moves
  the amount to the new month and financial year without counting the original.
- [x] Use the [stored FX lookup](../../../apps/api/src/modules/fx/fx.service.ts) as of each
  receipt date, not the current date or the reporting period end. Apply the existing
  precedence rules: latest eligible rate, own manual override on a same-date tie, and at
  most seven calendar days of carry-forward. INR needs no FX lookup. Never fetch rates
  while reading receipts.
- [x] Round each converted receipt to INR paise before summing with exact arithmetic, as in
  Accounts valuation. Return the rate date, source, and age when applicable. When any
  required rate is missing or stale, expose the affected receipts and the known INR
  subtotal, not a complete total. Preserve the native receipt even outside FX coverage.
- [x] Add a protected Income & Plan screen with receipt entry, correction, and financial-year
  history. Show gross and TDS as optional details, not as the amount received. Keep Home
  cash and Accounts balances unchanged after recording or correcting income.
- [x] Cover year boundaries, owner isolation, exact amounts, duplicate-looking receipts,
  correction history, FX completeness, and unchanged snapshots with Fastify integration
  tests. Run workspace type-check and a mobile smoke test using the existing dev client.

Phase 3 added `GET /income/history` and the protected Income & Plan screen. All 49 API
tests passed, along with type-check, lint, formatting, and the API build. Four Android
scenarios passed on the attached Pixel, including receipt entry, correction, financial-year
navigation, and unchanged cash. No new migration was needed.

## Success criteria

- A repeat backfill inserts no duplicate rows and does not change existing quotes.
- USD 2.00 with a receipt-date rate of INR 81.25 values to INR 162.50 even if today's
  quote differs. Combining it with INR 100.00 yields INR 262.50. An additional receipt
  without a usable rate leaves INR 262.50 as a subtotal and identifies the missing item.
- Multiple receipts on one day remain distinct. Corrections and archives retain history
  without double-counting, and none of these writes changes account snapshots.

## Monthly planning release plan

### Behavior

- Each calendar month starts blank unless the user saves a plan or opts into automatic
  copying. The plan holds one manually entered forecast for expected net income, plus
  named fixed, flexible, and saving allocations. Fixed lines can represent recurring
  costs such as rent or an EMI without creating a live loan link.
- Plan amounts use INR. Receipts continue to support the existing currency catalog.
  Neither a receipt nor an FX-rate change recalculates a plan.
- Show the forecast, group totals, total allocated, and the difference between the
  forecast and total allocated. A negative difference is a shortfall, not invalid input.
  Warn and allow the user to save. Keep all saved revisions immutable.
- **Copy Previous Month** prefills a blank month's unsaved editor from the immediately
  previous month's latest saved revision. The user can change or discard the copy. If
  the editor already has changes, confirm before replacing them. Do not copy if the
  previous month has no saved plan.
- The opt-in rule saves a copy at the start of the new month in `Asia/Kolkata`, only if
  the target has no saved plan. A copy includes the forecast and allocation amounts,
  not receipts, unspent money, or balances. It never keeps the copied values linked to
  the source month.

### Phase 4: Store and expose manual monthly plans

<!-- parallelizable: false -->

- [x] Add an additive Drizzle migration for `monthly_plans` and `plan_allocations`.
  Store an immutable plan version with a generated ID, owner, `YYYY-MM` month, INR
  currency code, revision number, forecast income, UTC creation time, creation method,
  and optional source version for copies. Enforce unique `(user_id, month, revision)`
  and same-owner source references. The highest revision is the current plan; an
  unsaved editor does not create a database draft.
- [x] Store allocations with a plan version foreign key, nonblank name, group, amount,
  and order within that version. Reuse the [exact amount helpers](../../../apps/api/src/lib/financial-values.ts)
  and the shared India date helpers. Store integer hundredths and exchange decimal
  strings at the API boundary. Allow zero forecast income and require positive amounts
  for allocation lines. Compute totals and differences with exact integer arithmetic
  rather than storing separate derived totals.
- [x] Expose owner-scoped `GET /income/plans/:month` and `PUT /income/plans/:month` through
  the verified-user API. A read returns the current version or no plan; an explicit
  revision query can retrieve an earlier version. A save supplies the expected current
  revision (`0` for an unsaved month). A stale save returns `409` and never overwrites
  another save. Save the plan and all its allocation lines in one transaction.
- [x] Implement manual copy by reading the previous month's saved plan and prefilling the
  editor. When a copy is saved, validate the same-owner source version and expected
  previous month. Record the source for that revision and never rewrite the source.
- [x] Test ownership, exact amounts, revision conflicts, copy provenance, and explicit
  saving of a shortfall. Verify existing receipt, account, and FX data are preserved
  after migrating a disposable database.

### Phase 5: Add month-start auto-copy

<!-- parallelizable: false -->

- [x] Add one persisted auto-copy rule per owner, disabled when absent. Set its earliest
  target to the calendar month after enablement in `Asia/Kolkata`. Expose the rule
  through verified-user `GET` and `PUT /income/plan-rules/auto-copy` operations. Disabling
  a rule stops future copies; it does not delete plans already created.
- [x] Use the shared [API job lifecycle](../../../apps/api/src/lib/daily-job.ts):
  check at India-local midnight and on startup after migrations. Target only the
  current eligible month. If the API was offline at month start, catch up during that
  month; do not generate years or months that have already ended. Do not start the
  timer in tests. Exercise the job with a controllable clock.
- [x] Use the latest saved revision of the immediately previous month that existed
  before the target month began. If none existed, leave the target blank. Recheck that
  the rule is enabled and no target plan exists inside the write transaction. Create
  revision `1` and copy its allocations atomically, recording the source and marking
  the version as an automatic copy. A retry or competing manual save must not overwrite
  a saved plan or create an extra version.
- [x] Test India-time boundaries, December-to-January and March-to-April transitions,
  missing source plans, offline startup catch-up, and repeated or competing runs.
  Check that enabling mid-month does not fill the current month or rewrite past data.

### Phase 6: Add the monthly plan view

<!-- parallelizable: false -->

- [x] Add a **Monthly Plan** view beside **Income History** in the existing protected
  Income & Plan module. Select the current India-local month by default. Allow viewing
  other months, creating a blank plan, and saving edits as new revisions. Show whether
  the current version was copied and provide access to saved revisions.
- [x] Provide the manual copy shortcut and one auto-copy toggle with the first eligible
  month. Make shortfalls visible without disabling Save. Preserve unsaved input if a
  save conflicts with an automatic copy or another device's changes.
- [x] Extend the API and USB Android regression suites with a blank month, a manual copy,
  a saved shortfall, and unchanged receipts and account snapshots. Test scheduled
  behavior with the API's controllable clock rather than changing the phone's clock.

Phases 4 to 6 added [0004_monthly_planning.sql](../../../apps/api/drizzle/0004_monthly_planning.sql),
the verified-user planner API, and the protected Monthly Plan view. All 54 API tests and
five Android scenarios passed. Expo web verified the shortfall warning, revision history,
copy cancellation, and the rule toggle. Type-check, lint, and the API build passed.
Migration tests used disposable databases; the local database was not changed.

### Acceptance and deferred work

- INR 100,000.00 of forecast income and INR 110,000.00 in allocations save as a plan
  with an INR 10,000.00 shortfall. No receipt, account balance, or goal progress changes.
- Without an enabled rule, December stays blank until the user saves it. With an enabled
  rule, a saved November plan can seed December once at month start, unless December
  already has a plan. Later changes to November do not change December's copy.
- Effective-dated salary and EMI assumptions, individual recurring allocation rules,
  loan and goal links, categorized spending, budget-versus-actual reporting, and
  restore remain out of scope.
