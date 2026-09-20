# Noct Finance Architecture Package

> **SUPERSEDED — DO NOT IMPLEMENT FROM THIS DIRECTORY.** This package and its PDF predate the corrected security review. The authoritative implementation source is `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/`, especially Files 08–23 and 27–30. Where this package conflicts with that directory, the corrected documents control.

This package is retained only as a historical architecture snapshot for Noct Finance.

## Source of truth

The Markdown files are authoritative for implementation. The consolidated PDF is a human-readable snapshot.

## Documents

1. `01-NOCT_IMPLEMENTATION_ARCHITECTURE.md` — system-wide architecture and boundaries.
2. `02-NOCT_STATE_MACHINE.md` — private account model and state transitions.
3. `03-NOCT_ZK_SPECIFICATION.md` — UltraHonk, zkVerify, proof architecture and benchmarks.
4. `04-NOCT_VELA_INTEGRATION.md` — Vela/Nitro/WASM integration.
5. `05-NOCT_IMPLEMENTATION_PLAN.md` — staged implementation and acceptance criteria.

## Important status rule

`FROZEN` / decided behavior may be implemented directly. `OPEN` behavior must not be invented by an implementation agent.

## Primary external references

- https://github.com/HorizenOfficial/vela-starterkit
- https://github.com/HorizenOfficial/vela-nova
- https://github.com/HorizenOfficial/vela
- https://github.com/HorizenOfficial/vela-facilitator
- https://docs.zkverify.io/architecture/supported_proofs
- https://docs.zkverify.io/architecture/verification_pallets/ultrahonk
- https://docs.zkverify.io/overview/zkverifyjs
