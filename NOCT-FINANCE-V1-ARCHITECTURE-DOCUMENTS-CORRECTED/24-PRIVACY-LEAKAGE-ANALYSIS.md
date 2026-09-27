# 24. Privacy Leakage Analysis

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Leakage channels

### Public chain
- sender;
- event timing;
- settlement recipient;
- settlement amount;
- proof metadata.

### Vela
- plaintext events;
- errors;
- debug output.

### Backend
- prover logs;
- facilitator logs;
- metrics;
- crash reports.

### Client
- analytics;
- console logs;
- local storage;
- telemetry.

## Controls

Each control names its enforcement point. A control with no enforcement point is aspirational.

| Control | Enforcement point |
|---|---|
| Encrypted user payloads | Vela confidential request path (File 16, File 21) |
| Encrypted user events | Vela event encryption; no plaintext financial event may be emitted |
| Opaque IDs | `operationID`, `receiptID`, `settlementID`, `withdrawalID` are commitments or hashes, never position data (`09:169-177`) |
| Minimal proof public inputs | At most 32 flattened inputs (`09:145`); all variable detail opened privately |
| Secret redaction | No key, plaintext balance or position in any log, error or metric |
| No financial analytics | No aggregate position, utilization-per-user or health-factor telemetry leaves the enclave |
| Short-lived sensitive buffers | Zeroize plaintext position buffers after use |

## Prohibited disclosures (normative)

No request type, event, error message, log line, metric or API response may disclose any of the
following, in plaintext or in a form from which it can be reconstructed:

1. any account's `cash`, `collateral`, `borrowed` or `scaledDebt` for any asset;
2. any account's health factor, borrow capacity, LTV or threshold weighting;
3. the set of accounts, or the number of accounts, holding a position;
4. any reserve's per-account composition;
5. the identity linking an `operationID` to an account, outside the enclave.

**This is the defect behind `DEMO-03`.** The demo exposed a `QueryPortfolio` request type that
returned the full private ledger to any caller. A read path is not exempt from the privacy model
merely because it does not mutate state: an unauthenticated read of private state is a total
confidentiality failure, equivalent in severity to theft of the data it exposes. Any V1 query
interface MUST authenticate the requesting account and MUST return only that account's own data,
computed inside the enclave.

`TRUSTPROCESS` and trigger `AppEvent` payloads are public and MUST carry only opaque operation
identifiers and payload kinds (`18:129`, `18:131`, `18:187`).

## What is unavoidably public

V1 does **not** claim full transaction privacy. The following are public by construction and the
implementation MUST state this accurately rather than imply otherwise:

- the sender of every on-chain transaction;
- the recipient address of every withdrawal;
- the **native token amount** of every withdrawal and deposit;
- event timing and ordering;
- proof metadata: `circuitID`, `vkHash`, `configCommitment`, `oracleCommitment`, `oldAppRoot`,
  `newAppRoot`, `transitionID` (`09:148-164`);
- all oracle data: feed IDs, prices, confidence, publish times, epochs (`18:187`).

Consequence: an observer who sees a withdrawal of a specific amount to a specific address learns that
some account held at least that amount. Correlating a deposit with a later withdrawal of equal amount
can link two addresses. **These are accepted V1 limitations, not defects**, and MUST be disclosed to
users. Stronger settlement privacy is a future extension (File 33).

`appRoot` changes on every committed transition, so an observer can count transitions but cannot
attribute them to accounts or determine their kind from the root alone.

## Timing

Perfect timing privacy is not guaranteed. Transition execution time depends on the number of reserves
accrued, the number of accrual chunks (bounded by `maxAccrualChunksPerTransition = 4096`, File 19) and
the size of the affected leaf sets. An observer measuring latency can therefore distinguish a
no-op from a multi-reserve liquidation.

Required analysis:

- measure per-transition-type execution time in the pinned TinyGo/WASM build (File 28);
- confirm no transition's runtime is proportional to the **number of accounts**, which would leak
  portfolio size and also break the performance model (File 27);
- avoid any public signal that distinguishes transition kinds unnecessarily.

## External settlement

Normal public token settlement reveals recipient and amount. Noct MUST NOT claim these are hidden.
The confidential part of V1 is the **position state inside the TEE** — balances, debt, collateral and
health factors (`32:36`) — not the existence or size of an individual on-chain transfer.

