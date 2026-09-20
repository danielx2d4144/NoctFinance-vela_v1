# 22. Failure & Recovery

**Status:** Frozen V1 implementation architecture  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Recovery authority

Vela—not guest application code—owns encrypted-state persistence and platform-root recovery. The Noct WASM receives prior state and returns new state bytes in `ProcessResult`. It has no `vela.SaveState`, LevelDB, checkpoint, disk, network, or event-query API.

The Manager persists versioned encrypted state. Recovery MUST select the version matching the canonical encrypted application-state root accepted by `ProcessorEndpoint`, using the keyset/restart procedure supported by the pinned Vela version. Noct MUST NOT initialize an empty ledger and rebuild balances by replaying public deposits.

## Atomic guest rule

A Noct transition computes a complete next state and result in memory, validates every invariant, and returns both or an error:

```text
old state + authenticated request
→ deterministic computation
→ invariant validation
→ ProcessResult(new state, withdrawals/events/report)
```

An error returns no accepted new Noct state and no withdrawal. The later Vela state update determines platform finality.

## Failure matrix

| Failure | Canonical recovery |
|---|---|
| Client crashes before submission | Rebuild request using current account nonce |
| Client crashes after submission | Query Vela request ID; do not submit a conflicting economic request |
| Facilitator fails | Query chain; use official self-relay/direct path if request was never submitted |
| Manager/Executor crashes before state update | Restart pinned components and reprocess queued Vela request idempotently |
| Crash after state update, before client acknowledgement | Canonical Vela root/result wins; client reconciles request ID |
| State storage unavailable | Manager stops accepting/finalizing work; guest cannot enter a fabricated read-only mode |
| OracleAdapter stale/broken | Block new risk transitions; allow operations listed below |
| Optional ZK prover fails | No state mutation; retry proof or use the configured non-ZK mode if policy permits |
| Trigger fails before payment capture | Preparation may remain or expire; no debt/collateral mutation |
| Payment captured, commit delivery fails | Retain receipt and locks; retry authenticated commit indefinitely |
| Native withdrawal remains unclaimed | No recovery action; claim is already user property |
| Custody/root/invariant mismatch | Fail closed, halt affected transitions, alert, and investigate |

## Restart procedure

1. Stop new request pickup for the application.
2. Read the canonical application root and latest completed request information from `ProcessorEndpoint`.
3. Restart Manager and Executor using the pinned Vela keyset recovery procedure.
4. Select the persisted encrypted state version whose platform root matches the canonical on-chain root.
5. Decrypt inside the Executor and verify the embedded Noct `appRoot`, schema version, config commitment, and monotonic state metadata.
6. Rebuild only non-authoritative indexes/caches from committed state.
7. Reconcile queued Vela requests and trigger-generated `TRUSTPROCESS` requests by official request IDs.
8. Reconcile pending inbound receipts, captured operations, withdrawals, and claims without inventing entries.
9. Resume only after custody, scaled-debt, receipt, operation, and commitment invariants pass.

If no stored encrypted version matches the canonical on-chain Vela root, processing remains halted. Operator preference, timestamps, or the largest local state version MUST NOT override the chain root.

## Deposit and funding recovery

A finalized custody event becomes an authenticated receipt with a unique chain/endpoint/transaction/log identity. Recovery may redeliver that same receipt. The guest consumes it idempotently through its committed consumed-receipt set.

It MUST NOT:

- query arbitrary events from inside WASM;
- create a new receipt ID for an old transfer;
- credit a user because a vault balance appears larger;
- delete consumed receipt history after a checkpoint;
- replay all deposits into an empty state.

An on-chain transfer awaiting private credit remains `PendingInbound` until the exact receipt is consumed.

## Native withdrawal recovery

An accepted Vela state update that includes a withdrawal has already debited Noct state and created a pending claim. Reconciliation verifies:

- the Vela request ID and accepted state root;
- deterministic withdrawal/output commitment;
- application/token custody accounting;
- recipient pending-claim state where exposed by the pinned contracts.

It never calls an enclave `completeSettlement` or `failSettlement`. A missing user `claim()` transaction is not failure. Duplicate result delivery cannot emit another withdrawal.

## Captured repayment and liquidation recovery

Status is monotonic:

```text
PREPARED -> EXPIRED
PREPARED -> PAYMENT_CAPTURED -> COMMITTED
```

Before payment capture, expiry may remove the private lock. After capture:

- the exact receipt remains durable and unconsumed;
- operation locks remain installed;
- timeout cannot expire or refund the operation;
- reconciliation resubmits/recovers the authenticated `TRUSTPROCESS` commit;
- duplicate commit returns the stored result.

If a captured receipt conflicts with committed operation terms, quarantine the operation and halt affected accounting. Do not guess a conversion, alter debt, unlock collateral, or independently refund funds while commit may remain possible.

## Reorg handling

Chain finality policy is deployment-specific and MUST be tested against the selected chain. Before finality, request/receipt observations are provisional. After a reorg:

1. Vela Manager reconciles to the canonical `ProcessorEndpoint` root using versioned state.
2. Off-chain services discard orphaned request/receipt observations.
3. Noct processes only authenticated receipts from the canonical finalized chain.
4. A captured operation is recognized only from a canonical finalized receipt.
5. Native withdrawal ownership follows the canonical accepted Vela state update.

Application code MUST NOT locally roll back one account while retaining a global root from another branch.

## Oracle outage policy

When OracleAdapter/Pyth updates are unavailable, stale, confidence-invalid, or breaker-paused:

Allowed when their own custody checks pass:

- finalized deposit/funding receipt consumption;
- supply USDC;
- cash or private borrowed-balance withdrawal;
- commit of an already captured repayment;
- commit of an already captured liquidation using its locked quantities;
- full or partial risk-reducing repayment preparation only if File 12 can quote safely using an accrued authenticated clock under the configured policy.

Blocked:

- new borrow;
- collateral release with debt;
- new liquidation discovery/preparation;
- any operation requiring a fresh risk valuation.

Governance cannot bypass official Pyth verification by manually injecting a price into guest state.

## Optional ZK failure

ZK/zkVerify is custom Noct infrastructure. Recovery policy MUST define whether proof authorization is mandatory per transition. A proof outage may delay submission, but it does not justify:

- accepting an unverified proof;
- changing the expected app root;
- omitting receipt/operation bindings;
- replaying against a newer state;
- treating zkVerify availability as Vela finality.

Global-root-bound proofs become stale after any accepted global transition and must be regenerated unless a future batching/sharding scheme explicitly supports concurrency.

## Reconciliation service

The external reconciliation service is an observer/retry coordinator, not a ledger writer. It may:

- query official Vela request completion and roots;
- verify finalized adapter and escrow events;
- redeliver the same authenticated receipt through the supported path;
- ensure captured operations have commit requests queued;
- alert on custody, receipt, root, or SLA mismatches.

It MUST NOT call private mutation endpoints outside `ProcessorEndpoint`, manufacture receipts, unlock captured operations, or directly edit enclave state.

## RTO and RPO

No unconditional `<5 minute` RTO or `RPO 0` claim is frozen for V1. These are measured deployment objectives and depend on:

- supported Manager/Executor restart topology;
- keyset recovery;
- persisted encrypted-state versions;
- chain RPC and finality;
- queued request volume;
- trigger/escrow availability.

Initial testnet objectives SHOULD be defined only after restart, reorg, and corrupted-storage drills. Production claims require observed p95/p99 evidence and documented backup/key recovery procedures.

## Required drills

1. Coupled Manager/Executor restart before and after state update.
2. Unsupported partial-component restart fails closed.
3. Lost client acknowledgement after successful request.
4. Reorg across deposit, withdrawal, oracle, and payment-receipt transactions.
5. Captured repayment/liquidation with commit delivery delayed for hours.
6. Duplicate receipt and commit redelivery after restart.
7. Unclaimed native withdrawal across restart.
8. Missing/corrupt encrypted-state versions.
9. Oracle outage and breaker recovery.
10. Custody or `appRoot` mismatch causing protocol halt rather than repair-by-guessing.
