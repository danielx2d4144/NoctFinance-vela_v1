# 1. Executive Summary

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Purpose

Noct Finance V1 is a private DeFi lending application built using the current Horizen Vela architecture as the confidential execution substrate, with Horizon as the blockchain/settlement environment and UltraHonk + zkVerify as the ZK proof layer.

V1 intentionally has a small market:

| Role | Asset |
|---|---|
| Deposit | USDC |
| Supply/collateral | USDC |
| Borrow | ZEN, ETH |
| ZEN/ETH liquidity | Funded by Noct for the testnet |
| User position | Private |

## Core state lifecycle

```text
Wallet
  │
  └─ DEPOSIT_USDC
        ↓
    cashUSDC
        │
        └─ SUPPLY_USDC
              ↓
        collateralUSDC
              │
              ├─ RELEASE_COLLATERAL_USDC → cashUSDC
              │
              └─ BORROW_ZEN/ETH
                    ├─ debt
                    └─ borrowedAsset
                          │
                          └─ WITHDRAW_BORROWED_ASSET → wallet
```

## Critical semantic decisions

- Deposit is not supply.
- Released collateral returns to private cash first.
- Cash withdrawal is the operation that externally withdraws USDC.
- Borrow creates private debt and a private borrowed-asset balance.
- Borrowing does not automatically send the asset to the wallet.
- Withdrawing a borrowed asset does not reduce debt.
- Private collateral, debt, LTV and health factor must not be exposed as public Noct state.

## System principle

Noct is one logical state machine. Vela, the ZK layer, zkVerify and Horizon are supporting execution/verification/settlement layers around that state machine.

## Completion standard

A feature is complete only when state semantics, security, privacy, failure recovery, tests and required performance evidence are present.
