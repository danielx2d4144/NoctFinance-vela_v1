# 15. zkVerify Integration

**Status:** Conditional V1 architecture; benchmark and integration evidence required  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Boundary

Vela does not provide Noir/UltraHonk proving, zkVerify submission, proof receipts, or Noct proof authorization. Every component in this file is custom Noct infrastructure and MUST be implemented, version-pinned, threat-modeled, and benchmarked independently.

TEE attestation, Vela encrypted-state roots, custom Noct `appRoot` proofs, Pyth verification, and payment receipts provide different guarantees. One MUST NOT be presented as a substitute for another.

## V1 decision gate

No ZK mode is frozen until File 28 benchmarks the exact circuit and deployment:

- **Mode A — no custom proof on the interactive path:** Vela/TEE authorization only;
- **Mode B — direct UltraHonk verification:** only if the pinned verifier compiles safely for TinyGo/WASM and meets size, fuel, memory, and latency limits;
- **Mode C — zkVerify verify-only receipt:** only after Noct implements authenticated receipt verification, replay binding, availability handling, and end-to-end tests;
- **Aggregation:** deferred unless measured product requirements justify its latency and failure modes.

The core lending state machine MUST remain independent of provider SDK objects. It consumes a small versioned `ProofAuthorization` interface whose implementation may be disabled, direct, or receipt-backed according to deployment configuration.

## Compact public inputs

Every enabled transition uses the File 09 schema and remains within the pinned verifier's maximum public-input count:

```text
proofSchema
velaApplicationID
chainID
circuitID
vkHash
configCommitment
oracleCommitment
oldAppRoot
newAppRoot
transitionID
requestCommitment
actorsCommitment
noncesCommitment
receiptSettlementCommitment
operationExpiryCommitment
transitionCommitment
```

The Vela application identity is the actual `applicationId` assigned at deployment. It is not `keccak256("NoctFinance")`. Chain ID is the deployment chain, not a hard-coded mainnet value.

Structured commitments MUST bind, as applicable:

- actual Vela request ID and request type;
- expected old Vela encrypted-state root when exposed by the pinned integration;
- complete old/new Noct `appRoot`;
- circuit, verification key, protocol, schema, and configuration versions;
- latest accepted OracleAdapter commitment/epoch;
- all affected actors, including borrower and liquidator;
- exact old/new account nonces;
- transition kind, asset, checked U256 amounts, scaled debt, and reserve index;
- operation, receipt, settlement, and deterministic withdrawal IDs;
- destination, expiry, and emitted withdrawal commitment.

Caller-selected oracle timestamps or prices are not proof inputs. Risk proofs bind the authenticated `oracleCommitment` and operation epoch from state.

## Transition coverage

If proof authorization is mandatory, circuits/authorizations must cover every enabled state transition—not only deposit, borrow, repay, and liquidate:

- deposit/funding receipt consumption;
- supply and collateral release;
- borrow and borrowed-asset withdrawal;
- repayment prepare, capture/commit authorization, and pre-capture expiry;
- liquidation prepare, capture/commit authorization, and pre-capture expiry;
- cash withdrawal;
- oracle-state update where a proof is required by policy;
- reserve accrual where a proof is required by policy.

A commit proof MUST bind the already prepared operation and authenticated receipt. It cannot turn an untrusted payment assertion into a valid receipt.

## Verification order

For an enabled proof path, guest verification is conceptually:

```text
1. authenticate Vela request or TRUSTPROCESS context
2. decode canonical command and U256 values
3. require deployment/config/circuit versions
4. require exact account nonce and current appRoot
5. require operation/receipt/oracle commitments where applicable
6. verify direct proof or authenticated zkVerify authorization
7. independently execute the deterministic Noct transition
8. recompute all subroots and new appRoot
9. require recomputed new appRoot and output commitment match proof inputs
10. return state plus withdrawals atomically
```

The guest never applies arbitrary state deltas supplied by a proof. It re-executes the transition and checks the proof-bound result. Any mismatch returns an error with no new state or withdrawal.

## zkVerify receipt authorization

Before Mode C is enabled, Noct MUST specify and test:

- exact zkVerify network, contract/API, proof system, version, and verification-key registration;
- canonical proof/job/receipt identifier;
- authenticated receipt source and signature or on-chain inclusion verification;
- chain finality and reorg behavior;
- binding from the receipt to the exact public-input hash;
- replay/nullifier handling;
- outage, timeout, expiration, and retry policy;
- privacy of proof metadata;
- rate limits, cost, and denial-of-service controls.

A client-provided JSON object claiming that zkVerify succeeded is never sufficient.

## Concurrency limitation

Proofs bound to the monolithic current `appRoot` serialize V1. After any accepted global transition, outstanding proofs against the old root are stale. Parallel proof workers do not solve this; they may increase wasted work.

Batching, sharded account roots, or optimistic proof queues require a new state/proof version and are not V1 assumptions.

## Availability policy

Each transition's configuration states whether custom proof authorization is mandatory. If mandatory and the prover/zkVerify path is unavailable, that transition fails closed before economic mutation. Operators MUST NOT silently bypass proof policy.

Captured repayment/liquidation receipts require a liveness-safe policy. If their commit circuit is mandatory, proving infrastructure must support durable prioritized retries; payment capture MUST NOT leave users indefinitely stranded because an optional external proof service was treated as best effort.

## Required tests and release gate

1. Public-input flattening never exceeds the pinned backend limit.
2. Cross-app, cross-chain, cross-endpoint, cross-version, wrong-VK, wrong-config, and wrong-oracle replays fail.
3. Actor, nonce, operation, receipt, asset, amount, destination, expiry, and withdrawal substitutions fail.
4. Guest recomputation rejects a valid proof paired with different returned state/output.
5. Stale global-root proofs fail after unrelated transitions.
6. Malformed or unauthenticated zkVerify receipts fail.
7. Reorg and outage behavior follows documented policy.
8. WASM verifier size, memory, fuel, and p95/p99 latency pass File 28 gates.
9. Captured-payment commit remains recoverable and idempotent under proof-service failure.

Until these pass, custom ZK remains conditional and MUST NOT be described as a native Vela feature or production guarantee.
