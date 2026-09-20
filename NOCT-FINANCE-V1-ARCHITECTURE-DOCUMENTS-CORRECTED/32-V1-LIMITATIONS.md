# 32. V1 Limitations

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Scope

V1 intentionally has:
- one collateral asset (USDC);
- two borrow assets (ZEN, ETH);
- protocol-funded borrow liquidity;
- limited risk model;
- limited liquidation model.

## Privacy

Private position state is the target. Normal public settlement may expose transfer metadata.

## ZK

Proving can be expensive. The implementation therefore separates proving from verification and allows dedicated prover infrastructure.

## TEE

Confidentiality depends partly on Vela/Nitro deployment assumptions.

## Oracle

Risk safety depends on authenticated/fresh price inputs.

## Product rule

Do not add features outside the core state machine before the testnet architecture is stable.
