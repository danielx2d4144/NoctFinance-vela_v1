# 1. Executive Summary

**Status:** Implementation architecture baseline - MULTI-COLLATERAL V1  
**Audience:** Noct Finance team (Alex, Daniel), Vela acceleration team, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

## Purpose

Noct Finance V1 is a private DeFi lending application built using the current Horizen Vela architecture as the confidential execution substrate, with Horizon as the blockchain/settlement environment and UltraHonk + zkVerify as the ZK proof layer.

V1 supports full multi-collateral, multi-borrow functionality:

| Role | Asset |
|---|---|
| Deposit | USDC, ETH, ZEN |
| Supply/collateral | USDC, ETH, ZEN (any combination) |
| Borrow | USDC, ETH, ZEN (any combination) |
| Reserve liquidity | Funded by Noct for V1 testnet |
| User position | Private (multi-asset) |

## Core state lifecycle (Multi-Asset)

```text
Wallet (any asset: USDC, ETH, ZEN)
  │
  └─ DEPOSIT_ASSET
        ↓
    cash[asset]
        │
        └─ SUPPLY_ASSET
              ↓
        collateral[asset]
              │
              ├─ RELEASE_COLLATERAL_ASSET → cash[asset]
              │
              └─ BORROW_ASSET (any asset, risk-weighted)
                    ├─ scaledDebt[asset]
                    └─ borrowed[asset]
                          │
                          └─ WITHDRAW_BORROWED_ASSET → wallet
```

**Multi-Asset Support:** Users can deposit, supply as collateral, and borrow any combination of USDC, ETH, and ZEN. Risk is measured across all assets with **two distinct weightings** that must not be conflated: borrowing and collateral release are gated on aggregate collateral weighted by `collateralFactorWad` (the LTV gate), while liquidation eligibility is gated on aggregate collateral weighted by `liquidationThresholdWad` — both compared against aggregate debt weighted by `borrowFactorWad`. Because `collateralFactorWad < liquidationThresholdWad` for every asset, the borrow gate is strictly tighter than the liquidation gate, which is what creates the protocol's liquidation buffer. Files 10 and 12 are normative.

## Critical semantic decisions

- Deposit is not supply (per-asset).
- Released collateral returns to private cash first (per-asset).
- Cash withdrawal is the operation that externally withdraws any asset.
- Borrow creates private debt and a private borrowed-asset balance (per-asset).
- Borrowing does not automatically send the asset to the wallet.
- Withdrawing a borrowed asset does not reduce debt.
- Private multi-asset collateral, debt, LTV and health factor must not be exposed as public Noct state.
- Cross-asset liquidations are supported (e.g., pay ETH debt, seize USDC collateral).

## System principle

Noct is one logical state machine. Vela, the ZK layer, zkVerify and Horizon are supporting execution/verification/settlement layers around that state machine.

## Completion standard

A feature is complete only when state semantics, security, privacy, failure recovery, tests and required performance evidence are present.
