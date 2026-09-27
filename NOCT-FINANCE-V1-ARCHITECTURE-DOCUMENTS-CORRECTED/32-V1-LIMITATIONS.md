# 32. V1 Scope & Known Limitations

**Status:** Implementation architecture baseline - MULTI-COLLATERAL V1  
**Audience:** Noct Finance team (Alex, Daniel), Vela acceleration team, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## V1 Scope

V1 implements full multi-collateral, multi-borrow functionality:
- Three assets: USDC, ETH, ZEN;
- All three can be collateral AND borrow assets;
- Multi-asset positions with risk-weighted health factor;
- Cross-asset liquidations (e.g., pay ETH debt, seize USDC collateral);
- Protocol-funded reserve liquidity (no user suppliers);
- Per-asset interest accrual with same kink curve.

## V1 Limitations

### Protocol-Funded Reserves Only
V1 uses Noct-funded liquidity for all three assets. User-funded supply (earning yield) is deferred to future versions. This simplifies the initial implementation by avoiding supply indexes and supplier yield accounting.

### Same Interest Curve for All Assets
All three reserves use the same kink model parameters (2% base, 10% slope, 200% jump at 80% utilization). Per-asset interest curves are deferred to future versions.

### Deterministic Liquidation Priority
Debt asset selection follows a fixed waterfall (ETH → ZEN → USDC). Liquidator cannot choose which debt to repay. This ensures fairness but may require multiple liquidations for positions with debt in multiple assets.

### Bad Debt Is Absorbed by the Protocol, Not Socialized (SPEC-04)
V1 **does** resolve bad debt, but only by protocol absorption. When a position is liquidatable yet
cannot be liquidated — because its debt is below `minLiquidationDebtUsdWad`, or because no collateral
asset yields a seizure worth at least the payment — `T13 ABSORB_BAD_DEBT` (File 12) writes off the
account's debt, returns every protocol-held balance to its reserve, and records the shortfall in
`reserve.writtenOffDebtUsd` and `protocolBadDebtUsd`. The loss is borne by Noct's funded reserves.

What V1 does **not** do is socialize loss across suppliers, because V1 has no user suppliers. There is
no insurance fund, no supplier-yield haircut and no dilution mechanism. `T13` is restricted to the
committed `governanceIdentity` and emits no withdrawal, so it cannot transfer value to a
caller-chosen destination. Decentralized discovery, auctions, insurance reserves and socialized loss
remain deferred to future versions (File 33).

Before this remediation, File 12 rejected dust liquidations "for explicit bad-debt handling" while
this file stated V1 had none — leaving such positions permanently liquidatable, permanently
unliquidated, and permanently accruing.


### Fixed Risk Parameters
Collateral factors, liquidation thresholds, and bonuses are frozen at deployment (config commitment). Dynamic parameter updates require protocol upgrade.

## Privacy

Private position state is the target. Normal public settlement may expose transfer metadata through on-chain events, but individual balances, debt amounts, and health factors remain confidential within the TEE.

## ZK

Proving can be expensive. The implementation therefore separates proving from verification and allows dedicated prover infrastructure. Note that zkVerify integration is a custom Noct layer, not native Vela functionality.

## TEE

Confidentiality depends partly on Vela/Nitro deployment assumptions. AWS Nitro Enclave attestation is required for production deployments. Local development uses emulated TEE mode.

## Oracle

Risk safety depends on authenticated/fresh price inputs. The trigger + TRUSTPROCESS flow is the only way to consume on-chain oracle data in risk-sensitive operations. Direct HTTP oracle fetches or caller-supplied prices are not supported.

## Product rule

Do not add features outside the core state machine before the testnet architecture is stable. V2.0 focuses on correctness and security of the multi-collateral core before adding advanced features.
