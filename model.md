---
title: Welyt modular financial model
description: Agreed module behavior, proposed entities, financial invariants, and open design decisions.
---

## Status and scope

Welyt provides independent financial modules with explicit, optional connections. Users enable
the modules they need; Accounts is not a prerequisite for Investments, Loans, or IPO Tracker.
A universal accounting ledger is not required.

The authentication entities below reflect the existing implementation unless marked proposed.
Accounts & Cash v1 has four database tables: `currencies`, `accounts`, `account_observations`,
and `fx_rates`. Only INR is seeded. The backend supports owner-scoped account and snapshot
operations, daily FX ingestion and lookup tested with fixtures, and INR account valuation.
No live FX provider, scheduler, or financial API routes are wired. Other financial entities
and additional user preferences are not implemented. Entity fields below describe logical
records, not SQL column definitions.

The first financial milestone (v1) is Accounts & Cash. Income & Plan, Investments, Loans &
Lending, IPO Tracker, and Goals are planned for later milestones. Insurance remains deferred.

Financial records are personal initially. IPO Tracker additionally supports family applicant
profiles managed by the user, without family logins or shared-workspace access. Managing a
record does not imply owning the underlying money or securities.

### First milestone decisions

- Accounts use one current balance snapshot per account per local date (`Asia/Kolkata`).
  Movement tracking, transfers, and reconciliation are deferred.
- The default reporting currency is INR. Non-INR accounts keep balances in their original
  currency and use separately stored daily FX rates for INR reporting.
- Fiscal periods use India's financial year, from April 1 through March 31 of the following
  calendar year. Other fiscal calendars can be added later.
- Store monetary amounts exactly to two decimal places. FX rates use separate precision.
- Manual cash restrictions, funds held for others, and account defaults are outside the
  first milestone.
- Do not offer restore in v1. JSON and CSV exports remain planned.

## Module boundaries

| Availability | Module            | Owns                                                                     |
| ------------ | ----------------- | ------------------------------------------------------------------------ |
| Always       | Home              | Derived overview, inclusion explanations, and data-completeness warnings |
| Always       | Settings          | Profile, reporting currency, debt mode, and preferences                  |
| Always       | Module management | Module enablement; disabling retains records but excludes them from Home |
| Always       | History           | Financial activity projection and a separate changes/audit view          |
| Always       | Data portability  | Versioned JSON and CSV exports; restore deferred                         |
| Optional     | Accounts & Cash   | Accounts, observations, movements, restrictions, and reconciliation      |
| Optional     | Income & Plan     | Actual income, monthly forecasts, allocations, and saving contributions  |
| Optional     | Investments       | Portfolios, acquisitions, trades, valuation, and analytical gains        |
| Optional     | Loans & Lending   | Loan schedules, actual repayments, lender observations, personal lending |
| Optional     | IPO Tracker       | IPO references, applicants, applications, blocks, and allotments         |
| Optional     | Goals             | Targets, manual progress, and explicit allocations of existing assets    |
| Deferred     | Insurance         | Policies, coverage, premiums, nominees, and document references          |

Each module owns its financial facts. Optional links connect facts without duplicating them.
For example, Investments owns a trade, while Accounts owns its linked cash movement.
Home and History read these records rather than becoming additional financial sources.

## Shared modeling rules

### Record conventions and ownership

- Every persisted entity has a stable `id` and `createdAt`; mutable records also have `updatedAt`.
- User-managed records have `userId`, directly or through an enforced parent relationship.
- All financial links must belong to the same managing user. Actual asset ownership is separate.
- Field names use camelCase in application contracts; database names follow existing snake_case.
- Instants use UTC timestamps; financial dates use date-only values with an explicit business-date policy.
- Dates such as `effectiveDate`, `observedAt`, and `tradeDate` are distinct from record creation time.
- Final schemas must specify required/nullable fields, enums, foreign keys, checks, and deletion rules.
- Posted records and referenced parents cannot be hard-deleted as an ordinary edit.

### Money, quantities, and currency

- Every amount has an explicit currency, directly or unambiguously through its parent.
- Use exact decimal arithmetic. Do not store financial values as SQLite floating-point numbers.
- V1 stores balance snapshots as signed integer hundredths and daily FX rates as positive
  integers scaled to eight fractional digits. Use decimal strings at the application boundary.
- Future investment quantities, prices, and other FX uses need their own precision and rounding
  rules.
- Transaction FX preserves original amounts, currency pair, rate, effective time, and source.
- Reporting conversions use dated rates and expose missing or stale data; never assume a rate of 1.
- Changing reporting currency changes presentation, not historical amounts or applied transaction FX.
- Distinguish fiat currencies from crypto assets; crypto precision must not assume fiat minor units.

### Optional links and corrections

- Users explicitly choose whether domain activity affects an account. Unlinked records stay valid.
- Where cash linkage exists, use a nullable, unique `accountMovementId` on the domain event.
  Multi-leg events use explicit child settlement records rather than an unvalidated type/id pair.
- One movement cannot settle unrelated domain events. Linking an existing movement must not create
  another debit or credit. Retries require scoped idempotency keys.
- Create or correct linked records atomically. Show affected records before committing a correction.
- Drafts can be edited. Posted linked financial amounts use reversal/replacement records, retaining
  original history. Descriptive notes can remain editable with an audit trail.
- Reversals carry `reversalOfId`; replacements preserve their relationship to the corrected record.
- Disabled modules retain data and historical links. Do not mutate a disabled module silently;
  require re-enablement before operations that would change its records.

## Authentication and preferences

### User

- Existing: `id`, `name`, `email`, `passwordHash`, `debtMode`, `emailVerifiedAt`,
  `createdAt`, `updatedAt`
- Proposed: `baseCurrencyId`, `status`

`debtMode` is `remaining_emis` or `outstanding_principal`. The selected mode drives the
overview debt calculation. Remaining-EMI results are labeled "Adjusted net worth" and disclose
included future interest; they are not presented as standard principal-based net worth.
The lifecycle meaning and allowed values of proposed `status` remain open.

### AuthSession

- `id`, `userId`, `familyId`, `refreshTokenHash`, `deviceName`, `ipAddress`, `userAgent`,
  `expiresAt`, `revokedAt`, `lastUsedAt`, `createdAt`

`familyId` identifies a refresh-token rotation family, not a financial household.

### AuthChallenge

- `id`, `userId`, `purpose`, `codeHash`, `attempts`, `expiresAt`, `consumedAt`, `createdAt`

`purpose` is `email_verification` or `password_reset`.

### UserModule

- `id`, `userId`, `moduleKey`, `enabled`, `updatedAt`
- Unique: `(userId, moduleKey)`

Disabling a module hides its workspace and excludes its contribution from Home without deleting
records. History and exports remain available. Home must identify excluded modules and warn when
the overview is incomplete. Re-enabling restores access and eligible overview contributions.

### Currency, FxRate, and AppliedFx

- `Currency`: `id`, `code`, `name`, `symbol`, `minorUnits`
- `FxRate`: `id`, `fromCurrencyId`, `toCurrencyId`, `rate`, `effectiveAt`, `source`,
  `fetchedAt`, optional `userId`, optional `supersedesId`
- `AppliedFx`: `id`, `fromCurrencyId`, `toCurrencyId`, `rate`, `effectiveAt`, `source`,
  optional `fxRateId`

`FxRate` supports provider observations and user-scoped manual overrides without overwriting
provider history. `AppliedFx` is an immutable snapshot referenced by financial settlements.
Rates must be positive; define direction consistently as target units per source unit.
V1 uses daily foreign-to-INR rates for reporting and does not create `AppliedFx` settlements.
Features that require market data use external price and FX feeds plus manual overrides.
V1 lookup selects the latest rate on or before the reporting date, with the user's override
winning on the same date. The backend uses a seven-day carry-forward window pending live
release confirmation. Provider selection, triangulation, and historical coverage remain open.

## Accounts & Cash

### Proposed entities

- `Account`: `id`, `userId`, `name`, `kind`, `currencyId`, `trackingMode`, `purpose`,
  `inNetWorth`, `status`, `notes`
- `AccountObservation`: `id`, `accountId`, `observedOn`, `balance`, `source`, `notes`
- `AccountMovement`: `id`, `accountId`, `effectiveDate`, `kind`, `signedAmount`, `status`,
  `description`, optional `reversalOfId`
- `AccountReconciliation`: `id`, `accountId`, `observationId`, `calculatedBalanceBefore`,
  `difference`, optional `adjustmentMovementId`, `status`
- `AccountTransfer`: `id`, `userId`, `fromMovementId`, `toMovementId`,
  optional `appliedFxId`
- `HeldForOther`: `id`, `accountId`, `personName`, `amount`, `effectiveDate`,
  optional `releasedAt`, `notes`
- `CashRestriction`: `id`, `accountId`, `amount`, `effectiveAt`, optional `releasedAt`,
  `reason`
- `AccountDefault`: `id`, `userId`, `purpose`, `accountId`

### Behavior and constraints

- Initial account kinds are bank, physical cash, e-wallet/prepaid, and brokerage cash.
- V1 supports only `snapshot_only`. Dated `AccountObservation` records supply balances without
  creating income, spending, or transfer records.
- Correcting an observation preserves the original and replaces the current balance atomically.
  Archiving an account makes it read-only and retains the owner's access to its history.
- Later `movement_tracking` accounts use an opening/reconciled balance plus subsequent posted
  movements.
- Reconciliation shows the difference and requires an explicit correction or adjustment.
  Adjustments are not ordinary income or expenses.
- Backdated movements flag affected reconciliation checkpoints for review.
- Available cash equals the applicable balance minus active blocks and money held for others.
  Show goal earmarks separately as an unallocated-cash concept.
- Money held for others is excluded from personal net worth and must not also become a duplicate
  personal-lending liability. Link restrictions to their originating facts instead of copying them.
- An IPO block optionally references one `CashRestriction`; release/debit must release the
  corresponding restriction once.
- A transfer has paired movements; cross-currency transfers preserve both amounts and applied FX.
- Default purposes are unique per user. Do not store a multi-purpose list in one `defaultFor` field.
- Cached balances are derived projections, not independent editable financial facts.

The old `AccountBalanceHistory` becomes dated observations and reconciliation checkpoints.
The old `WalletActivity` becomes account movements. Goal targets move out of Account.
Movement balance baselines, reconciliation cutoffs, and tracking-mode transitions are deferred
with movement tracking.

## Income & Plan

### Proposed entities

- `Income`: `id`, `userId`, `receivedDate`, `type`, `source`, `currencyId`, `amount`,
  optional `gross`, optional `tds`, optional `accountMovementId`, `notes`
- `PlanInput`: `id`, `userId`, `kind`, `currencyId`, `amount`, `effectiveFrom`,
  optional `effectiveTo`, optional `loanId`, `notes`
- `MonthlyPlan`: `id`, `userId`, `month`, `currencyId`, `revision`, `status`
- `PlanAllocation`: `id`, `monthlyPlanId`, `name`, `group`, `amount`, `purpose`,
  optional `goalId`, optional `loanId`
- `PlanCommitment`: `id`, `userId`, `name`, `currencyId`, `amount`, `frequency`,
  `startsOn`, optional `endsOn`, optional `dueMonth`, optional `loanId`

### Behavior and constraints

- Income records are actual receipts. Forecast salary and planned allocations are not receipts.
- Plans use calendar months. There is no categorized expense tracking or budget-versus-actual
  reporting initially.
- There is no automatic rollover. Users can copy a prior month's plan.
- Effective-dated salary/EMI inputs produce a preview before future plans are revised.
  Preserve past plans and distinguish copied assumptions from live references.
- Loan-linked commitments reference the loan's projected EMI; standalone manual inputs also work.
- Saving allocations describe planned periodic contributions and optionally reference Goals.
  A planned allocation never increases goal progress or creates a cash movement.
- A linked income movement represents the cash received, not gross income before withholding.
- Non-monthly commitments can feed monthly plans without changing the plan's calendar-month basis.

`Budget` is refined into monthly plans, allocations, and recurring commitments rather than
combining recurring definitions with monthly actuals.

## Investments

### Proposed entities

- `Portfolio`: `id`, `userId`, `name`, `broker`, `notes`
- `Instrument`: `id`, `name`, `assetType`, optional `exchange`, optional `symbol`,
  optional `identifier`, `quoteCurrencyId`, `notes`
- `Quote`: `id`, `instrumentId`, `effectiveAt`, `price`, `currencyId`, `source`,
  `fetchedAt`, optional `userId`, optional `open`, optional `high`, optional `low`,
  optional `volume`, optional `supersedesId`
- `OpeningHolding`: `id`, `portfolioId`, `instrumentId`, `asOfDate`, `quantity`,
  optional `costBasis`, optional `costCurrencyId`, `historyCompleteness`
- `Trade`: `id`, `portfolioId`, `instrumentId`, `tradeDate`, optional `settlementDate`,
  `side`, `quantity`, `price`, `currencyId`, `fees`, `taxes`, optional `orderId`,
  `sequence`, optional `accountMovementId`, optional `appliedFxId`, `notes`
- `RetirementAccount`: `id`, `userId`, `name`, `schemeType`, `currencyId`, `notes`
- `RetirementEvent`: `id`, `retirementAccountId`, `effectiveDate`, `type`, `amount`,
  optional `accountMovementId`
- `RetirementObservation`: `id`, `retirementAccountId`, `observedAt`, `balance`, `source`
- `Deposit`: `id`, `userId`, `name`, `institution`, `kind`, `currencyId`, `openedOn`,
  optional `maturesOn`, `notes`
- `DepositEvent`: `id`, `depositId`, `effectiveDate`, `type`, `amount`,
  optional `accountMovementId`
- `DepositObservation`: `id`, `depositId`, `observedAt`, `value`, `source`

### Behavior and constraints

- Initial assets are listed stocks, ETFs, mutual funds, fixed/recurring deposits, retirement
  assets such as EPF/PPF/NPS, and crypto.
- Trades use buy/sell directions. Cash settlement must account for fees and taxes.
- Opening holdings accept an as-of date and optional cost basis. Unknown cost is not zero cost;
  suppress affected gain calculations and label incomplete history.
- Holdings are derived from opening positions and posted acquisitions/disposals, not separately
  editable quantities that can diverge from trades.
- Use FIFO for analytical realized gains. The FIFO matching scope remains to be finalized;
  do not claim tax-filing compliance.
- Support trade fees/taxes and retirement contributions/withdrawals initially.
- Show valuations and realized/unrealized gains only where sufficient data exists.
  XIRR and time-weighted returns are deferred.
- Dividends, reinvestment, corporate actions, and ordinary broker transfers are deferred.
  Disclose reporting limitations and do not claim complete total returns.
- Deposit and retirement balances can be observed independently of contribution history.
  Contributions are not market gains; do not infer returns from balance changes alone.
- Provider prices and manual overrides retain provenance. A quote timestamp is not its fetch time.
- Instrument identity and quote uniqueness must include the relevant market, denomination,
  provider, and time granularity rather than assuming a globally unique symbol.
- A brokerage cash balance belongs to Accounts if linked; Investments must not count it again.

Remove the INR-specific `inrPrice` field. Preserve original denomination and applied FX instead.
Deposit valuation/accrual rules, retirement scheme details, crypto pair identity, and precise
quantity/price limits remain open.

## Loans & Lending

### Proposed entities

- `Loan`: `id`, `userId`, `name`, `lender`, `type`, `currencyId`, `takenOn`,
  `originalPrincipal`, `initialAnnualRate`, `initialEmi`, `initialTermMonths`,
  `firstEmiDate`, `notes`
- `LoanEvent`: `id`, `loanId`, `effectiveDate`, `type`, optional `amount`,
  optional `principalComponent`, optional `interestComponent`, optional `feeComponent`,
  optional `newAnnualRate`, optional `newEmi`, optional `newTermMonths`,
  optional `recalculationMode`, optional `accountMovementId`, `notes`
- `LoanObservation`: `id`, `loanId`, `observedAt`, `outstandingPrincipal`, `source`
- `LoanReconciliation`: `id`, `loanId`, `observationId`, `calculatedPrincipalBefore`,
  `difference`, `resolution`, optional `adjustmentEventId`
- `LoanScheduleVersion`: `id`, `loanId`, `effectiveFrom`, `assumptions`, `supersedesId`
- `LoanInstallment`: `id`, `scheduleVersionId`, `dueDate`, `principal`, `interest`,
  `paymentAmount`, `projectedPrincipalAfter`
- `Lending`: `id`, `userId`, `openedOn`, `direction`, `counterparty`, `currencyId`,
  `principal`, optional `dueDate`, optional `accountMovementId`, `notes`
- `LendingRepayment`: `id`, `lendingId`, `effectiveDate`, `amount`,
  optional `accountMovementId`, optional `reversalOfId`, `notes`

### Behavior and constraints

- Formal loans initially support reducing-balance EMI structures, not flat-rate,
  interest-only, or revolving facilities.
- Calculated schedules are estimates. Dated lender observations require explicit reconciliation,
  not silent replacement of recorded payments.
- Rate changes and prepayments are effective-dated events. Preview EMI-versus-tenure adjustments
  and preserve previous assumptions and actual payments.
- Planned installments are not paid installments. Actual payments have explicit component
  allocation; amounts must reconcile before posting.
- Personal lending supports lent and borrowed directions, partial repayments, and optional
  due dates. Interest is deferred.
- Personal-lending receivables/liabilities use unpaid principal and are counted once.
- `debtMode` applies to eligible formal loans. Remaining-EMI calculations use the active future
  schedule and disclose their future-interest component. Never mix overlapping schedule versions.

Day-count rules, rate rounding, payment timing, missed-payment treatment, observation cutoffs,
and component allocation rules must be resolved before implementing the schedule engine.

## IPO Tracker

### Proposed entities

- `IpoOffering`: `id`, `name`, `market`, `issueType`, `currencyId`, `opensOn`, `closesOn`,
  optional `allotmentDate`, optional `listingDate`, `lotSize`, `priceMin`, `priceMax`,
  optional `instrumentId`, `source`
- `ApplicantProfile`: `id`, `userId`, `displayName`, `isSelf`, `notes`
- `IpoApplication`: `id`, `userId`, `ipoOfferingId`, `applicantProfileId`, `category`,
  `reference`, `appliedOn`, `lots`, `bidPrice`, `amount`, `status`, `notes`
- `IpoFundEvent`: `id`, `applicationId`, `effectiveDate`, `type`, `amount`,
  optional `cashRestrictionId`, optional `accountMovementId`
- `IpoAllotment`: `id`, `applicationId`, `allottedOn`, `quantity`, `price`,
  `currencyId`, `status`
- `IpoInvestmentLink`: `id`, `allotmentId`, `tradeId`, `quantity`,
  optional `ownershipTransferId`
- `OwnershipTransfer`: `id`, `userId`, `allotmentId`, `fromApplicantProfileId`,
  `toApplicantProfileId`, `effectiveDate`, `quantity`, optional `costBasis`,
  optional `costCurrencyId`, `notes`

### Behavior and constraints

- Initial coverage is Indian mainboard and SME IPOs. Applications are placed outside Welyt.
- Track multiple personal or family application records by applicant, category, reference,
  and status. Multiple lots within one application are not separate applications.
- An applicant identifies the actual applicant; a bank account identifies funding. They are
  not interchangeable, and tracking does not validate application eligibility.
- Family applicant profiles have no separate logins. Store only necessary identifiers.
- Blocks reduce available cash, not account balance or net worth. Releases and allotment debits
  are separate events; support partial releases/allotments without duplicate cash effects.
- With no Accounts link, fund events remain standalone IPO facts.
- Allotments remain usable without Investments. An explicit create-or-link action creates
  an investment acquisition once and never repeats an existing allotment debit.
- Family allotments stay outside personal holdings and personal totals until an explicit
  ownership-transfer record represents an actual transfer to the user.
- Transfers preserve original applicant provenance. A tracker record does not execute a
  broker/depository transfer or establish legal ownership.
- Partial transfers and investment links cannot exceed allotted quantity or reuse the same units.

Family-funded applications for the user's benefit, user-funded family applications, receivables,
and ownership-transfer cost basis need detailed rules before cross-module financial posting.
Blocked funds alone must not be added as another asset alongside the funding account.

## Goals

### Proposed entities

- `Goal`: `id`, `userId`, `name`, `targetAmount`, `currencyId`, optional `targetDate`,
  `progressMode`, `showOnOverview`, `status`, `notes`
- `GoalContribution`: `id`, `goalId`, `effectiveDate`, `signedAmount`, `notes`
- `GoalAccountAllocation`: `id`, `goalId`, `accountId`, `amount`
- `GoalHoldingAllocation`: `id`, `goalId`, `portfolioId`, `instrumentId`, `quantity`

### Behavior and constraints

- Each goal selects manual contributions or linked-asset progress, not both initially.
- Targets are manual amounts in a chosen currency with optional deadlines.
  Calculated emergency-fund and retirement targets are deferred.
- Manual progress records are not automatically cash movements or additional net-worth assets.
- Linked progress uses fixed cash amounts or investment units valued with dated prices/FX.
- An asset can support multiple goals, but total allocations cannot exceed allocatable cash/units
  when saved. Enforce caps atomically across goals.
- If withdrawals, restrictions, or disposals make allocations exceed backing assets, flag the
  shortfall; do not silently rewrite allocations. Price/FX changes can change progress.
- Earmarking is not spending and does not reduce bank-available cash.
- Saving plan allocations can reference a goal but do not count as actual contributions.
- Do not add goal progress to net worth; it already represents existing assets or manual tracking.

Retirement/deposit goal linking and the effect of disabled source modules on linked progress
remain open. Home must not silently reintroduce excluded-module values through a goal.

## Insurance

Insurance is deferred, not removed from the product grouping.

### Candidate entities

- `Insurance`: `id`, `userId`, `type`, `provider`, `name`, `policyNumber`, `currencyId`,
  `cover`, `premium`, `premiumStartDate`, `premiumEndDate`, `policyStartDate`,
  `policyEndDate`, `status`, `notes`
- `InsuranceNominee`: `id`, `insuranceId`, `name`, optional `share`
- `InsuranceDocument`: `id`, `insuranceId`, `name`, `documentReference`
- `InsurancePremiumPayment`: `id`, `insuranceId`, `paidOn`, `amount`,
  optional `accountMovementId`

Premium schedules and actual payments are separate. Coverage is not an asset balance.
Premium frequency, nominee requirements, document handling, and any surrender/cash-value
support require decisions when this module enters scope.

## Home, History, and portability

### Overview invariants

- Include eligible personal assets and liabilities from enabled modules only.
- Label the view as incomplete when modules are disabled or required prices/FX are missing.
  Do not present a partial valuation as a complete total.
- Distinguish unavailable data from zero balances.
- For Accounts & Cash, value the latest snapshot on or before the report date using FX
  for that report date. When a snapshot or usable rate is missing, show the known INR
  subtotal and identify the affected accounts without presenting a complete total.
- Respect per-account `inNetWorth` and per-goal `showOnOverview` settings.
- Count linked cash once. A trade, IPO application, or goal allocation is not another cash asset.
- Keep debt-basis labels and excluded-module explanations visible.

### Activity and audit

- Financial History is a projection of module-owned events with stable source links.
  Group connected activity so users can understand one event without mistaking it for duplicates.
- History remains accessible for disabled modules and provides module filters.
- `AuditEvent`: `id`, `userId`, `actorId`, `action`, `entityType`, `entityId`,
  `occurredAt`, `changeSummary`, optional `correlationId`
- Audit history records edits and reversals separately from financial activity.
  Its references are navigational, not substitutes for financial foreign keys.
- Do not copy passwords, tokens, challenge hashes, or unnecessary sensitive identifiers into audit data.

### Backup and export

- Versioned JSON exports preserve financial IDs, links, module preferences, original currencies,
  applied FX, ownership provenance, and relevant activity/audit history.
- Export scope includes disabled modules. Explain any missing external document content.
- Exclude password hashes, sessions, refresh tokens, and authentication challenges from portable
  financial backups.
- CSV exports are for inspection/analysis, not a lossless restore format. Guided CSV import is deferred.

Export protection and external document portability remain open.

### Deferred restore

V1 does not offer a restore option.

- Restore belongs to the authenticated user, not an imported login identity.
- Validate schema version, ownership, references, uniqueness, amounts, and supported capabilities
  before previewing conflicts. Do not silently drop unsupported records.
- Restore applies atomically after confirmation and preserves exportable provenance.

Restore merge-versus-replace semantics, conflict choices, and supported version migrations remain
open.

## Open design decisions

### Accounts & Cash v1

1. Select the launch currencies, licensed FX provider, and required historical coverage.
2. Confirm how long a prior rate may be carried forward before a conversion is unavailable.

The [Accounts & Cash v1 database plan](.copilot-tracking/plans/2026-11-18/accounts-cash-v1-plan.instructions.md)
proposes the storage encoding, correction rules, and FX selection policy.

### Later milestones

1. Select price/FX providers, licenses, asset coverage, manual-override precedence, and stale-data
   policy.
2. Define movement tracking baselines, reconciliation cutoffs, mode transitions, and how to
   enforce a single settlement claim across modules without relying on per-table uniqueness.
3. Define deposit valuation, retirement scheme behavior, instrument identity, and FIFO matching scope.
4. Define loan schedule conventions, actual payment allocation, and lender reconciliation.
5. Define family IPO funding obligations and ownership-transfer date/cost-basis treatment.
6. Define goal backing limits and linked progress when source modules are disabled.
7. Finalize the proposed user status when its lifecycle requirements are known.
8. Define export protection and, when restore is in scope, conflict resolution and version migrations.

Resolve each gap before implementing the affected behavior. Final field nullability, enums,
indexes, and database-enforced relationships are outputs of schema planning.
