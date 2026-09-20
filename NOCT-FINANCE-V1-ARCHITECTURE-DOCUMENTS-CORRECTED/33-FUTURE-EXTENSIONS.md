# 33. Future Extensions

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## V1 boundary

Future work starts from, and MUST preserve, the V1 baseline:

- canonical 32-byte big-endian U256 financial values;
- WAD token amounts/prices and risk ratios;
- RAY indexes, utilization and interest rates;
- checked TinyGo-compatible U256 arithmetic with full-width `mulDiv`;
- scaled account debt and equal reserve `totalScaledDebt`;
- the frozen V1 utilization kink model;
- Noct-funded ZEN/ETH reserves;
- Vela custody, authenticated inbound receipts and `ProcessResult.Withdrawals`;
- receipt-before-debt-reduction repayment and liquidation;
- max-LTV borrow/release gating and liquidation-threshold-only eligibility;
- latest accepted authenticated `OracleState` consumption;
- monotonic, idempotent, replay-protected state transitions.

A future feature is not permission to weaken these invariants in a V1 implementation.

## Possible later versions

### Multi-collateral

Add collateral assets only with explicit per-asset identifiers, WAD prices, risk parameters, valuation rounding and custody conservation equations. Cross-collateral release continues to use max LTV; liquidation eligibility continues to use liquidation thresholds.

### User-funded liquidity

Allow users to supply ZEN/ETH and earn yield. This requires supplier scaled balances/indexes, reserve-factor realization, withdrawal liquidity policy, privacy analysis and new custody invariants. It MUST be introduced under a new state/config version; V1 remains Noct-funded.

### Interest model evolution

V1 already uses the frozen utilization kink curve. Later versions may introduce per-asset curves, governance-updated parameters, reserve-factor realization, or higher-fidelity compounding only with:

- an explicit migration for existing scaled debt and indexes;
- deterministic U256 formulas and rounding;
- bounded execution;
- golden vectors shared by WASM, circuits and off-chain clients;
- a new configuration commitment and protocol version.

A fixed-rate implementation is not a V1 fallback.

### Advanced liquidation and bad-debt handling

Future versions may add decentralized discovery, auctions, insurance reserves, socialized loss or protocol-owned bad-debt absorption. Any design MUST retain payment capture before debt reduction or collateral release, correct debt-asset USD conversion, exclusive locks and idempotent commit.

### Batched cross-contract settlement

Vela and external contracts do not become atomic merely because operations are batched. Later protocols may reduce latency, but MUST explicitly model prepared locks, authenticated receipts, pending inbound/outbound custody, retries and replay protection. Captured payments cannot be timeout-refunded by treating an acknowledgement failure as non-payment.

### Stronger settlement privacy

Evaluate stealth or one-time destinations, amount-hiding settlement layers, and batching only where supported by the pinned Vela stack. Privacy changes MUST preserve withdrawal deduplication and custody reconciliation.

### Oracle diversity

A later oracle subsystem may aggregate providers or add fallback feeds. Lending logic continues to consume only the latest accepted authenticated `OracleState` epoch; callers do not choose snapshots or signatures. Oracle-internal redesign belongs to the oracle architecture version, not lending transition payloads.

### Advanced ZK

Add recursion, aggregation or alternate proving systems only when supported by the selected verifier and justified by measured benefit. Proof public inputs MUST remain bound to protocol version, config commitment, state transition identity and canonical numeric encodings.

### Broader asset precision support

Assets with native decimals other than 18 may be supported through explicit checked conversion at custody boundaries. Internal V1-style accounting remains WAD. Conversion policy MUST define dust ownership and both rounding directions; native units MUST never be confused with WAD values.

## Upgrade principle

Every extension MUST be versioned and provide:

1. a canonical state/config schema and commitment domain;
2. a deterministic migration with rollback prohibited after activation;
3. conservation and scaled-debt proofs before and after migration;
4. replay-safe handling of pending receipts, withdrawals and prepared operations;
5. arithmetic bounds, rounding tables and cross-implementation test vectors;
6. failure recovery for non-atomic cross-contract phases;
7. performance limits for worst-case TinyGo/WASM execution.

No upgrade may reinterpret an existing 32-byte value under a different unit or silently convert principal/entry-index debt into the V1 scaled-debt fields. Migration must be explicit, audited and committed as a state transition.
