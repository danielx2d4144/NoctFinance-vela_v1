# Noct Finance V1 — Implementation Guide

**Current as of:** 2026-09-19  
**Status:** Authoritative source-of-truth location for implementation

---

## Sole authoritative source

**All implementation MUST use:**

```
noctfinance-vela/NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/
```

This directory contains 34 corrected architecture files that supersede all earlier revisions, freeze reports, and audit snapshots. Where any other document conflicts with these files, the corrected documents control.

---

## Implementation-critical files

### Core state and accounting (Files 08–12, 19)

- **08-NOCTSTATE-V1.md** — canonical U256 types, WAD/RAY units, scaled debt, custody model, pending operations, receipts, and invariants
- **09-STATE-COMMITMENT-MODEL.md** — Vela encrypted-state root versus Noct plaintext `appRoot`, complete commitment trees, compact public inputs
- **10-PROTOCOL-CONFIGURATION.md** — frozen kink interest model, risk thresholds using `collateralFactorWad` (the LTV gate) for borrow/release and `liquidationThresholdWad` (the liquidation gate) only for liquidation, oracle/config commitments. The parameter is `collateralFactorWad`; there is no `maxLTV` field in the committed configuration.
- **11-ASSET-RESERVE-MODEL.md** — reserve state, scaled-debt accounting, Vela custody equations, no parallel vault/`ReserveManager`, Noct-funded USDC, ETH and ZEN
- **12-COMPLETE-STATE-MACHINE.md** — all transition preconditions, checked arithmetic, atomic effects, prepare/capture/commit repayment and liquidation, idempotent replay
- **19-INTEREST-ACCRUAL.md** — lazy per-transaction accrual, bounded chunked index calculation, RAY indexes, authenticated oracle timestamp as the sole interest clock

### Settlement and lifecycle (Files 17, 20–23, 27–28)

- **17-SETTLEMENT-ARCHITECTURE.md** — native `ProcessResult.Withdrawals`, no guest `SubmitWithdrawal`/`CompleteSettlement`, trigger isolation, receipt-driven prepare/capture/commit, no post-capture timeout refund
- **20-LIQUIDATION-DISCOVERY.md** — private discovery, opaque quotes, PREPARE/CAPTURE/COMMIT, no free liquidation, correct cross-asset valuation
- **21-TRANSACTION-REQUEST-LIFECYCLE.md** — all requests through `ProcessorEndpoint`, risk operations use PROCESS + oracle TRUSTPROCESS, no direct-enclave path
- **22-FAILURE-RECOVERY.md** — Vela owns encrypted-state persistence, no guest checkpoint/`SaveState`, canonical root recovery, idempotent commit retries, fail-closed custody mismatch
- **23-REPLAY-PROTECTION.md** — Vela request ID + exact account nonce + consumed receipt set + operation state machine + deterministic withdrawal ID + monotonic oracle epoch + optional ZK binding; no `NoctStateVerifier` contract
- **27-PERFORMANCE-MODEL.md** — no frozen TPS or latency guarantee; planning ranges only; measure before release
- **28-BENCHMARKING-PLAN.md** — reproducible harness, phase timing, load/state-size/recovery tests, conditional ZK gates

### Vela and oracle integration (Files 03, 16, 18, 30)

- **03-VELA-INTEGRATION-ARCHITECTURE.md** — `ProcessorEndpoint`, Manager, Executor, P-521 encryption, AbstractTrigger, authenticated TRUSTPROCESS, actual Vela `applicationId` (not `keccak256("NoctFinance")`)
- **16-VELA-TEE-EXECUTION.md** — Nitro Enclaves, WASM execution, P-521 communication keys, authenticated state updates, no HTTP/file/clock in guest
- **18-ORACLE-ARCHITECTURE.md** — on-chain `OracleAdapter` with official Pyth EVM verification for exact feed IDs, checked U256 exponent normalization, monotonic epoch, authenticated TRUSTPROCESS delivery, no 65-byte Pyth ECDSA or caller snapshot
- **30-END-TO-END-ARCHITECTURE.md** — complete request/oracle/risk/liquidation/settlement/compliance paths, custom-not-native ZK, `DEANONYMIZATION` compliance

### Optional custom ZK (Files 09, 13–15, 23)

- **09-STATE-COMMITMENT-MODEL.md** § Compact proof public inputs — 16-field schema under backend limit
- **13-ZK-ARCHITECTURE.md** — conditional Noct infrastructure, not native Vela; covers all transitions if mandatory; guest re-executes and checks output
- **14-ULTRAHONK-CIRCUIT-ARCHITECTURE.md** — pinned Noir/Barretenberg/zkVerify versions, circuit decomposition, checked U256 arithmetic, complete `appRoot` constraints
- **15-ZKVERIFY-INTEGRATION.md** — no frozen mode until File 28 gates pass; authenticated receipt handling; global-root serialization; liveness-safe captured-commit policy
- **23-REPLAY-PROTECTION.md** § Compact custom-ZK binding — domain/version/config/oracle/actors/nonces/operation/receipt/output commitments

### Design, configuration, testing, roadmap (Files 01–07, 10, 24–26, 29, 31–34)

- **01-EXECUTIVE-SUMMARY.md** — boundaries and trust model. *(Previously cited as the non-existent `01-SYSTEM-OVERVIEW.md`.)*
- **02-DESIGN-OBJECTIVES.md** — security, privacy, correctness over speed
- **03-VELA-INTEGRATION-ARCHITECTURE.md** — `ProcessorEndpoint`, Manager, Executor, trigger integration
- **04-HORIZON-ARCHITECTURE.md** — target chain and Horizon deployment context
- **05-PRIVACY-MODEL.md** — Vela hides private state; public leakage channels (triggers, claims, amounts, timing). *(Previously mis-cited as `04-PRIVACY-MODEL.md`.)*
- **06-TRUST-MODEL.md** — wallet → Vela → TEE → Noct state machine, optional custom ZK, correct oracle
- **07-NOCT-ACCOUNT-IDENTITY-MODEL.md** — P-521 association, exact nonce, no invented identity
- **08-NOCTSTATE-V1.md** — logical state, numeric types, **custody decimal boundary**, state invariants
- **10-PROTOCOL-CONFIGURATION.md** — all frozen thresholds, units, `nativeDecimals` and the `configCommitment` field order
- **24-PRIVACY-LEAKAGE-ANALYSIS.md** — accepted/prohibited leakage, timing analysis, error strings
- **25-THREAT-MODEL.md** — attacker goals, capabilities, mitigations, out-of-scope assumptions
- **26-SECURITY-MODEL.md** — TEE attestation, Pyth verification, receipts, ZK binding, defense in depth, prioritized audit areas. *(This one file replaces the two previously cited non-existent files `05-SECURITY-MODEL.md` and `26-SECURITY-REVIEW-CHECKLIST.md`; there is no separate review-checklist document in V1.)*
- **29-TESTING-STRATEGY.md** — golden vectors, invariant suite, integration/recovery/adversarial tests, no uint64/float financial fixtures
- **31-DEPLOYMENT-ARCHITECTURE.md** — environments, artifacts to pin, deployment assertions, secret management. *(Previously mis-cited as `31-GOVERNANCE-MODEL.md`.)*
- **32-V1-LIMITATIONS.md** — V1 scope and known limitations, including protocol-absorbed bad debt. *(Previously mis-cited as `32-COMPLIANCE-ARCHITECTURE.md`; the `DEANONYMIZATION` compliance path is in `30-END-TO-END-ARCHITECTURE.md`.)*
- **33-FUTURE-EXTENSIONS.md** — deferred features not in V1, and the normative upgrade principle
- **34-IMPLEMENTATION-ROADMAP.md** — 11-phase plan with pinned Vela, checked U256, scaled debt, receipt-driven settlement, measured performance gates
- **00-AUDIT-REMEDIATION-TRACEABILITY.md** — finding-to-file impact map and verification gates for the audit remediation
- **TOOLCHAIN-LOCK.md** — VERIFIED vs OPEN pins, and the normative arithmetic-kernel requirement

**No standalone governance document exists in V1.** Parameter changes, emergency pause and upgrade
authority are distributed across: `10` (frozen config and `configCommitment`), `09` (the committed
`governanceIdentity` authorized for `T13`), `12` (`T13 ABSORB_BAD_DEBT`), and `33` (the upgrade
principle). A reader looking for `31-GOVERNANCE-MODEL.md` MUST use those four sources; governance
MUST NOT be invented.


---

## Critical rules

1. **Canonical arithmetic:** All financial values and indexes are checked U256 with canonical 32-byte big-endian encoding. WAD = `10^18` for amounts/prices/ratios. RAY = `10^27` for rates/indexes/scaled debt. Full-width `mulDivDown`/`mulDivUp`. Debt rounds up; collateral rounds down. No `uint64`, `math/big`, native integer, or float in financial logic.

2. **Scaled debt:** Account `scaledDebt[USDC]`/`scaledDebt[ETH]`/`scaledDebt[ZEN]` and reserve `totalScaledDebt` per asset. No `debtPrincipal` or `entryBorrowIndex`. Current debt = `mulDivUp(scaledDebt, borrowIndex, RAY)`. Borrow adds `mulDivUp(amount, RAY, index)`. Full repay clears all scaled debt. Partial reduction = `mulDivDown(amount, RAY, index)` and must be nonzero.

3. **Interest accrual:** File 10 frozen kink model. Lazy accrual per transaction to `OracleState.AdapterBlockTimestamp`. RAY `borrowIndex` starts at `RAY`, is monotonic, uses linear per-second update with bounded chunk calculation.

4. **Vela custody and settlement:** `ProcessResult.Withdrawals` atomically debits private ledger and creates Vela `pendingClaims`. Native withdrawal is one Noct transition, not lock-then-consume. Repayment/liquidation use PREPARE → escrow/trigger CAPTURE → authenticated TRUSTPROCESS COMMIT. Captured payment never expires or timeout-refunds; commit is retried. No guest `vela.SubmitWithdrawal`, `CompleteSettlement`, `FailSettlement`, or `SaveState`.

5. **Oracle:** On-chain `OracleAdapter` calls official Pyth EVM verification for exact configured feed IDs. Validates price positivity, checked U256 exponent normalization, confidence ratio, age/skew, deviation. Stores monotonic epoch and snapshot commitment. `NoctTrigger` enforces on-chain max delay and sends authenticated TRUSTPROCESS payload. Guest accepts only strictly newer epoch and adapter block timestamp; it never trusts caller snapshot, signature, or local time.

6. **Risk thresholds:** `maxLTV` gates borrow and collateral release. Liquidation threshold identifies liquidation only. Liquidation valuation uses both debt-asset price and USDC price.

7. **Replay protection:** Vela request ID + platform root + exact account nonce + consumed receipt set + operation state machine + withdrawal ID + monotonic oracle epoch + optional domain-separated ZK proof commitments. No `NoctStateVerifier` contract.

8. **Commitment and invariants:** Complete `appRoot` commits all economically material state: accounts (cash, collateral, borrowed, scaled debt, nonce, locks), reserves (liquidity, total scaled debt, RAY index, accrual time), pending operations, consumed receipts, history. Custody = Ledger + PendingInbound + PendingOutbound. `reserve.totalScaledDebt = Σ account.scaledDebt`. No withdrawal without atomic ledger debit. No debt reduction without consumed payment receipt.

9. **Recovery:** Vela encrypted versioned state; recovery selects the version matching canonical on-chain Vela root. Captured operations retry to idempotent completion. No event replay into empty ledger, no invented receipts, no post-claim balance restoration.

10. **Custom ZK:** Optional Noct infrastructure, not native Vela. Uses File 09 compact schema (16 public inputs). Binds complete old/new `appRoot`, actual Vela `applicationId` and deployment chain, circuit/VK/config/oracle versions, actors, nonces, operation/receipt/settlement/withdrawal IDs, amounts, destination, expiry. Guest independently executes and checks output. Enabled only after File 15/28 gates pass.

11. **Performance:** No frozen TPS or latency SLA. File 27 planning ranges. Measure pinned deployment before release. No "10 TPS", "< 30 seconds", or "RPO 0" production guarantee.

---

## Superseded files — DO NOT IMPLEMENT

The following directories and files are historical and MUST NOT be used for implementation:

- `NOCT-IMPLEMENTATION-DOCUMENTATION/` — marked superseded
- `ARCHITECTURE_FREEZE_COMPLETE.md` — marked superseded
- `ARCHITECTURE_FILES_UPDATE_SUMMARY.md` — marked superseded
- `EVM_SMART_CONTRACT_AUDIT.md` — historical audit snapshot with stale contract examples
- `PROTOCOL_ECONOMICS_AUDIT.md` — historical audit snapshot with rejected principal/index model
- `TEE_CRYPTOGRAPHIC_AUDIT.md` — historical audit snapshot; use corrected Vela/commitment/replay files

These files are retained only as audit/review evidence. Where they conflict with `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/`, the corrected directory controls.

---

## Validation before pull request

Before submitting implementation code, verify:

1. No `uint64`, native integer, `math/big`, or `float` in financial logic; all amounts/prices/indexes are checked U256 with canonical encoding.
2. Debt uses `scaledDebt` + RAY `borrowIndex`, not `debtPrincipal` + `entryBorrowIndex`.
3. Interest accrual implements File 19 kink model, not a fixed rate.
4. Borrow/release gate is `maxLTV`; liquidation eligibility is liquidation threshold.
5. Native withdrawal atomically debits ledger and emits one `ProcessResult.Withdrawals`; no lock-then-consume.
6. Repayment/liquidation use PREPARE/CAPTURE/COMMIT; debt never decreases before receipt consumption.
7. Oracle uses `OracleAdapter` + official Pyth verification + authenticated TRUSTPROCESS; no caller snapshot or 65-byte signature.
8. All requests route through `ProcessorEndpoint`; no direct-enclave shortcut.
9. Replay uses Vela request ID, account nonce, receipt sets, operation state machine, withdrawal ID, oracle epoch; no `NoctStateVerifier`.
10. Recovery uses Vela encrypted-state version matching canonical on-chain root; no checkpoint or event-replay reconstruction.
11. Custody, scaled-debt equality, receipt consumption, withdrawal emission, and monotonicity invariants pass.
12. No hard-coded TPS, latency, or recovery-time guarantee before File 28 measurements.

---

## Implementation phases

Follow File 34 `34-IMPLEMENTATION-ROADMAP.md` 11-phase plan with corrected acceptance gates.

Phase 0 pins Vela, Go/TinyGo, Noir/Barretenberg versions and validates `ProcessResult.Withdrawals`, authenticated receipts, and TRUSTPROCESS integration.

Phases 2–6 implement checked U256, scaled debt, kink accrual, custody conservation, native withdrawals, prepare/capture/commit repay/liquidation, `OracleAdapter`, and TRUSTPROCESS ingestion.

Phases 7–8 benchmark optional custom ZK and enable only after File 15/28 gates pass.

Phases 9–11 integrate, secure, benchmark, stress, and deploy testnet with measured performance targets.

---

## Questions or conflicts

If any specification appears incomplete, contradictory, or blocks safe implementation:

1. Check the 11 critical rules above.
2. Re-read the applicable File in `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/`.
3. Check the glossary in `01-SYSTEM-OVERVIEW.md`.
4. If still unresolved, request explicit architecture decision rather than inventing protocol semantics.

Do not implement from superseded files, audit snapshots, or freeze reports.
