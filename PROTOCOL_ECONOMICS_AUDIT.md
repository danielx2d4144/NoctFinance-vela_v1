# NoctFinance V1 — Protocol Economics & System Invariants Audit

> **HISTORICAL AUDIT SNAPSHOT.** Preserve this file as evidence of earlier findings, but do not implement its proposed principal/entry-index model. Corrected scaled-debt economics and invariants are normative in `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/` Files 08, 10–12, and 19.

**Author:** Lead Systems & DeFi Architect  
**Date:** 2026-09-19  
**Status:** Pre-Implementation Decision Package  
**Target:** ~1800 words

---

## Executive Summary

This audit reveals **critical architectural gaps** in NoctFinance V1 lending mechanics, particularly around reserve funding, interest accrual implementation, and liquidation parameters. While the state machine semantics are well-defined, the **economic model is incomplete**: users deposit USDC but borrow ZEN/ETH from undefined reserves, interest accrual lacks account-level schema support, and all liquidation parameters remain marked `OPEN`.

**Critical findings:**
1. Reserve funding mechanism undefined — no specification for how protocol-funded ZEN/ETH reserves interact with user borrows
2. Account state schema lacks `entryBorrowIndex` or `scaledDebt` fields required for index-based interest accrual
3. All liquidation parameters (threshold, bonus, close factor, bad-debt waterfall) explicitly marked `OPEN` and must not be invented
4. No fixed-point precision standard defined (e.g., 18 decimals)
5. Deterministic time source unspecified (Vela WASM cannot use `time.Now()`)

---

## 1. Canonical Balance & Reserve Model

### 1.1 User State Definitions

Per `08-NOCTSTATE-V1.md` and `02-NOCT_STATE_MACHINE.md`:

```
PrivateAccount {
    cashUSDC          // Deposited but not supplied
    collateralUSDC    // Supplied as collateral
    
    borrowedZEN       // ZEN credited but not withdrawn
    borrowedETH       // ETH credited but not withdrawn
    
    debtZEN           // Outstanding ZEN liability
    debtETH           // Outstanding ETH liability
}
```

**Critical distinction (file 11, line 40-48):**
```
reserve liquidity ≠ borrowed balance ≠ debt
```

If Alice borrows 20 ZEN and withdraws it:
- `borrowedZEN = 0` (withdrawn)
- `debtZEN = 20` (liability persists)

### 1.2 Reserve Structure

Per `11-ASSET-RESERVE-MODEL.md`:

```
ZENReserve {
    availableLiquidity      // Unallocated pool funds
    totalDebtPrincipal      // Sum of all user debt principals
    borrowIndex             // Interest accumulator
    lastAccrualTimestamp    // Last update time
}
```

**Gap identified:** File 11 states "Noct-funded reserves" but provides no mechanism for:
- Initial reserve capitalization
- Reserve custody authorization (who controls the private keys?)
- Reserve exhaustion handling
- Reserve replenishment

### 1.3 Conservation Invariants

**User-level invariants:**
```
I1: cashUSDC ≥ 0
I2: collateralUSDC ≥ 0  
I3: borrowedZEN ≥ 0, borrowedETH ≥ 0
I4: debtZEN ≥ 0, debtETH ≥ 0
I5: cashUSDC + collateralUSDC = total_user_USDC_in_protocol
```

**Protocol-level invariants (UNDEFINED):**

The specifications lack protocol-wide conservation laws. The following MUST be defined:

```
P1: Σ(user.cashUSDC) + Σ(user.collateralUSDC) ≤ Protocol_USDC_Custody
P2: ZENReserve.availableLiquidity + Σ(user.borrowedZEN) = Total_ZEN_Reserve
P3: ZENReserve.totalDebtPrincipal = Σ(user.debtZEN at entry index)
P4: availableLiquidity ≥ 0 (reserve cannot go negative)
```

**Critical contradiction:** Users deposit USDC but borrow ZEN/ETH. How does USDC collateral **authorize** ZEN/ETH liquidity withdrawal? 

**Missing mechanism:** Cross-asset reserve authorization. Options:
1. Protocol pre-funds ZEN/ETH reserves (current implication, but custody undefined)
2. USDC collateral locked as backing for ZEN/ETH loans (requires liquidation to convert)
3. External market-making layer (not mentioned)

---

## 2. Interest Rate Model

### 2.1 Current Specification

File `19-INTEREST-ACCRUAL.md` specifies:

**V1 design (line 30):**
> "Start with a simple protocol-configured rate per borrow asset. Do not introduce a complex utilization/kink curve until the baseline system is correct and benchmarked."

**Index-based accrual (line 19-26):**
```
currentDebt = principal × currentBorrowIndex ÷ entryBorrowIndex
```

**Critical gap:** The account state schema in file `08-NOCTSTATE-V1.md` (lines 23-35) does **NOT** include:
- `entryBorrowIndex` (when user borrowed)
- `scaledDebt` (normalized debt)
- `debtPrincipal` vs. `debtTotal`

**Contradiction:** File 02 lists `debtZEN` and `debtETH` as absolute balances, but index-based accrual requires storing principal separately.

### 2.2 Fixed-Point Arithmetic Requirements

**TinyGo WASM constraint:** No `float64` in financial logic (file 08, line 63).

**Required but undefined:**
- **Precision scale:** Standard is 18 decimals (1e18 = 1.0), but not frozen
- **Rate encoding:** Is 5% APR stored as `5e16` (0.05 × 1e18)?
- **Overflow bounds:** Max debt? Max index value?
- **Rounding direction:** Always round against user or protocol?

**Recommendation:**
```
SCALE = 1e18 (18 decimals)
borrowRate = 5e16  // 5% = 0.05 × 1e18
MAX_BORROW_INDEX = 1e36  // Allows ~1e18 growth before overflow
```

### 2.3 Deterministic Time Source

**Vela constraint (file 16, line 46):**
> "Noct guest logic must not rely on arbitrary external HTTP, random execution, or uncontrolled time."

**Problem:** TinyGo WASM has no `time.Now()`. Interest accrual requires timestamp progression.

**Options:**
1. **Block timestamp:** Vela passes Horizon block timestamp as authenticated input
2. **Enclave monotonic clock:** TEE provides deterministic time oracle
3. **Oracle timestamp:** Price snapshot includes time (file 18, line 20)

**Recommendation:** Use oracle timestamp as single source of truth — ties pricing and time to same authenticated snapshot.

### 2.4 Interest Accrual Formula (Proposed)

**Lazy per-reserve accrual:**
```
Δt = currentTimestamp - lastAccrualTimestamp
ratePerSecond = annualRate / SECONDS_PER_YEAR
indexGrowth = 1 + (ratePerSecond × Δt)  // Fixed-point: SCALE + (rate × Δt)
newIndex = oldIndex × indexGrowth / SCALE
```

**User debt calculation:**
```
currentDebt = debtPrincipal × newIndex / entryIndex
```

**Required schema changes:**
```diff
PrivateAccount {
+   debtZENPrincipal      // Principal borrowed
+   debtZENEntryIndex     // Index when borrowed
-   debtZEN               // Remove if using index model
}
```

**Alternative (simpler for V1):** Store absolute debt, accrue per-user on each transition. Trades gas/compute for simplicity.

---

## 3. Liquidation Mechanics

### 3.1 Current Status

**File 02, line 430:**
> "Exact liquidation mechanism, liquidation bonus, close factor, oracle assumptions and liquidator settlement fields are **OPEN until the liquidation transition specification is explicitly frozen**."

**File 10, line 37:**
> "The architecture discussion has used 75% as the V1 borrowing-factor target and 80% as a candidate liquidation threshold. Exact production numeric parameters MUST be frozen before deployment and MUST NOT be guessed in code."

### 3.2 Health Factor Calculation

**Standard DeFi formula:**
```
healthFactor = (collateralValue × liquidationThreshold) / totalDebt
```

**In NoctFinance terms:**
```
collateralValue = collateralUSDC × oraclePrice(USDC)  // = collateralUSDC if USDC = $1
debtValue = (debtZEN × price(ZEN)) + (debtETH × price(ETH))

healthFactor = (collateralUSDC × liquidationThreshold) / debtValue
```

**Liquidation trigger:**
```
IF healthFactor < 1.0 THEN liquidatable
```

**Fixed-point encoding:**
```
liquidationThreshold = 80e16  // 80% = 0.80 × 1e18
healthFactor = (collateralUSDC × 80e16 × 1e18) / (debtValue × 1e18)
```

### 3.3 Liquidation Parameters (UNDEFINED)

Must be frozen before implementation:

| Parameter | Description | Typical DeFi Range | NoctFinance Status |
|-----------|-------------|-------------------|-------------------|
| Max LTV | Maximum borrow ratio | 60-75% | **Candidate: 75%** |
| Liquidation Threshold | Health trigger | 75-85% | **Candidate: 80%** |
| Liquidation Bonus | Liquidator incentive | 5-15% | **OPEN** |
| Close Factor | Max liquidatable % | 25-50% | **OPEN** |

**Safety buffer:** `liquidationThreshold - maxLTV = 80% - 75% = 5%` is **dangerously tight**. Price volatility could trigger mass liquidations.

**Recommendation:** Testnet defaults:
- Max LTV: **60%** (conservative)
- Liquidation Threshold: **75%** (15% buffer)
- Liquidation Bonus: **10%** (standard)
- Close Factor: **50%** (half position per liquidation)

### 3.4 Liquidator Profitability

**Liquidation economic equation:**
```
Liquidator profit = (debtRepaid × liquidationBonus) - gasCost - priceSlippage
```

**Break-even analysis:**

Assume liquidator repays $1000 debt with 10% bonus:
- Seizes: $1100 collateral
- Gas cost: ~$20 (optimistic)
- Price slippage: 0.5% = $5.50
- Net profit: $1100 - $1000 - $20 - $5.50 = **$74.50**

**Unprofitable scenarios:**
1. Gas spike during congestion (> $100)
2. Small liquidations (< $500 debt)
3. Insufficient bonus (< 5%)
4. Collateral price drops during liquidation (< debt value)

**Mitigation:** Minimum liquidation size (e.g., $100 debt minimum).

### 3.5 Bad-Debt Waterfall

**Scenario:** Collateral value < debt value (e.g., flash crash).

**Options (UNDEFINED):**
1. **Insurance fund:** Protocol reserves absorb loss
2. **Socialized loss:** Distribute loss across all suppliers
3. **Protocol insolvency:** Freeze until external rescue

**File 05, line 248:** "bad-debt handling" listed but not specified.

**Recommendation:** 
```
IF collateralValue < debtValue THEN
    1. Liquidate all collateral
    2. Write off remaining debt
    3. Record protocol deficit in insurance fund
    4. IF insurance depleted THEN flag protocol insolvency
```

---

## 4. System Invariants

### 4.1 Transition Invariants (File 02, lines 436-465)

**Enforced by state machine:**
```
I1:  No negative balances
I2:  No debt without collateral authorization
I3:  No debt reduction without repayment/liquidation
I4:  No external withdrawal without internal balance
I5:  No double withdrawal (replay protection)
I6:  No stale-state transition
I7:  No replayed transition
I8:  Correct asset binding
I9:  Correct application binding
I10: Deterministic execution
I11: Private position fields not emitted publicly
I12: Failed settlement restores balance
```

### 4.2 Reserve Solvency Invariants (MISSING)

Must test on every state transition:

```
R1: ZENReserve.availableLiquidity ≥ 0
R2: ETHReserve.availableLiquidity ≥ 0
R3: ZENReserve.totalDebtPrincipal = Σ(user.debtZENPrincipal)
R4: Protocol_USDC_Custody ≥ Σ(user.cashUSDC + user.collateralUSDC)
```

### 4.3 Economic Invariants

```
E1: Σ(collateralUSDC × LTV) ≥ Σ(debtValue)  // Over-collateralization
E2: healthFactor ≥ 1.0 OR liquidatable      // Risk boundary
E3: Reserve exhaustion → borrow rejection   // Liquidity limit
```

### 4.4 Test Checklist

Every transition must verify:
1. Pre-condition: All invariants hold before
2. Transition: State update logic correct
3. Post-condition: All invariants hold after
4. Failure path: Rollback preserves invariants

---

## 5. Parameter Recommendations

### 5.1 Risk Parameters (Ranges)

| Parameter | Testnet Safe | Mainnet Conservative | Mainnet Aggressive |
|-----------|--------------|----------------------|-------------------|
| Max LTV | 50-60% | 60-70% | 70-75% |
| Liquidation Threshold | 65-75% | 75-80% | 80-85% |
| Liquidation Bonus | 10-15% | 8-12% | 5-10% |
| Close Factor | 50% | 50% | 25-50% |
| Oracle Staleness | 60s | 30s | 15s |

### 5.2 Interest Rate Parameters (V1 Simple Model)

```
ZEN_BORROW_RATE = 10e16  // 10% APR (0.10 × 1e18)
ETH_BORROW_RATE = 8e16   // 8% APR
SECONDS_PER_YEAR = 31536000
```

**Future kink model (post-V1):**
```
baseRate = 2e16          // 2% at 0% utilization
slope1 = 8e16            // Up to 80% utilization
kink = 80e16             // 80% optimal utilization
slope2 = 100e16          // Above kink (steep)

rate = IF utilization < kink 
       THEN baseRate + (utilization × slope1 / SCALE)
       ELSE baseRate + (kink × slope1 / SCALE) 
            + ((utilization - kink) × slope2 / SCALE)
```

### 5.3 Fixed-Point Standards

```
PRECISION = 18 decimals
SCALE = 1e18
MAX_UINT256 = 2^256 - 1
MAX_SAFE_DEBT = 1e12 × 1e18  // $1 trillion with 18 decimals
MIN_OPERATION = 1e12         // $0.000001 minimum
```

### 5.4 Testnet Defaults (Frozen Recommendation)

```go
const (
    MAX_LTV_PERCENT = 60        // 60%
    LIQUIDATION_THRESHOLD = 75  // 75%
    LIQUIDATION_BONUS = 10      // 10%
    CLOSE_FACTOR = 50           // 50%
    
    SCALE = 1e18
    MAX_LTV = 60e16             // 0.60 × 1e18
    LIQ_THRESHOLD = 75e16       // 0.75 × 1e18
    LIQ_BONUS = 10e16           // 0.10 × 1e18
    
    ZEN_BORROW_RATE = 10e16     // 10% APR
    ETH_BORROW_RATE = 8e16      // 8% APR
    
    ORACLE_MAX_STALENESS = 60   // seconds
    MIN_LIQUIDATION_VALUE = 100 // $100 minimum
)
```

---

## 6. Critical File Contradictions

### 6.1 Account State Schema Mismatch

**File 08 (NOCTSTATE-V1.md, lines 23-35):**
```
PrivateAccount {
    debtZEN
    debtETH
}
```

**File 19 (INTEREST-ACCRUAL.md, lines 22-26):**
```
currentDebt = principal × currentBorrowIndex ÷ entryBorrowIndex
```

**Contradiction:** Index-based model requires `principal` and `entryIndex`, but schema only has `debtZEN`.

**Resolution required:** Choose one:
1. Store absolute debt, accrue per-user per-transition (simpler, higher compute)
2. Add `debtPrincipal` + `entryIndex` fields (efficient, requires schema change)

### 6.2 Reserve Funding Undefined

**File 11 (line 35):** "Noct-funded reserves"

**File 01 (line 19):** "ZEN/ETH liquidity funded by Noct for the testnet"

**Gap:** No specification for:
- Reserve custody mechanism
- Authorization flow (who controls ZEN/ETH?)
- Initial funding transaction
- Exhaustion handling

### 6.3 Liquidation Parameters Frozen as OPEN

**File 02 (line 430):** All liquidation parameters explicitly OPEN

**File 10 (line 37):** "MUST NOT be guessed in code"

**File 05 (line 248):** "bad-debt handling" listed, not specified

**Risk:** Implementation cannot proceed without frozen parameters.

### 6.4 Time Source Undefined

**File 16 (line 46):** "must not rely on...uncontrolled time"

**File 11 (line 24):** `lastAccrualTimestamp` field exists

**File 18 (line 20):** Oracle has `timestamp` field

**Gap:** Which timestamp is authoritative? Must be deterministic and authenticated.

### 6.5 Fixed-Point Precision Not Frozen

**File 08 (line 63):** "Use integer/fixed-point arithmetic"

**File 19 (line 34):** "Define: scale; overflow bounds; rounding direction"

**Status:** None defined. Every calculation risks precision/overflow bugs without standard.

---

## Conclusion

NoctFinance V1 has **strong state machine semantics** but **incomplete economic implementation**. Before coding begins:

**Must freeze:**
1. Reserve funding mechanism (custody, authorization, exhaustion)
2. Account schema for interest accrual (`debtPrincipal` vs. `debtTotal`)
3. Fixed-point precision standard (recommend 18 decimals, 1e18 scale)
4. Deterministic time source (recommend oracle timestamp)
5. All liquidation parameters (threshold, bonus, close factor, bad-debt)

**Testnet-safe defaults proposed:**
- Max LTV: 60%
- Liquidation threshold: 75%
- Liquidation bonus: 10%
- Simple fixed borrow rates (10% ZEN, 8% ETH)

**Do not proceed with implementation until these `OPEN` decisions are explicitly resolved.** Current specs correctly prohibit inventing protocol rules in code.
