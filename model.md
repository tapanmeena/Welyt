User

- id
- name
- email
- passwordHash
- debtMode <!-- remaining_emis or outstanding_principal -->
- emailVerifiedAt
- created_at
- updated_at

AuthSession

- id
- userId
- familyId
- refreshTokenHash
- deviceName
- ipAddress
- userAgent
- expiresAt
- revokedAt
- lastUsedAt
- created_at

AuthChallenge

- id
- userId
- purpose <!-- email_verification or password_reset -->
- codeHash
- attempts
- expiresAt
- consumedAt
- created_at

Account

- id
- userid
- name
- kind
- purpose
- target
- heldForOthers
- inNetWorth
- defaultFor
- balance
- notes
- created_at
- updated_at

AccountBalanceHistory

- id
- accountId
- change
- created_at
- updated_at

WalletActivity

- id
- accountId
- type
- amount
- notes
- created_at
- updated_at

Income

- id
- userId
- date
- type
- source
- amount
- gross
- tds
- notes
- created_at
- updated_at

Budget

- id
- userId
- name
- group
- amount
- frequency
- dueMonth
- notes
- created_at
- updated_at

Lending

- id
- userId
- date
- type <!-- lent or borrowed -->
- counterparty
- amount
- interest
- dueDate
- notes
- created_at
- updated_at

Insurance

- id
- userId
- type
- provider
- name
- policyNumber
- cover
- premium
- premiumStartDate
- premiumEndDate
- policyStartDate
- policyEndDate
- nominee
- notes
- documentLink
- created_at
- updated_at

Instrument

- id
- name
- assetType
- exchange
- symbol
- notes
- created_at
- updated_at

Quote

- id
- instrumentId
- date
- open
- high
- low
- close
- volume
- created_at
- updated_at

Trade

- id
- userId
- date
- instrumentId
- side <!-- buy or sell -->
- quantity
- price
- broker <!-- Groww, Zerodha, etc. -->
- fees <!-- any additional fees -->
- orderId
- inrPrice
- sequence
- notes
- created_at
- updated_at

Currency

- id
- code
- name
- symbol
- created_at
- updated_at

CurrencyExchange

- id
- fromCurrencyId
- toCurrencyId
- rate
- date
- created_at
- updated_at

Loan

- id
- userId
- name
- lender
- type <!-- personal, home, auto, etc. -->
- takenOn
- amount
- rate
- emi
- months
- firstEmiDate
- notes
- created_at
- updated_at

LoanEvent

- id
- loanId
- date
- type <!-- payment, prepayment, default, etc. -->
- amount
- notes
- created_at
- updated_at
