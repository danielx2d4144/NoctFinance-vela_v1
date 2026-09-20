# 19. Interest Accrual

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## V1 design

V1 uses one lazy borrow index per ZEN and ETH reserve and the utilization kink model frozen in File 10. There is no fixed configured borrow rate and no account principal/entry-index accounting.

```text
Reserve {
    availableLiquidity       AmountWad
    totalScaledDebt          ScaledDebt
    borrowIndex              IndexRay
    lastAccrualTimestamp     uint64
}
```

At reserve creation:

```text
borrowIndex = RAY
lastAccrualTimestamp = latest accepted OracleState timestamp
```

An account stores only scaled debt:

```text
currentAccountDebt = mulDivUp(accountScaledDebt, borrowIndex, RAY)
currentTotalDebt   = mulDivUp(totalScaledDebt, borrowIndex, RAY)
```

## Numeric requirements

```text
WAD  = 1_000_000_000_000_000_000
RAY  = 1_000_000_000_000_000_000_000_000_000
YEAR = 31_536_000 seconds
```

Token amounts and prices use WAD. Borrow indexes, utilization and annual borrow rates use RAY. Every financial quantity is a U256 encoded as exactly 32 unsigned big-endian bytes. Timestamps are `uint64` Unix seconds.

The Go implementation MUST use an audited TinyGo-compatible checked U256 library with full-width `mulDivDown(a,b,d)` and `mulDivUp(a,b,d)`. It MUST NOT use native integer financial arithmetic, `math/big`, floating-point, unchecked products, or overflow panic behavior. Division by zero and every overflow/underflow are explicit transition errors.

Definitions:

```text
mulDivDown(a, b, d) = floor(a × b / d)
mulDivUp(a, b, d)   = ceil(a × b / d)
                      = 0 when a = 0 or b = 0
```

The multiplication is evaluated at full double width before division. Implementations MUST NOT emulate `mulDiv` with a checked U256 multiplication that can reject a mathematically representable quotient.

## Utilization

At the beginning of each accrual chunk, derive current aggregate debt from the chunk's current index:

```text
currentDebt = mulDivUp(totalScaledDebt, borrowIndex, RAY)
denominator = availableLiquidity + currentDebt

if denominator = 0:
    utilization = 0
else:
    utilization = mulDivDown(currentDebt, RAY, denominator)
```

Thus:

```text
utilization = currentDebt / (availableLiquidity + currentDebt)
```

Utilization is rounded down and lies in `0..RAY`. Accrued interest is a receivable; it increases `currentDebt` through the index but does not increase `availableLiquidity` until repayment tokens are captured and committed.

## Frozen V1 kink rate

Using the RAY values from File 10:

```text
if utilization <= optimalUtilization:
    annualRate = baseRatePerYear
               + mulDivDown(utilization, multiplierPerYear, RAY)
else:
    annualRate = baseRatePerYear
               + mulDivDown(optimalUtilization, multiplierPerYear, RAY)
               + mulDivDown(
                     utilization - optimalUtilization,
                     jumpMultiplierPerYear,
                     RAY)
```

Each slope contribution rounds down. Additions are checked. The rate at exactly the kink uses the first branch and equals the continuous value of the second branch.

Frozen examples:

| Utilization | Annual borrow rate |
|---:|---:|
| 0% | 2% |
| 50% | 7% |
| 80% | 10% |
| 90% | 30% |
| 100% | 50% |

These examples are assertions for tests, not floating-point implementation guidance.

## Deterministic linear index update

For chunk duration `dt` seconds and the rate calculated at the beginning of that chunk:

```text
rateTime = checkedMul(annualRate, U256(dt))
indexDelta = mulDivDown(
    borrowIndex,
    rateTime,
    RAY × YEAR)
newBorrowIndex = checkedAdd(borrowIndex, indexDelta)
```

This is deterministic linear, non-compounding-within-the-chunk interest. Successive chunks naturally compound because each starts from the prior chunk's index. `indexDelta` rounds down. Account and aggregate debt calculations round up.

`RAY × YEAR` is a checked, canonical constant. The implementation MUST reject a configured rate for which `annualRate × maxAccrualChunkSeconds` cannot be represented as U256, even though the final `mulDiv` itself uses a full-width numerator.

## Bounded chunk calculation

V1 freezes:

```text
maxAccrualChunkSeconds = 86_400
maxAccrualChunksPerTransition = 4_096
```

To accrue from `lastAccrualTimestamp` to target timestamp `t`:

1. Reject `t < lastAccrualTimestamp`.
2. Let `remaining = t - lastAccrualTimestamp` using checked `uint64` timestamp subtraction.
3. Compute `requiredChunks = ceil(remaining / maxAccrualChunkSeconds)` without overflow.
4. Reject before mutation if `requiredChunks > maxAccrualChunksPerTransition`.
5. While `remaining > 0`, set `dt = min(remaining, maxAccrualChunkSeconds)`.
6. Recompute current debt, utilization and annual rate from the current chunk state.
7. Apply the linear update above and advance the working timestamp by `dt`.
8. Commit the final index and timestamp only after every chunk succeeds.

Recomputing utilization per bounded chunk makes results independent of host scheduling and bounds rate-time intermediates. A failed calculation leaves the reserve unchanged. The 4,096-chunk cap bounds worst-case execution; exceeding it is an exceptional stale-state condition requiring an explicit versioned recovery procedure, not silent truncation.

## Lazy accrual ordering

No account-by-account block accrual occurs. Accrue an affected reserve at the start of every transition that reads or mutates its debt, including:

- borrow;
- repay preparation;
- liquidation preparation;
- collateral release and other position risk checks;
- explicit reserve maintenance.

For a risk check involving both ZEN and ETH debt, accrue both reserves to the same latest accepted `OracleState` timestamp before valuation. Repay and liquidation commit use the scaled reduction locked at preparation and do not re-quote it; other reserve activity may have advanced the index in the meantime.

The transaction's target accrual timestamp is the timestamp in the latest accepted authenticated `OracleState`. A caller cannot provide an alternate timestamp or oracle signature. Equal timestamps are valid and produce no index change.

## Borrow and repay conversion

After accrual, a borrow of `amount` creates:

```text
scaledDelta = mulDivUp(amount, RAY, borrowIndex)
```

Both account scaled debt and reserve total scaled debt increase by exactly `scaledDelta`.

For repayment preparation:

```text
currentDebt = mulDivUp(accountScaledDebt, borrowIndex, RAY)
```

- full repay: payment is the quoted `currentDebt`, and commit clears all scaled debt;
- partial repay: `scaledReduction = mulDivDown(paymentAmount, RAY, borrowIndex)`;
- partial reduction MUST be nonzero and payment MUST be less than current debt.

Both account scaled debt and reserve total scaled debt decrease by exactly the stored scaled reduction only after the authenticated payment receipt is captured and consumed.

## Rounding summary

| Calculation | Direction | Reason |
|---|---|---|
| Current account/reserve debt | up | do not understate obligations |
| Borrow scaled delta | up | debt covers amount borrowed |
| Partial repay scaled reduction | down | do not forgive more debt than paid |
| Full repay scaled reduction | exact all shares | guarantee debt can clear |
| Utilization | down | deterministic conservative rate input |
| Kink slope terms | down | deterministic configured curve |
| Index delta | down | never charge more than linear formula |
| USD debt valuation | up | conservative risk check |
| USD collateral valuation | down | conservative risk check |

## Invariants and test vectors

After accrual:

```text
newBorrowIndex >= oldBorrowIndex >= RAY
newLastAccrualTimestamp = targetTimestamp
availableLiquidity is unchanged
totalScaledDebt is unchanged
reserve.totalScaledDebt = Σ account.scaledDebt
```

Tests MUST cover:

- zero liquidity and zero debt;
- zero liquidity with nonzero debt (100% utilization);
- exact kink utilization and one-unit values on each side;
- zero elapsed time, one second, one year, and multi-chunk intervals;
- chunk-boundary equivalence for the specified algorithm;
- U256 near-limit success and explicit overflow rejection;
- all rounding directions, including dust partial repayment rejection;
- full repayment clearing all scaled debt;
- timestamp regression and chunk-cap rejection with no partial mutation.
