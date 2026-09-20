# 13. ZK Architecture

**Status:** Conditional implementation architecture  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Boundary

Vela supplies confidential attested execution and encrypted state. Custom Noct ZK may additionally prove a specific versioned transition statement, but is not provided by Vela and is not automatically required in V1.

```mermaid
flowchart LR
    S[Committed Noct appRoot] --> W[Witness builder]
    W --> P[UltraHonk prover]
    P --> V[Direct verifier or zkVerify]
    V --> A[Noct proof authorization]
    A --> R[Official Vela PROCESS or TRUSTPROCESS path]
    R --> E[Noct independently re-executes transition]
```

ZK does not replace:

- Vela request authentication and state-update attestation;
- official Pyth EVM verification and OracleAdapter delivery;
- authenticated deposit/payment receipts;
- checked U256 lending arithmetic;
- custody and settlement invariants.

## Circuit decomposition

Do not build one giant unconstrained circuit. Use shared versioned libraries and focused transition circuits/authorization statements for every transition that deployment policy makes proof-mandatory:

```text
common/
  domains
  canonical_u256
  muldiv_rounding
  commitments
  membership
  replay
  oracle_binding
  receipt_binding
  withdrawal_binding

transitions/
  consume_deposit
  supply
  release_collateral
  borrow
  withdraw_cash
  withdraw_borrowed_asset
  prepare_repay
  commit_repay
  expire_repay
  prepare_liquidation
  commit_liquidation
  expire_liquidation
  consume_reserve_funding
  accrue_reserve
```

Capture itself is authenticated by the on-chain receipt path. A circuit may authorize receipt consumption, but cannot prove that an unverified user assertion is an authentic payment.

## State statement

Every circuit opens the relevant File 09 leaves against the complete old `appRoot`, applies exactly File 12 arithmetic/state rules, and constrains the complete new `appRoot` and output commitment.

Economically material state includes:

- cash, collateral, borrowed balances, and scaled debt;
- reserve liquidity, total scaled debt, RAY index, and accrual time;
- pending operation locks/status/quantities;
- consumed receipt membership;
- oracle/config commitments;
- history and deterministic withdrawal output.

An account-only Merkle root is insufficient.

## Public-input abstraction

Use File 09's compact public schema. Variable structures are domain-separated commitments opened privately. The flattened public-input count MUST remain within the pinned verifier limit.

The proof binds the actual Vela `applicationId`, deployment chain, request context, old/new Noct roots, circuit/VK/config/oracle versions, actors, nonces, operation/receipt/settlement IDs, expiry, and economic/output commitment.

It MUST NOT use `keccak256("NoctFinance")` as the Vela application ID or a caller-provided oracle timestamp as freshness evidence.

## Verification abstraction

```ts
interface ZKVerifier {
  verifyAuthorization(
    proofOrReceipt: Uint8Array,
    publicInputsHash: Uint8Array,
    policyVersion: bigint
  ): Promise<VerificationResult>;
}
```

Provider objects remain outside the core reducer. The guest independently executes the transition and requires the resulting roots and outputs to match the proof authorization.

## Sequential V1 root

V1 proofs bind one monolithic current `appRoot`. Any accepted global transition invalidates outstanding proofs for the old root. V1 therefore processes root-bound proofs sequentially and measures stale-proof regeneration.

Parallel proving, sharded roots, recursive batching, or conflict-free execution requires a new state/proof version and is deferred.

## Performance and availability gate

No custom proof becomes mandatory for an interactive or captured-payment commit path until Files 15 and 28 demonstrate:

- verifier correctness and authenticated receipt handling;
- acceptable WASM size/fuel/memory;
- acceptable p95/p99 proof and verification latency;
- durable prioritized commit liveness;
- tolerable stale-root regeneration under load;
- explicit outage policy that never silently bypasses proof requirements.

## Required security tests

- unconstrained witness and missing-root-field tests;
- U256 range, overflow, and rounding tests;
- wrong reserve index/scaled-debt tests;
- wrong oracle/config/domain/VK tests;
- actor substitution, including borrower/liquidator;
- receipt/operation/withdrawal substitution;
- valid proof paired with altered returned state/output;
- stale root after unrelated transition;
- cross-app/chain/endpoint/version replay;
- malformed or unauthenticated zkVerify authorization.
