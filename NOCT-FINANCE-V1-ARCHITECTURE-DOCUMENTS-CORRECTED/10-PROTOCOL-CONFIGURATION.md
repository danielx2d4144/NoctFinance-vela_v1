# 10. Protocol Configuration V1 (Multi-Collateral)

**Status:** Implementation architecture baseline - MULTI-COLLATERAL  
**Audience:** Noct Finance team (Alex, Daniel), Vela acceleration team, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Configuration model

Noct has one canonical, versioned configuration. Frontends, WASM, tests and circuits MUST consume or commit to the same values rather than hard-code independent risk parameters.

```text
ProtocolConfig
├── assetConfigs (per-asset risk parameters)
├── interestConfig
├── oracleConfig
└── zkConfig
```

## Canonical numeric encoding

All financial configuration values are U256 encoded as exactly 32 unsigned big-endian bytes. Amounts, prices and risk ratios use WAD (`10^18`). Borrow indexes, utilization and annual interest-rate values use RAY (`10^27`). Nonces, versions, epochs and timestamps may use `uint64`.

The implementation MUST use an audited TinyGo-compatible checked U256 library and full-width `mulDivDown`/`mulDivUp`; it MUST NOT use `uint64`, `math/big`, or floating-point for financial arithmetic. Configuration decoding MUST reject overflow, wrong-width values and values outside the bounds below.

```text
WAD  = 1_000_000_000_000_000_000
RAY  = 1_000_000_000_000_000_000_000_000_000
YEAR = 31_536_000 seconds
```

## V1 asset rules (Multi-Collateral)

```text
supportedAssets     = [USDC, ETH, ZEN]
collateralAssets    = [USDC, ETH, ZEN]  (any can be collateral)
borrowAssets        = [USDC, ETH, ZEN]  (any can be borrowed)
amountScale         = WAD
priceScale          = WAD
indexScale          = RAY
```

**Native decimals — frozen for V1 (SPEC-02):**

```text
nativeDecimals[USDC] = 6
nativeDecimals[ETH]  = 18
nativeDecimals[ZEN]  = 18
```

These are the `decimals()` values of the deployed custody tokens on the target chain. They MUST be
read from the deployed token contracts at deployment and asserted equal to the values above; a
mismatch MUST fail deployment. `nativeDecimals` is a committed configuration value because it
determines the WAD conversion at every custody boundary. File 08 defines the normative conversion
functions; File 11 defines where they apply.

`nativeDecimals[a]` MUST satisfy `0 <= nativeDecimals[a] <= 18`. Assets with more than 18 native
decimals are not representable in the V1 WAD domain and MUST NOT be added without a protocol
version change.


**V1 Design:** All three assets can be both collateral AND debt. Users may have multi-asset collateral backing multi-asset debt.

Noct funds the USDC, ETH, and ZEN liquidity in V1. User-funded supply is not part of V1.

## Risk parameters — frozen for V1 testnet (Per-Asset)

V1 introduces **per-asset risk parameters** to handle multi-collateral positions:

```yaml
# USDC (Stablecoin - lowest risk)
USDC:
  collateralFactorWad:      900000000000000000   # 90% (high confidence)
  borrowFactorWad:          1000000000000000000  # 100% (1:1 debt weight)
  liquidationThresholdWad:  950000000000000000   # 95%
  liquidationBonusWad:      50000000000000000    # 5%
  closeFactorWad:           500000000000000000   # 50%
  reserveFactorWad:         100000000000000000   # 10%

# ETH (Volatile - medium risk)
ETH:
  collateralFactorWad:      800000000000000000   # 80%
  borrowFactorWad:          1000000000000000000  # 100%
  liquidationThresholdWad:  850000000000000000   # 85%
  liquidationBonusWad:      80000000000000000    # 8%
  closeFactorWad:           500000000000000000   # 50%
  reserveFactorWad:         100000000000000000   # 10%

# ZEN (More volatile - higher risk)
ZEN:
  collateralFactorWad:      700000000000000000   # 70%
  borrowFactorWad:          1000000000000000000  # 100%
  liquidationThresholdWad:  800000000000000000   # 80%
  liquidationBonusWad:      100000000000000000   # 10%
  closeFactorWad:           500000000000000000   # 50%
  reserveFactorWad:         100000000000000000   # 10%
```

Bounds for each asset:

```text
0 < collateralFactorWad < liquidationThresholdWad <= WAD
0 <= liquidationBonusWad <= WAD
0 < closeFactorWad <= WAD
0 <= reserveFactorWad <= WAD
borrowFactorWad = WAD (100% for all V1 assets)
0 < minLiquidationDebtUsdWad
0 <= nativeDecimals <= 18
```

The **strict** inequality `collateralFactorWad < liquidationThresholdWad` is what separates the
borrow gate from the liquidation gate (see "Multi-Asset Risk Weighting"). A configuration in which
the two are equal for any asset makes the gates coincide, removes the entire liquidation buffer, and
MUST be rejected by the config decoder at decode time — not merely flagged by monitoring. The
decoder MUST also reject `collateralFactorWad >= liquidationThresholdWad`.

`liquidationBonusWad` is additionally bounded above by `WAD` so that
`WAD + liquidationBonusWad` cannot overflow the WAD-scaled multiplier used in File 12's cross-asset
seizure formula.


**Multi-Asset Risk Weighting:**

Raw per-asset USD collateral value, shared by both weightings:

```text
collateralUsd[a] = mulDivDown(collateral[a], price[a], WAD)
```

Aggregate **LTV**-weighted collateral (governs borrowing capacity):

```text
ltvCollateralUsd = Σ over assets a:
  mulDivDown(collateralUsd[a], collateralFactorWad[a], WAD)
```

Aggregate **threshold**-weighted collateral (governs liquidation eligibility):

```text
thresholdCollateralUsd = Σ over assets a:
  mulDivDown(collateralUsd[a], liquidationThresholdWad[a], WAD)
```

Aggregate weighted debt:

```text
weightedDebtUsd = Σ over assets a:
  debtUsd[a] = mulDivUp(debt[a], price[a], WAD)
  mulDivUp(debtUsd[a], borrowFactorWad[a], WAD)
```

Health factor (liquidation measure) and borrow capacity factor:

```text
healthFactor         = mulDivDown(thresholdCollateralUsd, WAD, weightedDebtUsd)   if weightedDebtUsd > 0
borrowCapacityFactor = mulDivDown(ltvCollateralUsd,       WAD, weightedDebtUsd)   if weightedDebtUsd > 0
```

Borrow (T05) and collateral release (T04) are allowed only when the post-transition state satisfies
the LTV gate:

```text
postLtvCollateralUsd >= postWeightedDebtUsd
```

Liquidation (T09) eligibility is determined by a **separate, looser** gate:

```text
liquidatable if thresholdCollateralUsd < weightedDebtUsd
```

Zero-debt positions are never liquidatable.

**These two gates MUST NOT be collapsed.** Because the bounds below force
`collateralFactorWad < liquidationThresholdWad` per asset, `ltvCollateralUsd` is strictly smaller
than `thresholdCollateralUsd` for any position with nonzero collateral. A position that satisfies
the borrow gate is therefore never simultaneously liquidatable, and the gap between the gates is
the protocol's buffer against interest accrual and price movement between risk checks. File 12 is
normative for both gates.


## Interest model — frozen for V1 testnet (Same Curve for All Assets)

Each borrow asset (USDC, ETH, ZEN) uses the same V1 kink parameters. Future versions may provide per-asset curves.

```yaml
baseRatePerYearRay:            20000000000000000000000000    # 2%
multiplierPerYearRay:          100000000000000000000000000   # 10%
jumpMultiplierPerYearRay:     2000000000000000000000000000  # 200%
optimalUtilizationRay:         800000000000000000000000000   # 80%
maxAccrualChunkSeconds:        86400                           # 1 day
maxAccrualChunksPerTransition: 4096
```

Given `u` in RAY:

```text
if u <= optimalUtilizationRay:
    annualRate = baseRatePerYearRay
               + mulDivDown(u, multiplierPerYearRay, RAY)
else:
    annualRate = baseRatePerYearRay
               + mulDivDown(optimalUtilizationRay, multiplierPerYearRay, RAY)
               + mulDivDown(
                     u - optimalUtilizationRay,
                     jumpMultiplierPerYearRay,
                     RAY)
```

The multiplier terms are slopes over absolute utilization; they are not normalized by the width before or after the kink. Therefore the frozen examples are 7% at 50% utilization, 10% at 80%, and 30% at 90%.

**Multi-Asset Note:** Each reserve (USDC, ETH, ZEN) has its own utilization and accrues independently. Utilization, lazy accrual, chunking and rounding are normative in File 19. A config decoder MUST verify that every intermediate maximum supported by the U256 implementation is safe or reject the config.

The V1 supply-rate formula is informational only because V1 has no user-funded supply. No supplier yield balance is created.

## Oracle interface parameters

```yaml
maxOracleStalenessSeconds: 300
maxRiskDelaySeconds:       120
priceDeviationThresholdWad: 500000000000000000  # 50%
```

**`maxRiskDelaySeconds` (SPEC-08 remediation).** File 18 conditions fail-closed behavior on
"the adapter snapshot exceeds on-chain `maxRiskDelaySeconds`" but the frozen set previously gave this
parameter no value and omitted it from `configCommitment`. It is now frozen at **120 seconds** and
committed.

Enforcement point and semantics:

- It is enforced **on-chain by `NoctTrigger`**, against `block.timestamp`, per `18:163`. The guest
  has no authenticated independent clock and MUST NOT re-implement this check.
- `NoctTrigger` MUST refuse to emit a trusted payload when
  `block.timestamp - snapshot.adapterBlockTimestamp > maxRiskDelaySeconds`.
- It is **independent of** `maxOracleStalenessSeconds`, which bounds the age of Pyth
  `publishTime` at the adapter. Both must pass: Pyth data may be fresh while the adapter snapshot
  delivery to the trigger is stale, and vice versa.
- It MUST be committed in `configCommitment` even though it is enforced on-chain, so that the
  trigger configuration and the guest configuration cannot silently diverge. Deployment MUST fail
  if the value configured in `NoctTrigger` differs from the committed value.

Bounds: `0 < maxRiskDelaySeconds <= maxOracleStalenessSeconds`. A delay bound larger than the
staleness bound would make the staleness check unreachable and MUST be rejected.

Lending transitions consume the latest accepted authenticated `OracleState` epoch. They MUST NOT
accept a caller-selected snapshot or caller-provided oracle signature. Oracle authentication,
confidence policy and epoch acceptance belong to the oracle subsystem; this configuration only
constrains use of its accepted state.

Risk-sensitive transitions MUST fail closed when the latest accepted epoch is stale according to the
deterministic execution timestamp supplied by the trusted Vela runtime. Deposit, simple cash
withdrawal and repayment commit do not require prices. Borrow, collateral release, liquidation
preparation and any other risk-increasing transition require a fresh accepted epoch.

## Liquidation, quote and lock parameters — frozen for V1

```yaml
minLiquidationDebtUsdWad:      50000000000000000000   # 50 USD
maxQuoteIndexDriftRay:         1010000000000000000000000000  # 1.01 RAY = 1% index drift
maxConcurrentRepayLocks:       1
repayLockCooldownSeconds:      3600
```

**`minLiquidationDebtUsdWad` (SPEC-04 / SPEC-05 remediation).** Liquidation costs the liquidator
capital plus on-chain gas, escrow, trigger and withdrawal fees. Below this USD value no rational
liquidator acts, so the position remains liquidatable indefinitely while interest accrues into
unbacked debt. This parameter makes that boundary explicit instead of leaving it to chance. It is
USD-denominated so that it does not need to be re-derived per asset price.

It drives two rules in File 12's `PREPARE_LIQUIDATION`:

1. If the **entire** remaining debt of the position, valued in USD, is below the floor, liquidation
   is uneconomic and MUST NOT be attempted. The position is routed to `T13: ABSORB_BAD_DEBT`.
2. If only the **close-factor slice** is below the floor while total debt is above it, the close
   factor escalates to `WAD` (100%) for that operation so the liquidation is worth executing.

Bounds: `0 < minLiquidationDebtUsdWad`.

**`maxQuoteIndexDriftRay` (SPEC-07 remediation).** A repayment or liquidation is prepared at
`quoteIndex` but committed after an authenticated payment is captured, which may be many blocks
later. File 12 previously committed the prepared scaled reduction regardless of how far the reserve
index had moved, so a stale quote could under-repay a materially larger debt. Commit now re-derives
the reduction from the captured payment at the current index and MUST reject when

```text
mulDivDown(currentBorrowIndex, RAY, operation.quoteIndex) > maxQuoteIndexDriftRay
```

i.e. when the index has advanced by more than 1% since the quote. Rejection returns the operation to
`PREPARED` semantics via expiry: locks are released, the captured receipt is preserved and
re-quotable, and no debt is reduced. Bounds: `RAY < maxQuoteIndexDriftRay <= 1.2 * RAY`. A value at
or below `RAY` would reject every accrual and MUST be rejected at decode time.

**`maxConcurrentRepayLocks` and `repayLockCooldownSeconds` (SPEC-06 remediation).** A
`PREPARE_REPAY` installs a debt lock that blocks borrow, repayment and liquidation on that
account/asset pair. Unbounded, this is a free renewable liquidation block. V1 therefore caps
concurrent repay locks per account at **1** and, after a lock expires without payment capture,
forbids the same account from installing a new repay lock on the same asset for
**3600 seconds**. The cooldown is measured against the deterministic oracle timestamp, never host
time. A liquidatable account's repay lock MUST yield to liquidation as specified in File 12.


## Deterministic time

Reserve accrual uses the timestamp of the latest accepted authenticated `OracleState`. The timestamp is a `uint64` Unix-second value and MUST be greater than or equal to the reserve's `lastAccrualTimestamp`. Host wall-clock calls such as `time.Now()` are forbidden in consensus financial logic.

An oracle epoch or timestamp older than committed state MUST be rejected. Equal timestamps produce zero accrual and are valid where the operation otherwise permits them.

## Settlement and receipt parameters

```yaml
ethereumConfirmations: 12
prePaymentOperationTtlSeconds: 900
```

The TTL applies only while a repay or liquidation operation is `PREPARED` and no inbound payment has been captured. Once payment is captured, the operation MUST NOT expire or be timeout-refunded; authenticated commit is retried until idempotently successful.

## Configuration commitment

`configCommitment` is computed over a domain-separated canonical encoding containing, in fixed field order:

```text
protocolVersion
chainID

# Asset identifiers
USDC, ETH, ZEN asset identifiers

# Scales
WAD, RAY, YEAR

# Per-asset native decimals (SPEC-02)
For each asset in order [USDC, ETH, ZEN]:
  nativeDecimals

# Per-asset risk parameters (for each asset: USDC, ETH, ZEN)
For each asset in order [USDC, ETH, ZEN]:
  collateralFactorWad
  borrowFactorWad
  liquidationThresholdWad
  liquidationBonusWad
  closeFactorWad
  reserveFactorWad

# Interest model (same for all assets in V1)
baseRatePerYearRay
multiplierPerYearRay
jumpMultiplierPerYearRay
optimalUtilizationRay
maxAccrualChunkSeconds
maxAccrualChunksPerTransition

# Oracle parameters
maxOracleStalenessSeconds
maxRiskDelaySeconds
priceDeviationThresholdWad

# Liquidation, quote and lock parameters (SPEC-04/05/06/07)
minLiquidationDebtUsdWad
maxQuoteIndexDriftRay
maxConcurrentRepayLocks
repayLockCooldownSeconds

# Settlement parameters
ethereumConfirmations
prePaymentOperationTtlSeconds
```

Field order is normative. Adding, removing or reordering a field changes `configCommitment` and
therefore requires a new `protocolVersion`; it MUST NOT be done silently. `nativeDecimals` is
committed even though it is a token property, because it determines the WAD conversion applied to
every amount entering or leaving custody and a mismatch is indistinguishable from theft.


Every U256 field uses canonical 32-byte big-endian encoding; fixed-width integer and identifier encodings MUST also be specified once and tested with golden vectors. Ambiguous concatenation is forbidden. Every proof or authorization bound to configuration MUST include `configCommitment` in its public context.
