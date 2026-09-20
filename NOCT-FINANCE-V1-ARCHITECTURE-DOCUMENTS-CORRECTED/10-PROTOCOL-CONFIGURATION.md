# 10. Protocol Configuration

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Configuration model

Noct has one canonical, versioned configuration. Frontends, WASM, tests and circuits MUST consume or commit to the same values rather than hard-code independent risk parameters.

```text
ProtocolConfig
├── assetConfig
├── riskConfig
├── interestConfig
├── oracleConfig
├── reserveConfig
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

## V1 asset rules

```text
collateralAsset = USDC
borrowAssets    = [ZEN, ETH]
amountScale     = WAD
priceScale      = WAD
indexScale      = RAY
```

Noct funds the ZEN and ETH liquidity in V1. User-funded ZEN/ETH supply is not part of V1.

## Risk parameters — frozen for V1 testnet

```yaml
maxLTVWad:                600000000000000000   # 60%
liquidationThresholdWad:  750000000000000000   # 75%
liquidationBonusWad:      100000000000000000   # 10%
closeFactorWad:           500000000000000000   # 50%
reserveFactorWad:         100000000000000000   # 10%
```

Bounds:

```text
0 < maxLTVWad < liquidationThresholdWad <= WAD
0 <= liquidationBonusWad
0 < closeFactorWad <= WAD
0 <= reserveFactorWad <= WAD
```

`maxLTVWad` gates both borrowing and collateral release:

```text
postDebtUsd <= mulDivDown(postCollateralUsd, maxLTVWad, WAD)
```

The liquidation threshold has one purpose: identifying a liquidatable position.

```text
liquidatable iff
    debtUsd > mulDivDown(collateralUsd, liquidationThresholdWad, WAD)
```

The liquidation threshold MUST NOT authorize a borrow or collateral release. At equality a position is not liquidatable. Zero-debt positions are never liquidatable.

USD valuation uses latest accepted authenticated `OracleState` prices:

```text
collateralUsd = mulDivDown(collateralUSDC, usdcPrice, WAD)
debtUsd =
    mulDivUp(currentDebtZEN, zenPrice, WAD) +
    mulDivUp(currentDebtETH, ethPrice, WAD)
```

Collateral is rounded down and debt is rounded up for risk checks.

## Interest model — frozen for V1 testnet

Each borrow asset uses the same V1 kink parameters unless a future config version explicitly provides per-asset values.

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

Utilization, lazy accrual, chunking and rounding are normative in File 19. A config decoder MUST verify that every intermediate maximum supported by the U256 implementation is safe or reject the config.

The V1 supply-rate formula is informational only because V1 has no user-funded ZEN/ETH supply. No supplier yield balance is created.

## Oracle interface parameters

```yaml
maxOracleStalenessSeconds: 300
priceDeviationThresholdWad: 500000000000000000  # 50%
```

Lending transitions consume the latest accepted authenticated `OracleState` epoch. They MUST NOT accept a caller-selected snapshot or caller-provided oracle signature. Oracle authentication, confidence policy and epoch acceptance belong to the oracle subsystem; this configuration only constrains use of its accepted state.

Risk-sensitive transitions MUST fail closed when the latest accepted epoch is stale according to the deterministic execution timestamp supplied by the trusted Vela runtime. Deposit, simple cash withdrawal and repayment commit do not require prices. Borrow, collateral release, liquidation preparation and any other risk-increasing transition require a fresh accepted epoch.

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
USDC, ZEN and ETH asset identifiers
WAD, RAY and YEAR
maxLTVWad
liquidationThresholdWad
liquidationBonusWad
closeFactorWad
reserveFactorWad
baseRatePerYearRay
multiplierPerYearRay
jumpMultiplierPerYearRay
optimalUtilizationRay
maxAccrualChunkSeconds
maxAccrualChunksPerTransition
maxOracleStalenessSeconds
priceDeviationThresholdWad
ethereumConfirmations
prePaymentOperationTtlSeconds
```

Every U256 field uses canonical 32-byte big-endian encoding; fixed-width integer and identifier encodings MUST also be specified once and tested with golden vectors. Ambiguous concatenation is forbidden. Every proof or authorization bound to configuration MUST include `configCommitment` in its public context.
