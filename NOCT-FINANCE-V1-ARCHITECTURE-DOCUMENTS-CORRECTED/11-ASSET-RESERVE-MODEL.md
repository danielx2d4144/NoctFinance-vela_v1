# 11. Asset & Reserve Model

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## V1 roles

| Asset | User deposit | User supply | Borrow | V1 role |
|---|---:|---:|---:|---|
| USDC | yes | collateral only | no | cash and collateral |
| ZEN | repayment only | no | yes | Noct-funded borrow reserve |
| ETH | repayment only | no | yes | Noct-funded borrow reserve |

Noct-funded ZEN and ETH liquidity is frozen for V1. There is no user supplier principal, supplier index or supplier yield accounting.

## Numeric model

Every amount, price, rate, index and scaled-debt quantity is a checked U256 and is encoded as a canonical 32-byte unsigned big-endian value. Token amounts use WAD, prices use WAD, and indexes and interest rates use RAY. `uint64` is restricted to timestamps, versions, epochs and nonces.

Financial Go code MUST use an audited TinyGo-compatible checked U256 and full-width `mulDivDown`/`mulDivUp`. It MUST NOT use native integer financial arithmetic, `math/big`, floating-point, or unchecked intermediate products.

## Reserve state

```text
Reserve {
    asset                    ZEN | ETH
    availableLiquidity       AmountWad
    totalScaledDebt          ScaledDebt
    borrowIndex              IndexRay
    lastAccrualTimestamp     uint64
}
```

At genesis, `borrowIndex = RAY` and `totalScaledDebt = 0`. No separate `totalPrincipal`, `allocated`, or interest receivable counter exists.

```text
currentTotalDebt = mulDivUp(totalScaledDebt, borrowIndex, RAY)
```

The account and reserve updates for a borrow of `amount` are:

```text
scaledDelta = mulDivUp(amount, RAY, borrowIndex)
account.scaledDebt += scaledDelta
reserve.totalScaledDebt += scaledDelta
reserve.availableLiquidity -= amount
account.borrowedBalance += amount
```

A borrow MUST fail on zero amount, arithmetic error, insufficient reserve liquidity, or a post-state max-LTV violation. Interest rounding may make derived debt slightly greater than the borrowed amount; this is intentional and conservative.

For repayment amount `amount` at the committed index:

```text
currentDebt = mulDivUp(account.scaledDebt, borrowIndex, RAY)
```

- Full repayment captures exactly the quoted full-debt amount and clears all account scaled debt.
- Partial repayment requires `amount < currentDebt` and computes `scaledReduction = mulDivDown(amount, RAY, borrowIndex)`.
- A partial repayment with `scaledReduction = 0` MUST be rejected.
- Commit subtracts the same `scaledReduction` from the account and reserve and adds the captured token amount to available liquidity.

Debt MUST NOT be reduced merely because a user requested, approved, or prepared a repayment. File 12 defines the receipt-driven commit protocol.

## Vela custody model

USDC, ZEN and ETH are held through the actual Vela application custody path. No parallel `ReserveManager` balance ledger is part of the V1 accounting model. Noct state describes beneficial allocation of assets already controlled by Vela; blockchain-facing transfers are represented by authenticated inbound receipts and `ProcessResult.Withdrawals`.

A `ProcessResult.Withdrawals` entry MUST bind at least the operation/withdrawal ID, asset, amount and destination. The Vela runtime is responsible for executing and deduplicating that withdrawal according to the pinned Vela version. Noct MUST retain enough pending-outbound identity to reconcile execution without emitting a duplicate.

### V1 reserve funding

1. The Noct funding authority transfers ZEN or ETH into the Vela custody endpoint.
2. The trusted integration observes finality and creates an authenticated reserve-funding receipt.
3. Noct consumes that receipt exactly once and increases `availableLiquidity` by its amount.
4. Duplicate delivery returns the prior result and cannot fund the reserve twice.

### Borrow and withdrawal

A borrow reallocates custody from `availableLiquidity` to the borrower's private `borrowedZEN` or `borrowedETH`; no external transfer occurs at that point. The borrower may later request a simple native withdrawal. That transition atomically debits the private borrowed balance and emits one `ProcessResult.Withdrawals` entry. Debt is unchanged by withdrawal.

### Repayment and liquidation inflow

A repayment or liquidation payment first enters Vela custody through the authenticated trigger/escrow path and receives a unique inbound receipt. Only idempotent `COMMIT_REPAY` or `COMMIT_LIQUIDATION` consumes the receipt, reduces scaled debt and increases reserve liquidity. Captured funds are never timeout-refunded by Noct; commit is retried to completion.

## Conservation variables

For asset `a`, define:

- `Custody[a]`: actual finalized amount held for the Noct Vela application;
- `PendingInbound[a]`: finalized custody receipts not yet consumed into ledger balances;
- `PendingOutbound[a]`: emitted Vela withdrawals not yet finalized out of custody;
- `Ledger[a]`: committed internal beneficial balances.

```text
Ledger[USDC] =
    Σ account.cashUSDC
  + Σ account.collateralUSDC

Ledger[ZEN] =
    reserveZEN.availableLiquidity
  + Σ account.borrowedZEN

Ledger[ETH] =
    reserveETH.availableLiquidity
  + Σ account.borrowedETH
```

Locks only restrict spendability; they do not add a second beneficial balance and therefore do not appear again in `Ledger`.

At every reconciled point, including between emission and external execution:

```text
Custody[a] = Ledger[a] + PendingInbound[a] + PendingOutbound[a]
```

Interpretation:

- when finalized funds arrive, `Custody` and `PendingInbound` rise together;
- when an inbound receipt is consumed, `PendingInbound` falls and the appropriate ledger balance rises by the same amount;
- when a withdrawal is emitted, its ledger balance falls and `PendingOutbound` rises atomically;
- when Vela finalizes the withdrawal, `Custody` and `PendingOutbound` fall together.

Reconciliation MUST halt affected transitions and alert on any mismatch. It MUST NOT invent a balancing entry.

## Debt and liquidity invariants

For each borrow asset `a`:

```text
reserve.totalScaledDebt[a] = Σ account.scaledDebt[a]
reserve.availableLiquidity[a] <= Ledger[a]
currentTotalDebt[a] = mulDivUp(
    reserve.totalScaledDebt[a],
    reserve.borrowIndex[a],
    RAY)
```

`availableLiquidity` is the amount currently lendable, not custody balance and not total assets. Current debt is a receivable and is not included in token custody. Accrued interest increases current debt through the index but does not increase available liquidity until tokens are actually captured and committed.

Reserve liquidity MUST never underflow. A new borrow is rejected if `amount > availableLiquidity`. Reserve exhaustion affects only new borrows; deposits, repayments and permitted withdrawals continue according to their own checks.

## Rounding and reserve reconciliation

Reserve aggregate debt is calculated once from aggregate scaled debt. It may differ by a few wei from the sum of individually rounded account debts. That expected rounding difference MUST NOT be booked as custody or liquidity.

All scaled-debt mutations update the account and `totalScaledDebt` by exactly the same scaled quantity in one transition. Full repayment uses the account's entire scaled balance, which guarantees eventual clearing despite prior rounding. Partial reductions round down and must be nonzero.

## Required monitoring

Implementations SHOULD alert on:

- custody conservation mismatch for any asset;
- `totalScaledDebt` mismatch with account state;
- reserve utilization above 80% and 95%;
- captured inbound receipts awaiting commit;
- emitted withdrawals awaiting Vela finality;
- borrow-index or timestamp regression;
- repeated arithmetic or accrual-bound failures.
