# Noct Finance V1 — Complete Architecture Documentation

This directory contains all **34 requested architecture/protocol documents**, plus this README,
`TOOLCHAIN-LOCK.md`, and `00-AUDIT-REMEDIATION-TRACEABILITY.md` (the audit remediation change-control
record: finding → file → section → amendment, plus the verification gates used to close each row).

The Markdown files are the implementation source of truth. The consolidated PDF is a human-readable export and is not the preferred input for a coding agent.

## Authoritative status

- FROZEN = follow exactly.
- CONDITIONAL = use only after its stated evidence/benchmark.
- OPEN = do not invent protocol semantics.
- DEFERRED = intentionally excluded from V1.

## Core V1 model

```text
Deposit / cash / collateral path — IDENTICAL for USDC, ETH and ZEN:
wallet → deposit → cash → supply → collateral
                 ↑                 │
                 └─ release ──────┘
cash → withdrawal → wallet

Borrow / debt / liquidation path — IDENTICAL for USDC, ETH and ZEN:
reserve → borrow → private borrowed balance + scaledDebt
borrowed balance → optional withdrawal → wallet
scaledDebt → repay (prepare → capture → commit)
thresholdCollateralUsd < weightedDebtUsd → cross-asset liquidation
unliquidatable in practice → governance T13 ABSORB_BAD_DEBT
```

Every asset is simultaneously a valid collateral asset and a valid borrow asset (File 10). The
previous diagram showed USDC as collateral-only and ZEN/ETH as borrow-only; that was the superseded
single-collateral model and MUST NOT be implemented. Borrow and release are gated on
`collateralFactorWad`; liquidation is gated on `liquidationThresholdWad`. The two gates are distinct —
see Files 10 and 12 (SPEC-01).

## Current-source basis

The architecture uses the current Horizen Vela repositories as implementation references, including:
- Vela Starter Kit;
- Vela core;
- Vela Nova;
- Vela Facilitator.

Current Vela core baseline observed during architecture review:
- Go 1.24.0;
- `toolchain go1.24.3`;
- Wasmtime-go;
- versioned LevelDB state;
- Secure Processor Manager + WASM Executor model.

Current Facilitator baseline observed:
- Node 20+;
- pnpm 9.x;
- TypeScript 5.7.3;
- ethers 6.13.4.

Current zkVerify documentation observed:
- Noir UltraHonk support;
- V3_0/V0_84/Legacy verification variants;
- max 32 public inputs;
- max evaluation domain 2^25.

These are baselines only, and several are now known to be wrong or unverifiable — `ethers` is
declared as a caret range and resolves to `6.17.0`, not `6.13.4`, and the repository ships an npm
`package-lock.json` despite the pnpm baseline above. `TOOLCHAIN-LOCK.md` is normative and separates
**VERIFIED** pins (evidenced in-repo) from **OPEN** pins (CI-blocking). Nothing may be built against a
row still marked OPEN.

## Junior developer rule

When a coding task requires an undefined protocol decision, stop and flag it. Never invent financial semantics.
