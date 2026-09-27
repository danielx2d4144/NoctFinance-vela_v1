# 11. Asset & Reserve Model V1 (Multi-Collateral)

**Status:** Implementation architecture baseline - MULTI-COLLATERAL  
**Audience:** Noct Finance team (Alex, Daniel), Vela acceleration team, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## V1 roles (Multi-Asset)

| Asset | User deposit | User supply | Borrow | V1 role |
|---|---:|---:|---:|---|
| USDC | yes | yes (collateral) | yes | Multi-purpose |
| ETH | yes | yes (collateral) | yes | Multi-purpose |
| ZEN | yes | yes (collateral) | yes | Multi-purpose |

**V1 Design:** All three assets can be both collateral AND borrow assets. Users may:
- Deposit USDC and supply as collateral to borrow ETH
- Deposit ETH and supply as collateral to borrow USDC
- Mix collateral (e.g., USDC + ETH collateral backing ZEN debt)
- Mix debt (e.g., borrow both ETH and USDC against USDC collateral)

Noct-funded USDC, ETH, and ZEN liquidity is frozen for V1. There is no user supplier principal, supplier index or supplier yield accounting.

## Numeric model

Every amount, price, rate, index and scaled-debt quantity is a checked U256 and is encoded as a canonical 32-byte unsigned big-endian value. Token amounts use WAD, prices use WAD, and indexes and interest rates use RAY. `uint64` is restricted to timestamps, versions, epochs and nonces.

Financial Go code MUST use an audited TinyGo-compatible checked U256 and full-width `mulDivDown`/`mulDivUp`. It MUST NOT use native integer financial arithmetic, `math/big`, floating-point, or unchecked intermediate products.

## Reserve state (Multi-Asset)

```text
Reserve {
    asset                    AssetID (USDC | ETH | ZEN)
    availableLiquidity       AmountWad
    totalScaledDebt          ScaledDebt
    borrowIndex              IndexRay
    lastAccrualTimestamp     uint64
    writtenOffDebtUsd        UsdWad
}
```

`writtenOffDebtUsd` is the cumulative USD value of debt absorbed from this reserve by
`T13 ABSORB_BAD_DEBT` (File 12). It is an accounting quantity only: it is **excluded** from
`Ledger[a]` and from the custody equation below, because it represents value the protocol no longer
holds. It is monotonic non-decreasing and is committed in `reserveRoot` (File 09).


V1 has three independent reserves:
- `reserves[USDC]`
- `reserves[ETH]`
- `reserves[ZEN]`

At genesis, for each reserve: `borrowIndex = RAY` and `totalScaledDebt = 0`. No separate `totalPrincipal`, `allocated`, or interest receivable counter exists.

```text
currentTotalDebt[asset] = mulDivUp(totalScaledDebt[asset], borrowIndex[asset], RAY)
```

The account and reserve updates for a borrow of `amount` in `asset`:

```text
scaledDelta = mulDivUp(amount, RAY, borrowIndex[asset])
account.scaledDebt[asset] += scaledDelta
reserve[asset].totalScaledDebt += scaledDelta
reserve[asset].availableLiquidity -= amount
account.borrowed[asset] += amount
```

A borrow MUST fail on zero amount, arithmetic error, insufficient reserve liquidity, an amount that is
not a whole multiple of `quantum[asset]` (File 08), or a post-state violation of the **LTV gate**
(`postLtvCollateralUsd < postWeightedDebtUsd`). The LTV gate uses `collateralFactorWad` and is
strictly tighter than the liquidation gate, which uses `liquidationThresholdWad`; the two MUST NOT be
conflated (File 12, SPEC-01). Interest rounding may make derived debt slightly greater than the borrowed amount; this is intentional and conservative.

For repayment amount `amount` of `asset` at the committed index:

```text
currentDebt = mulDivUp(account.scaledDebt[asset], borrowIndex[asset], RAY)
```

- Full repayment captures exactly the quoted full-debt amount and clears all account scaled debt for that asset.
- Partial repayment requires `amount < currentDebt` and computes `scaledReduction = mulDivDown(amount, RAY, borrowIndex[asset])`.
- A partial repayment with `scaledReduction = 0` MUST be rejected.
- Commit subtracts the same `scaledReduction` from the account and reserve and adds the captured token amount to available liquidity.

Debt MUST NOT be reduced merely because a user requested, approved, or prepared a repayment. File 12 defines the receipt-driven commit protocol.

## Vela custody model

USDC, ZEN and ETH are held through the actual Vela application custody path. No parallel `ReserveManager` balance ledger is part of the V1 accounting model. Noct state describes beneficial allocation of assets already controlled by Vela; blockchain-facing transfers are represented by authenticated inbound receipts and `ProcessResult.Withdrawals`.

A `ProcessResult.Withdrawals` entry MUST bind at least the operation/withdrawal ID, asset, amount and destination. The Vela runtime is responsible for executing and deduplicating that withdrawal according to the pinned Vela version. Noct MUST retain enough pending-outbound identity to reconcile execution without emitting a duplicate.

### V1 reserve funding

1. The Noct funding authority transfers USDC, ETH or ZEN into the Vela custody endpoint.
2. The trusted integration observes finality and creates an authenticated reserve-funding receipt.
3. Noct consumes that receipt exactly once and increases `availableLiquidity` by its amount.
4. Duplicate delivery returns the prior result and cannot fund the reserve twice.

### Borrow and withdrawal

A borrow reallocates custody from `availableLiquidity` to the borrower's private `borrowedZEN` or `borrowedETH`; no external transfer occurs at that point. The borrower may later request a simple native withdrawal. That transition atomically debits the private borrowed balance and emits one `ProcessResult.Withdrawals` entry. Debt is unchanged by withdrawal.

### Repayment and liquidation inflow

A repayment or liquidation payment first enters Vela custody through the authenticated trigger/escrow path and receives a unique inbound receipt. Only idempotent `COMMIT_REPAY` or `COMMIT_LIQUIDATION` consumes the receipt, reduces scaled debt and increases reserve liquidity. Captured funds are never timeout-refunded by Noct; commit is retried to completion.

## Conservation variables (Multi-Asset)

For each asset `a` ∈ {USDC, ETH, ZEN}, define:

- `Custody[a]`: actual finalized amount held for the Noct Vela application;
- `PendingInbound[a]`: finalized custody receipts not yet consumed into ledger balances;
- `PendingOutbound[a]`: emitted Vela withdrawals not yet finalized out of custody;
- `Ledger[a]`: committed internal beneficial balances.

```text
Ledger[USDC] =
    Σ account.cash[USDC]
  + Σ account.collateral[USDC]
  + reserve[USDC].availableLiquidity
  + Σ account.borrowed[USDC]

Ledger[ETH] =
    Σ account.cash[ETH]
  + Σ account.collateral[ETH]
  + reserve[ETH].availableLiquidity
  + Σ account.borrowed[ETH]

Ledger[ZEN] =
    Σ account.cash[ZEN]
  + Σ account.collateral[ZEN]
  + reserve[ZEN].availableLiquidity
  + Σ account.borrowed[ZEN]
```

**Multi-Asset Note:** Each asset has its own independent custody and ledger. A user with USDC cash + ETH collateral + ZEN debt contributes to all three asset ledgers.

Locks only restrict spendability; they do not add a second beneficial balance and therefore do not appear again in `Ledger`.

At every reconciled point, including between emission and external execution:

```text
Custody[a] = Ledger[a] + PendingInbound[a] + PendingOutbound[a]
```

for each asset a ∈ {USDC, ETH, ZEN}.

**Unit domain (SPEC-02).** All four terms are expressed in **WAD**, never in native token units. A
custody balance observed on-chain in native units is brought into this equation only through
`nativeToWad(balance, a)` as defined in File 08, which is exact and injective because
`nativeDecimals[a] <= 18`. Conversely, a `PendingOutbound[a]` term is emitted as
`wadToNative(amount, a)`, which is exact because every boundary-crossing amount is quantized at the
point of computation. Mixing domains — comparing a 6-decimal USDC balance against an 18-decimal WAD
ledger — would make this equation false by a factor of `10^12` and is the specific failure mode File
08's quantization rule exists to prevent.

`writtenOffDebtUsd` is **not** a term in this equation. Bad debt is value the protocol no longer
holds; including it would falsely inflate `Ledger[a]` and mask a custody mismatch.


Interpretation:

- when finalized funds arrive, `Custody` and `PendingInbound` rise together;
- when an inbound receipt is consumed, `PendingInbound` falls and the appropriate ledger balance rises by the same amount;
- when a withdrawal is emitted, its ledger balance falls and `PendingOutbound` rises atomically;
- when Vela finalizes the withdrawal, `Custody` and `PendingOutbound` fall together.

Reconciliation MUST halt affected transitions and alert on any mismatch. It MUST NOT invent a balancing entry.

## Debt and liquidity invariants (Multi-Asset)

For each asset `a` ∈ {USDC, ETH, ZEN}:

```text
reserve[a].totalScaledDebt = Σ account.scaledDebt[a]
reserve[a].availableLiquidity <= Ledger[a]
currentTotalDebt[a] = mulDivUp(
    reserve[a].totalScaledDebt,
    reserve[a].borrowIndex,
    RAY)
```

`availableLiquidity[a]` is the amount currently lendable for asset `a`, not custody balance and not total assets. Current debt is a receivable and is not included in token custody. Accrued interest increases current debt through the index but does not increase available liquidity until tokens are actually captured and committed.

Reserve liquidity MUST never underflow for any asset. A new borrow of asset `a` is rejected if `amount > availableLiquidity[a]`. Reserve exhaustion affects only new borrows of that specific asset; deposits, repayments and permitted withdrawals of other assets continue according to their own checks.

## Rounding and reserve reconciliation

Reserve aggregate debt is calculated once from aggregate scaled debt per asset. It may differ by a few wei from the sum of individually rounded account debts. That expected rounding difference MUST NOT be booked as custody or liquidity.

All scaled-debt mutations update the account and `totalScaledDebt[asset]` by exactly the same scaled quantity in one transition. Full repayment uses the account's entire scaled balance for that asset, which guarantees eventual clearing despite prior rounding. Partial reductions round down and must be nonzero.

## Required monitoring (Multi-Asset)

Implementations SHOULD alert on:

- custody conservation mismatch for any asset (USDC, ETH, or ZEN);
- `totalScaledDebt[a]` mismatch with account state for any asset;
- reserve utilization above 80% and 95% for any reserve;
- captured inbound receipts awaiting commit;
- emitted withdrawals awaiting Vela finality;
- borrow-index or timestamp regression in any reserve;
- repeated arithmetic or accrual-bound failures;
- cross-asset liquidation failures or starvation.
