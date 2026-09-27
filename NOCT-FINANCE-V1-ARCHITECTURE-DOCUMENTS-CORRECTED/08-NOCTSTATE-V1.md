# 8. NoctState V1 (Multi-Collateral)

**Status:** Implementation architecture baseline - MULTI-COLLATERAL  
**Audience:** Noct Finance team (Alex, Daniel), Vela acceleration team, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Logical state

```text
NoctStateV1
├── GlobalState
├── ReserveState[USDC, ETH, ZEN]
├── OracleState
├── ProtocolConfig
├── CommitmentState
├── PrivateAccountState
├── PendingOperationState
└── ReceiptState
```

Every persisted state object MUST have one canonical serialization. Financial values and indexes are encoded as exactly 32 unsigned big-endian bytes. Encodings with another width, a sign byte, leading data, or a value outside `0..2^256-1` MUST be rejected rather than normalized.

## Numeric types and units

| Type | Unit | Use |
|---|---|---|
| `AmountWad` | WAD (`10^18`) | USDC, ZEN and ETH token amounts |
| `PriceWad` | WAD (`10^18`) | USD price per whole token |
| `RatioWad` | WAD (`10^18`) | LTV, liquidation threshold, bonus and close factor |
| `RateRay` | RAY (`10^27`) | annual borrow rates and utilization |
| `IndexRay` | RAY (`10^27`) | reserve borrow indexes |
| `ScaledDebt` | RAY-scaled debt shares | account and reserve scaled debt |
| `UsdWad` | WAD (`10^18`) | USD accounting quantities such as written-off bad debt |

All table entries above are U256 values on the wire and in persistent state. `uint64` is permitted only for non-financial counters and time metadata such as nonce, version, epoch and Unix timestamp.

The Go implementation MUST use an audited, TinyGo-compatible, checked U256 implementation with full-width `mulDivDown` and `mulDivUp`. Financial code MUST NOT use Go `uint64`, `int`, `float32`, `float64`, `math/big`, unchecked multiplication, or a TinyGo overflow panic as an arithmetic policy. Every add, subtract, conversion and multiplication MUST return and handle overflow or underflow explicitly.

## Custody decimal boundary (SPEC-02 — normative)

All internal accounting is WAD. Custody tokens are **not** all 18-decimal: `nativeDecimals[USDC] = 6`
while `nativeDecimals[ETH] = nativeDecimals[ZEN] = 18` (File 10). Every amount that crosses between
the protocol ledger and a token contract therefore crosses a decimal boundary. That boundary was
previously undefined, and File 33 listed non-18-decimal assets as a *future* extension while V1
already ships USDC. This section is the single normative definition; Files 11, 12, 17, 18 and 21
reference it and MUST NOT define their own.

```text
quantum[a] = 10 ^ (18 - nativeDecimals[a])       # WAD per whole native unit

# USDC: quantum = 10^12   ETH: quantum = 1        ZEN: quantum = 1
```

Three conversion primitives, all checked:

```text
nativeToWad(n, a)   = checkedMul(n, quantum[a])
                      # exact and injective; reverts on overflow

wadToNative(w, a)   = w / quantum[a]
                      # floor division; EXACT only when w mod quantum[a] == 0

quantizeDown(w, a)  = checkedMul(w / quantum[a], quantum[a])
                      # largest native-representable WAD value <= w
```

**Quantization rule.** Any WAD amount that will cross a custody boundary MUST be quantized with
`quantizeDown` **at the point it is computed**, before it is stored in a pending operation, an
inbound receipt or a `ProcessResult.Withdrawals` entry. Specifically:

| Boundary | Direction | Rule |
|---|---|---|
| Deposit / repay / liquidation-payment receipt | native → WAD | `nativeToWad`; exact, no rounding choice |
| `T02` cash withdrawal | WAD → native | request amount MUST already satisfy `w mod quantum[a] == 0`; reject otherwise |
| `T06` borrowed withdrawal | WAD → native | same as `T02` |
| `T05` borrow amount | WAD (internal) | MUST satisfy `amount mod quantum[a] == 0` so it is later withdrawable |
| `T09` `collateralToWithdraw` | WAD → native | `quantizeDown` applied to `collateralWithBonus` before the `min` clamp |
| `T13` bad-debt absorption | internal only | no boundary crossing; no quantization |

Because every boundary-crossing value is a whole multiple of `quantum[a]`, `wadToNative` is exact at
every emission and **no sub-quantum dust can accumulate in a ledger balance**. This is what makes the
File 11 custody conservation equation dimensionally well-formed.

**Dust ownership.** `quantizeDown` on a liquidation seizure rounds in the **borrower's** favour: the
liquidator receives up to one native quantum less than the bonus-implied amount. For USDC that is at
most `10^-6` USDC. This direction is deliberate — it can never cause the protocol to emit more value
than it seized — and the residual stays in `borrower.collateral[collateralAsset]`. Rounding a
withdrawal **up** is prohibited everywhere because it would emit tokens the protocol does not hold.

**Full-repayment quoting.** Accrued interest makes `currentDebt` an arbitrary WAD value that need not
be native-representable, so a captured payment cannot match it exactly. Full repayment therefore
quotes

```text
fullRepayPayment = roundUpToQuantum(mulDivUp(scaledDebt[a], borrowIndex[a], RAY), a)
                 = checkedMul((w + quantum[a] - 1) / quantum[a], quantum[a])
```

and commit clears **all** scaled debt for that asset. The borrower overpays by strictly less than one
native quantum; that excess is captured into `reserve[a].availableLiquidity`. This is bounded,
protocol-favouring, and guarantees the position can always be fully cleared despite RAY/WAD rounding.

**Prohibitions.** Native units MUST NEVER be stored in a WAD-typed field or compared against one.
`10^12` MUST NOT appear as a literal in transition logic; it is derived only from committed
`nativeDecimals`. A deployment MUST assert each token's on-chain `decimals()` equals its committed
`nativeDecimals` value and MUST fail otherwise. `18:54` normalizes oracle *prices* to WAD
independently of this section; price normalization and amount quantization are unrelated conversions
and MUST NOT share a scale factor.


## Asset identifiers

```text
AssetID enum:
  USDC = 0
  ETH  = 1
  ZEN  = 2
```

All multi-asset maps use AssetID as key. String representations use the asset symbol for JSON serialization.

## Private account (Multi-Asset)

```text
PrivateAccount {
    address                  [20]byte
    
    // Per-asset balances (sparse maps)
    cash                     map[AssetID]AmountWad
    collateral               map[AssetID]AmountWad
    borrowed                 map[AssetID]AmountWad
    scaledDebt               map[AssetID]ScaledDebt
    
    positionNonce            uint64
    lastUpdateTimestamp      uint64
}
```

**Multi-Asset Semantics:**
- `cash[asset]` - deposited but not yet supplied as collateral
- `collateral[asset]` - supplied as collateral, contributes to health factor
- `borrowed[asset]` - borrowed amount still held in Vela custody (not withdrawn)
- `scaledDebt[asset]` - debt shares for accrual, per-asset

Users may have any combination of collateral and debt across USDC, ETH, and ZEN.

For each debt asset `a`:

```text
accountDebt(a) = mulDivUp(account.scaledDebt[a], reserve.borrowIndex[a], RAY)
totalDebt(a)   = mulDivUp(reserve.totalScaledDebt[a], reserve.borrowIndex[a], RAY)
```

Rounding debt upward prevents a borrower from escaping a fractional obligation. The reserve aggregate MUST be derived from `totalScaledDebt`; it MUST NOT be maintained as a separately rounded sum of account debts.

## Reserve state (Per-Asset)

```text
ReserveState {
    asset                    AssetID (USDC | ETH | ZEN)
    availableLiquidity       AmountWad
    totalScaledDebt          ScaledDebt
    borrowIndex              IndexRay
    lastAccrualTimestamp     uint64
    writtenOffDebtUsd        UsdWad
}
```

`writtenOffDebtUsd` is the cumulative USD value of debt absorbed from this reserve by
`T13 ABSORB_BAD_DEBT` (File 12). It is an **accounting quantity, not a token balance**: it MUST NOT be
added to `Ledger[a]`, MUST NOT appear in the File 11 custody equation, and MUST NOT be withdrawable.
It exists so absorbed loss is measurable, and it is committed in `reserveRoot` (File 09). It is
monotonic non-decreasing.

V2.0 has three independent reserves: `reserves[USDC]`, `reserves[ETH]`, `reserves[ZEN]`.

Each reserve accrues independently. `borrowIndex` starts at `RAY` and is monotonic per reserve. Reserve semantics and custody equations are normative in File 11; accrual is normative in File 19.

## Oracle state interface (Multi-Asset)

```text
OracleState {
    latestAcceptedEpoch      uint64
    latestAcceptedTimestamp  uint64
    adapterBlockTimestamp    uint64
    prices                   map[AssetID]PriceWad
    oracleCommitment         [32]byte
}
```

**Multi-Asset Prices:**
- `prices[USDC]` - USD price per USDC (typically ~$1.00)
- `prices[ETH]` - USD price per ETH
- `prices[ZEN]` - USD price per ZEN

Risk-sensitive transitions MUST read the latest accepted authenticated `OracleState` from trusted state. A transaction caller MUST NOT select an older epoch or supply a signature or price snapshot for transition-local verification. Oracle authentication and acceptance are outside this file; this interface only defines what lending logic consumes.

## Pending operations and receipts (Multi-Asset)

```text
PendingOperation {
    operationID              [32]byte
    kind                     REPAY | LIQUIDATION
    status                   PREPARED | PAYMENT_CAPTURED | COMMITTED | EXPIRED
    account                  [20]byte
    debtAsset                AssetID        // asset being repaid/liquidated
    collateralAsset          AssetID        // asset being seized (liquidation only)
    paymentAmount            AmountWad
    scaledDebtReduction      ScaledDebt
    collateralToWithdraw     AmountWad      // liquidation only
    destination              [20]byte
    oracleEpoch              uint64         // liquidation quote only
    quoteIndex               IndexRay       // borrow index at preparation
    createdAt                uint64
    expiresAt                uint64         // applies only before payment capture
}

InboundReceipt {
    receiptID                [32]byte
    asset                    AssetID (USDC | ETH | ZEN)
    amount                   AmountWad
    purpose                  DEPOSIT | RESERVE_FUNDING | REPAY | LIQUIDATION
    operationID              [32]byte
    beneficiary              [20]byte
    status                   PENDING | CAPTURED | CONSUMED
}
```

**Multi-Asset Changes:**
- `debtAsset` specifies which asset's debt is being repaid/liquidated
- `collateralAsset` specifies which asset is seized in liquidation (cross-asset supported)
- `asset` in receipts now covers USDC, ETH, and ZEN

Receipt identity MUST bind the source chain, custody endpoint, transaction/log identity, asset, amount, sender, purpose and operation ID as applicable. Confirmed receipts enter `PENDING` or `CAPTURED` through the trusted Vela/on-chain integration, never through untrusted user assertions.

Receipt consumption is single-use and atomic with its accounting effect. `CONSUMED` receipt IDs and `COMMITTED` operation IDs are retained in append-only replay-protection state. A repeated commit returns the original successful result and MUST NOT mutate balances or emit another withdrawal.

## Global/public state

```text
GlobalState {
    schemaVersion            uint64
    protocolVersion          uint64
    stateVersion             uint64
    velaApplicationID        int64
    chainID                  uint64
    governanceIdentity       [20]byte
    accountRoot              [32]byte
    reserveRoot              [32]byte
    pendingOperationRoot     [32]byte
    consumedReceiptRoot      [32]byte
    historyRoot              [32]byte
    configCommitment         [32]byte
    oracleCommitment         [32]byte
    latestOracleEpoch        uint64
    latestOracleTimestamp    uint64
    protocolBadDebtUsd       UsdWad
}
```

**SPEC-11 remediation.** `GlobalState` is a **derived view** of File 09's `GlobalRootStateV1` and has
exactly the same fields, in the same order, with the same types and the same names. File 09 is
normative; this listing exists so that File 08 can be read alone without inventing a second schema.

Two field names in the previous version were superseded and MUST NOT be used:

| Superseded | Replacement | Reason |
|---|---|---|
| `positionRoot` | `accountRoot` | File 09 commits five distinct subroots; a single `positionRoot` cannot name them and collided with `accountRoot`. |
| `stateCommitment` | `appRoot` (computed, not stored) | `appRoot` is the hash **of** `GlobalRootStateV1`. Storing it inside the structure it hashes is self-referential and unserializable. |

`velaApplicationID` and `chainID` were previously absent here while being mandatory in File 09 and
being proof public inputs 2 and 3 (`09:149-150`); an implementation following this file alone would
have produced a state structure that cannot satisfy the public-input schema.

`stateVersion` increments exactly once for every committed state transition. Account nonces increment exactly once for each accepted user-authorized request; authenticated retry of an already committed operation does not increment it again.


## Derived values — do not store

The following are computed from the current indexes, latest accepted `OracleState`, and committed configuration:

- current account and reserve debt (per-asset);
- collateral and debt USD values (per-asset);
- weighted collateral USD (aggregate across all collateral assets);
- weighted debt USD (aggregate across all debt assets);
- health factor and borrowing capacity;
- liquidation eligibility;
- utilization and current borrow rate (per-reserve).

Pending-operation quote values are stored because they lock an authorized cross-contract operation; they are not alternate sources of current account debt.

## Required state invariants

After every successful transition:

1. `reserve.totalScaledDebt[a] = Σ account.scaledDebt[a]` for each asset a ∈ {USDC, ETH, ZEN}.
2. `reserve.borrowIndex[a] >= RAY` and never decreases for each reserve.
3. No financial subtraction underflows and no U256 operation overflows.
4. Every captured inbound receipt is pending consumption by exactly one purpose, or is already consumed.
5. Every emitted but unsettled withdrawal is represented by Vela's pending outbound accounting.
6. Consumed receipt IDs and committed operation IDs cannot return to an earlier status.
7. `stateVersion`, account nonce, accepted oracle epoch/timestamp, and reserve accrual timestamp are monotonic under their transition rules.
8. The custody conservation equations in File 11 hold for USDC, ETH and ZEN.
9. **Two-gate separation (SPEC-01).** For every position with debt:
   `ltvCollateralUsd >= weightedDebtUsd` for any account whose last risk-increasing transition
   (T04, T05) succeeded, and a position is liquidatable only when
   `thresholdCollateralUsd < weightedDebtUsd`. Because
   `collateralFactorWad[a] < liquidationThresholdWad[a]` for every asset, no position satisfies both
   conditions simultaneously as a result of a single successful transition.
10. **Boundary quantization (SPEC-02).** Every amount stored in a pending operation, an inbound
    receipt or a `ProcessResult.Withdrawals` entry satisfies `amount mod quantum[asset] == 0`, where
    `quantum[asset] = 10^(18 - nativeDecimals[asset])`. No sub-quantum value may ever reach a custody
    boundary.
11. **Bad-debt monotonicity.** `reserve.writtenOffDebtUsd[a]` and `protocolBadDebtUsd` never decrease,
    and neither is included in `Ledger[a]` or the custody equation.
12. **Commitment reachability (SPEC-03, N-1).** Every persisted field of every `PrivateAccount` and
    every `ReserveState` — for all three assets — is reachable from exactly one subroot and therefore
    from `appRoot`. No economic field exists outside the commitment tree.

A transition that cannot prove all applicable invariants MUST fail without partial state mutation or withdrawal emission.

