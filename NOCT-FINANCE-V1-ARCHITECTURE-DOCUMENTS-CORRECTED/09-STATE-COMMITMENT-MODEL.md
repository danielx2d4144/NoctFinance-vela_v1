# 9. State Commitment Model

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Purpose

Noct maintains a plaintext application commitment for custom ZK proofs while Vela independently commits the encrypted application state used by its executor and contracts. These roots have different domains, encodings and trust purposes and MUST NOT be equated.

## Two distinct roots

```text
velaEncryptedStateRoot = SHA256(encrypted AppData)
appRoot                = H(NOCT_APP_ROOT_V1 || GlobalRootStateV1)
```

`velaEncryptedStateRoot` is owned by Vela. Vela's state-update authorization binds the actual Vela `applicationId`, old and new encrypted-state roots, and Vela request ID. The Noct WASM does not calculate, replace or reinterpret that root.

`appRoot` is owned by Noct and commits the canonical plaintext lending state for custom UltraHonk proofs. It is serialized inside `NoctStateV1.appState`; encryption therefore indirectly binds it into Vela's encrypted-state root, but the two values remain distinct. A Vela root MUST NOT be supplied where a proof expects an `appRoot`, or vice versa.

## Canonical numeric model

Every economic value is a checked U256 encoded as exactly 32 unsigned big-endian bytes. Amounts, prices and ratios use WAD (`10^18`). Rates and reserve indexes use RAY (`10^27`). Account and reserve debt is represented only as RAY-scaled debt:

```text
accountDebt(asset) = mulDivUp(account.scaledDebt[asset], reserve.borrowIndex[asset], RAY)
totalDebt(asset)   = mulDivUp(reserve.totalScaledDebt[asset], reserve.borrowIndex[asset], RAY)
```

V1 has no debt-principal or entry-index field. `borrowIndex` starts at `RAY`, is monotonic, and is committed as a U256. `uint64` is restricted to non-financial versions, nonces, epochs and timestamps.

## Canonical commitment tree

`H` denotes the circuit-compatible hash frozen with the V1 circuit and verification key. Every node uses the exact domain shown below, fixed-width fields, length-prefixed variable collections, and canonical big-endian encoding. Map leaves are ordered by their canonical key bytes; duplicate keys and non-canonical encodings are rejected. Empty roots are the hash of the root domain and a zero leaf count.

```text
accountRoot = H(NOCT_ACCOUNT_ROOT_V1 || leafCount || ordered account leaves)
reserveRoot = H(NOCT_RESERVE_ROOT_V1 || leafCount || ordered reserve leaves)
pendingOperationRoot = H(NOCT_PENDING_OPERATION_ROOT_V1 || leafCount || ordered operation leaves)
consumedReceiptRoot = H(NOCT_CONSUMED_RECEIPT_ROOT_V1 || leafCount || ordered consumed-receipt leaves)
historyRoot = H(NOCT_HISTORY_ROOT_V1 || leafCount || ordered history leaves)
```

### `accountRoot`

An account leaf commits every persisted economic or authorization field:

```text
H(NOCT_ACCOUNT_LEAF_V1 ||
  accountAddress ||
  cashUSDC || collateralUSDC || borrowedZEN || borrowedETH ||
  scaledDebtZEN || scaledDebtETH ||
  positionNonce || lastUpdateTimestamp ||
  debtLockZEN || debtLockETH || collateralLockUSDC)
```

Balances, collateral, lock quantities and both `scaledDebt` values are U256. A lock representation MUST commit its operation ID and locked U256 quantity; an absent lock has the canonical zero encoding. Derived current debt, LTV and health factor MUST NOT be stored as alternate economic fields.

### `reserveRoot`

Each ZEN or ETH reserve leaf is:

```text
H(NOCT_RESERVE_LEAF_V1 ||
  assetID || availableLiquidity || totalScaledDebt ||
  borrowIndexRay || lastAccrualTimestamp)
```

`availableLiquidity`, `totalScaledDebt` and `borrowIndexRay` are U256. The root includes both supported assets in canonical asset-ID order.

### `pendingOperationRoot`

Each repayment or liquidation operation leaf commits:

```text
H(NOCT_PENDING_OPERATION_LEAF_V1 ||
  operationID || kind || status || initiator || account || assetID ||
  paymentAmount || scaledDebtReduction || quoteBorrowIndexRay ||
  collateralToWithdraw || destination ||
  requestID || initiatorNonce || accountNonce ||
  configCommitment || oracleCommitment || oracleEpoch ||
  createdAt || expiresAt || capturedReceiptID)
```

All payment, debt, index and collateral quantities are U256. `PREPARED`, `PAYMENT_CAPTURED`, `COMMITTED` and `EXPIRED` are distinct canonical status values. Committed and expired operations may be moved to history only in the same transition that updates both roots.

### `consumedReceiptRoot`

The append-only consumed-receipt set commits enough data to prevent substitution, not only the ID:

```text
H(NOCT_CONSUMED_RECEIPT_LEAF_V1 ||
  receiptID || sourceChainID || custodyEndpoint || txHash || logIndex ||
  assetID || amount || sender || beneficiary || purpose || operationID ||
  consumedAtStateVersion)
```

`amount` is U256. Membership is permanent. A receipt cannot be removed or returned to an unconsumed state.

### `historyRoot`

The append-only history tree commits replay-sensitive outcomes that are no longer pending:

```text
H(NOCT_HISTORY_LEAF_V1 ||
  stateVersion || transitionID || requestID || operationID ||
  actorCommitment || nonceCommitment || receiptID || settlementID ||
  oldAppRoot || newAppRoot || outcomeCommitment)
```

`outcomeCommitment` commits all economic deltas and every emitted Vela `ProcessResult.Withdrawals` entry, including token address, destination and U256 amount. This makes accepted requests, committed operation IDs and deterministic withdrawal/settlement IDs append-only.

## Global application root

The canonical global-root preimage is `GlobalRootStateV1`; global-root proofs MUST serialize this exact V1 structure and no other version:

```text
GlobalRootStateV1 {
    schemaVersion             uint64 = 1
    protocolVersion           uint64
    stateVersion              uint64
    velaApplicationID         int64
    chainID                   uint64
    accountRoot               [32]byte
    reserveRoot               [32]byte
    pendingOperationRoot      [32]byte
    consumedReceiptRoot       [32]byte
    historyRoot               [32]byte
    configCommitment          [32]byte
    oracleCommitment          [32]byte
    latestOracleEpoch         uint64
    latestOracleTimestamp     uint64
}

appRoot = H(NOCT_APP_ROOT_V1 || canonicalSerialize(GlobalRootStateV1))
```

The application identity is the actual `applicationId int64` assigned by the Vela deployment and passed to `deploy`, `deposit` and `process_request`; it is not `keccak256("NoctFinance")`. `chainID` is the EIP-155 chain ID of the Vela contracts handling that deployment, not an assumed Ethereum-mainnet value. Deployment MUST freeze both values in initial state and every call MUST match them.

All persisted economic fields MUST be reachable from exactly one of the five subroots and therefore from `appRoot`. Configuration and authenticated oracle values are committed by their own commitments; their hashes and monotonic epoch metadata are included in the global preimage.

## Compact proof public inputs

Every transition proof uses the compact V1 schema below. Each item occupies one field element or a fixed two-limb encoding required by the pinned backend; the flattened total MUST be at most 32 public inputs. Variable-sized details are opened privately against commitments.

```text
1  proofSchema             = NOCT_GLOBAL_ROOT_PROOF_V1
2  velaApplicationID       = actual Vela int64 deployment ID
3  chainID                 = actual Vela deployment-chain EIP-155 ID
4  circuitID
5  vkHash
6  configCommitment
7  oracleCommitment
8  oldAppRoot
9  newAppRoot
10 transitionID
11 requestCommitment
12 actorsCommitment
13 noncesCommitment
14 receiptSettlementCommitment
15 operationExpiryCommitment
16 transitionCommitment
```

Commitment preimages are domain-separated:

```text
requestCommitment = H(NOCT_REQUEST_V1 || velaRequestID || velaRequestType ||
                      expectedOldVelaRoot || payloadHash)
actorsCommitment = H(NOCT_ACTORS_V1 || caller || account || counterparty || destination)
noncesCommitment = H(NOCT_NONCES_V1 || oldAccountNonce || newAccountNonce ||
                     oldVelaAppNonce || expectedNewVelaAppNonce)
receiptSettlementCommitment = H(NOCT_RECEIPT_SETTLEMENT_V1 || receiptID || operationID ||
                                settlementID || withdrawalCommitment)
operationExpiryCommitment = H(NOCT_OPERATION_EXPIRY_V1 || operationID || createdAt || expiresAt || oracleEpoch)
transitionCommitment = H(NOCT_TRANSITION_V1 || canonical transition inputs and economic deltas)
```

A zero value is allowed only where the transition schema declares a field inapplicable. The circuit still hashes the canonical zero-bearing preimage; verifiers MUST NOT omit or reorder inputs.

## Atomic update rule

The Noct WASM receives prior app state and returns a single `ProcessResult` containing the complete new state and any withdrawals. It MUST:

1. verify the current `appRoot` by reserializing `GlobalRootStateV1`;
2. authenticate the Vela request context and exact application/account nonces;
3. compute all affected leaves, subroots and the new `appRoot`;
4. verify all economic, receipt, operation and monotonicity invariants;
5. place the new canonical state and matching `appRoot` in `ProcessResult.State` and any transfers in `ProcessResult.Withdrawals`.

Failure returns an error with no new state or withdrawals. There is no guest call to `vela.SaveState`, no custom state-root contract, and no separate withdrawal-submission API. Vela encrypts and persists the returned state, computes its own SHA256 encrypted-state root, and authorizes its state update through the Vela contracts.

## Required tests

Golden vectors MUST cover:

1. every leaf, empty root, subroot and `GlobalRootStateV1` serialization;
2. maximum U256 values, leading-zero rejection and RAY index/scaled-debt rounding;
3. all transition root changes, including repayment and liquidation prepare, capture, commit and pre-capture expiry;
4. consumed-receipt and history append-only membership;
5. wrong Vela `applicationId`, chain, request ID, old Vela root, app nonce or old `appRoot`;
6. proof public-input flattening remaining at or below 32 for the pinned UltraHonk backend;
7. explicit rejection when the Vela encrypted-state root is substituted for `appRoot`.