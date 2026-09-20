# Noct Finance V1 — Complete Architecture Documentation

This directory contains all **34 requested architecture/protocol documents**, plus this README and `TOOLCHAIN-LOCK.md`.

The Markdown files are the implementation source of truth. The consolidated PDF is a human-readable export and is not the preferred input for a coding agent.

## Authoritative status

- FROZEN = follow exactly.
- CONDITIONAL = use only after its stated evidence/benchmark.
- OPEN = do not invent protocol semantics.
- DEFERRED = intentionally excluded from V1.

## Core V1 model

```text
USDC:
wallet → deposit → cash → supply → collateral
                 ↑                 │
                 └─ release ──────┘
cash → withdrawal → wallet

ZEN/ETH:
reserve → borrow → private borrowed balance + debt
borrowed balance → optional withdrawal → wallet
debt → repay
unsafe position → liquidation
```

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

These are baselines only. The exact tested versions must be written into `TOOLCHAIN-LOCK.md`.

## Junior developer rule

When a coding task requires an undefined protocol decision, stop and flag it. Never invent financial semantics.
