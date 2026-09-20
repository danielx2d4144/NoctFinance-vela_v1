# 23. Replay Protection

**Status:** Frozen V1 implementation architecture  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Layered replay model

No single nonce is sufficient for Noct. V1 uses independent replay controls at the Vela, account, receipt, operation, withdrawal, oracle, and optional ZK layers.

```text
Vela request ID and previous encrypted-state root
    + exact account nonce
    + consumed inbound-receipt set
    + operation state machine and operation ID
    + deterministic withdrawal ID and stored result
    + monotonic OracleAdapter epoch
    + domain-separated proof commitments
```

A retry is not automatically an attack. If an operation already committed but its response was lost, the implementation MUST return the stored successful outcome without repeating its economic effects.

## Vela platform protections

The Vela platform binds a signed state update to the actual deployed `applicationId`, the processed request ID, and the previous and next encrypted application-state roots. The Manager persists encrypted, versioned state and reconciles it with the root accepted by `ProcessorEndpoint`.

Noct MUST use those platform protections and MUST NOT replace them with an invented `NoctStateVerifier` contract. The guest does not set Vela's root and cannot treat the Noct plaintext `appRoot` as the Vela encrypted-state root.

On restart or reorg, the runtime must recover a version whose encrypted-state root matches the canonical on-chain Vela root before accepting new Noct requests.

## Application identity and domain

The proof and request domain uses deployment values, not a name hash:

```text
NoctDomainV1 {
    protocolDomain       = "NOCT_FINANCE_V1"
    velaApplicationID    = actual int64 assigned by ProcessorEndpoint
    chainID              = actual EIP-155 deployment-chain ID
    processorEndpoint    = configured ProcessorEndpoint address
    protocolVersion      = 1
    stateSchemaVersion   = 1
}
```

The deployment stores these values in initial state. Every request, trigger payload, receipt, operation, withdrawal, and custom proof commitment MUST bind the applicable domain values. A request for another deployment, chain, endpoint, protocol version, or schema is rejected.

## Exact account nonce

Each user-authorized operation includes an exact next `positionNonce`:

```text
require request.nonce == account.positionNonce + 1
```

The nonce increments only in the successful returned state. Rejected requests do not consume it. Authenticated system transitions such as oracle ingestion or idempotent receipt redelivery do not impersonate a user and follow their own replay domains.

A request with a lower nonce is stale. A request with a higher nonce contains a gap and is rejected. Concurrent requests for one account therefore serialize. A previously committed request may be recognized by its Vela request ID/history entry and return its stored result.

Account nonce alone does not protect deposits, trigger receipts, or multi-account liquidations, so the controls below remain mandatory.

## Deposit and payment receipt replay

Every inbound custody event has a canonical receipt ID:

```text
receiptID = H(
    NOCT_RECEIPT_V1,
    sourceChainID,
    custodyEndpoint,
    transactionHash,
    logIndex,
    asset,
    amount,
    sender,
    beneficiary,
    purpose,
    operationID
)
```

The receipt preimage is authenticated by the configured Vela/trigger integration. User-supplied event identifiers are insufficient.

Receipt status is monotonic:

```text
PENDING -> CAPTURED -> CONSUMED
```

Not every purpose requires every intermediate state, but no status can regress. `consumedReceiptRoot` is append-only. Re-delivery of a consumed receipt returns the stored outcome and MUST NOT credit cash, reserve liquidity, or debt reduction again.

A chain reorg may invalidate an event only before it reaches the deployment's required finality and enters trusted receipt state. Once accepted, recovery follows the pinned Vela canonical-root procedure; application code MUST NOT independently delete consumed receipt history.

## Prepare/commit operation replay

Repayment and liquidation use a deterministic `operationID` binding:

```text
NOCT_OPERATION_V1
chainID
velaApplicationID
prepareRequestID
operationKind
initiator
borrower/account
asset
paymentAmount
scaledDebtReduction
collateralAmount if any
account nonce
configCommitment
oracleCommitment/epoch if applicable
expiry
```

Status is monotonic:

```text
PREPARED -> PAYMENT_CAPTURED -> COMMITTED
PREPARED -> EXPIRED
```

`PAYMENT_CAPTURED` cannot expire or return to `PREPARED`. A commit requires the exact unconsumed receipt bound to the operation. A committed operation retains a history record containing its economic deltas and withdrawal output commitment.

Duplicate prepare requests cannot create different live operations under the same nonce. Duplicate capture cannot create a second receipt. Duplicate commit returns the original result without another debt change, liquidity credit, collateral debit, or withdrawal.

## Withdrawal replay

Every native withdrawal uses:

```text
withdrawalID = H(
    NOCT_WITHDRAWAL_V1,
    chainID,
    velaApplicationID,
    velaRequestID,
    operationID or zero,
    token,
    destination,
    amount,
    accountNonce
)
```

The ID and complete output commitment are appended to history in the same Noct state transition that debits the private ledger and emits `ProcessResult.Withdrawals`.

A Vela pending claim is already settled user property. The absence of a later `claim()` transaction is not a failed withdrawal and cannot authorize ID reuse or private-balance restoration.

## Oracle replay

The configured `OracleAdapter` creates strictly increasing epochs after official Pyth EVM verification. Noct accepts an oracle `TRUSTPROCESS` payload only when:

```text
payload.epoch > stored.epoch
payload.adapterBlockNumber >= stored.adapterBlockNumber
payload.adapterBlockTimestamp >= stored.adapterBlockTimestamp
payload.publishTime[i] >= stored.publishTime[i]
recomputedSnapshotCommitment == payload.snapshotCommitment
```

The trigger payload binds the chain, endpoint, application ID, trigger, adapter, operation ID, and payload kind. User or facilitator snapshots are never accepted by risk logic.

A borrow, collateral release, or liquidation preparation consumes the newly accepted epoch for its bound intent according to File 18. Reusing an old signed Pyth update, adapter snapshot, trigger payload, or operation/epoch binding is rejected.

## Compact custom-ZK binding

ZK/zkVerify is custom Noct infrastructure, not a native Vela service. If enabled, every proof uses the compact schema from File 09 and remains within the pinned verifier's public-input limit:

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

Structured values are domain-separated commitments opened inside the circuit. At minimum they bind:

- the actual Vela request ID and request type;
- expected old Vela root where available to the integration;
- exact old and new Noct `appRoot`;
- actor set, including borrower and liquidator for liquidation;
- old/new account nonces;
- transition kind;
- asset and checked U256 economic deltas;
- reserve index and scaled-debt changes;
- config and authenticated oracle commitments;
- receipt, operation, settlement, and withdrawal IDs;
- destination and expiry policy.

A proof bound to an old global `appRoot` is stale after any accepted global transition. V1 intentionally processes global-root-bound proofs sequentially. Parallel proving against one monolithic root is unsafe because an unrelated accepted transaction invalidates outstanding proofs. Future batching or sharded roots require a new proof/state schema.

## Transition coverage

Replay and commitment rules apply to every state transition, including:

1. deposit receipt consumption;
2. cash withdrawal;
3. supply;
4. collateral release;
5. borrow;
6. borrowed-asset withdrawal;
7. repayment prepare, capture, commit, and pre-capture expiry;
8. liquidation prepare, capture, commit, and pre-capture expiry;
9. reserve funding receipt consumption;
10. oracle update;
11. reserve accrual;
12. authorized compliance reports where report request replay matters.

A circuit or authorization system that recognizes only deposit/borrow/repay/liquidate is incomplete.

## Anti-rollback monitoring

Monitoring compares official Vela data rather than exposing every private account nonce on-chain:

- canonical `ProcessorEndpoint` application state root;
- latest processed Vela request ID/status;
- Manager's matching encrypted state version;
- Noct state version and `appRoot` read through an authorized/private diagnostic path;
- outstanding captured receipts and operations.

If the Manager cannot produce encrypted state matching the canonical Vela root, request processing halts. Monitoring MUST NOT "repair" the system by replaying deposits into a newly initialized ledger or by accepting an older app root.

## Required tests

1. Replay each Vela request and confirm no second mutation.
2. Submit nonce below, equal to, and above the exact next value.
3. Redeliver every deposit, reserve-funding, repayment, and liquidation receipt 1,000 times.
4. Replay prepare, capture, commit, and lost-acknowledgement scenarios.
5. Attempt withdrawal-ID reuse with changed amount, asset, destination, operation, and chain.
6. Replay older and equal oracle epochs and publication times.
7. Replay proofs across application IDs, chains, endpoints, versions, circuits, configs, oracle epochs, actors, receipts, and operations.
8. Restore every persisted Vela state version and accept only the one matching the canonical on-chain encrypted-state root.
9. Verify global-root proof serialization rejects stale proofs after an unrelated state transition.
10. Verify idempotent retries return byte-identical stored outcomes without incrementing nonces or emitting withdrawals again.
