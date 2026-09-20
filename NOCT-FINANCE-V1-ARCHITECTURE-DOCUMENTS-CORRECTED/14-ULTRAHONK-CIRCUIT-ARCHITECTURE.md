# 14. UltraHonk Circuit Architecture

**Status:** Conditional implementation architecture  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Tooling baseline

The pinned zkVerify/Noir/Barretenberg versions determine supported UltraHonk variants, public-input count, domain limit, proof format, and verification-key encoding. Values observed in current documentation—including a maximum of 32 public inputs and evaluation domain up to `2^25`—MUST be revalidated and locked in `TOOLCHAIN-LOCK.md` before implementation.

## Layout

```text
circuits/
  common/
    domains.nr
    canonical_u256.nr
    checked_arithmetic.nr
    muldiv_rounding.nr
    commitments.nr
    membership.nr
    replay.nr
    oracle_binding.nr
    receipt_binding.nr
    withdrawal_binding.nr
  consume_deposit/main.nr
  supply/main.nr
  release/main.nr
  borrow/main.nr
  withdraw_cash/main.nr
  withdraw_borrowed/main.nr
  prepare_repay/main.nr
  commit_repay/main.nr
  prepare_liquidation/main.nr
  commit_liquidation/main.nr
  consume_reserve_funding/main.nr
  accrue_reserve/main.nr
```

Only circuits required by the approved proof policy need ship, but a mandatory proof policy cannot omit an enabled state transition.

## Compact public inputs

Use exactly the File 09 versioned schema:

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

The backend-specific limb encoding is frozen with the verification key. Public inputs are ordered, fixed-width, domain-separated, and counted in CI. Variable structures are private openings against their public commitments.

## Private witness

As applicable, the witness contains:

- complete affected account leaves and Merkle paths;
- reserve leaves and paths;
- pending-operation and lock leaves;
- receipt membership/non-membership data;
- history/withdrawal accumulator openings;
- checked U256 amounts, WAD prices/ratios, RAY indexes/rates/scaled debt;
- authenticated oracle/config fields opened against commitments;
- old/new nonce and state-version data;
- transition authorization details.

Derived current debt, health factor, and LTV are recomputed in-circuit rather than trusted witness values.

## Arithmetic rules

Circuit arithmetic MUST match guest arithmetic bit-for-bit:

- canonical unsigned 256-bit range constraints;
- checked addition/subtraction;
- full-width multiplication semantics;
- `mulDivDown`/`mulDivUp` with identical quotient/remainder rules;
- WAD/RAY unit separation;
- debt and USD value rounding upward;
- collateral/capacity rounding downward except the explicit liquidation seizure rules;
- kink boundary and per-second index accrual;
- timestamp/epoch monotonicity.

Field wraparound is not U256 overflow handling. Every value and intermediate requiring a bounded integer interpretation MUST be constrained accordingly.

## Transition constraints

Every transition circuit MUST enforce:

1. old leaves belong to `oldAppRoot`;
2. deployment, circuit, config, and oracle domains match;
3. request/actor/nonces/operation/receipt bindings match the transition;
4. File 12 preconditions and exclusive locks hold;
5. all economic deltas use checked arithmetic and specified rounding;
6. every affected leaf/subroot changes exactly as required;
7. unaffected committed state is preserved through valid Merkle updates;
8. emitted withdrawal commitment exactly matches the ledger debit and destination;
9. resulting global structure hashes to `newAppRoot`.

Commit-repay and commit-liquidation circuits require a matching captured unconsumed receipt. Prepare circuits change locks/operation state only and MUST prove no debt, liquidity, collateral ownership, or withdrawal mutation occurred.

## Circuit versioning

Each compiled artifact has:

```text
circuitID = H(source tree, compiler version, backend version, schema version)
vkHash = H(canonical verification key)
```

Both are public inputs and deployment configuration. Any arithmetic, commitment, transition, compiler, or backend change requires new artifacts and an explicit migration/activation policy. Old proofs cannot authorize new state rules.

## Test requirements

- guest/circuit golden vectors for every transition;
- near-U256 and quotient-remainder edge cases;
- malformed Merkle path and duplicate-key rejection;
- missing economic field from `appRoot` rejection;
- wrong application/chain/config/oracle/VK rejection;
- wrong actor, nonce, operation, receipt, amount, asset, destination, or expiry rejection;
- proof/output mismatch rejection;
- public-input count and domain-size CI gates;
- constraint count, witness time, proof time, verifier time, proof size, and memory benchmarks.

No custom circuit is a V1 production dependency until File 15's integration and File 28's benchmark gates pass.
