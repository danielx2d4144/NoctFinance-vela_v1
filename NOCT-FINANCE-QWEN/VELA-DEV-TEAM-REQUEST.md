# Vela / Horizen Testnet — Information Request

**Project:** Noct Finance V1 (privacy-preserving lending market on Vela)
**Target:** Base Sepolia testnet, chain ID `84532`
**Date:** 2026-09-27
**Status:** Blocking deployment. Days 5, 6, 13 and 14 of our delivery plan cannot complete without these answers.

---

## Summary

We are building Noct Finance V1 against the Vela runtime and intend to deploy to your Base Sepolia testnet. We have verified the chain, the assets and the Pyth feed IDs ourselves. What we cannot derive without you are the **Vela core contract addresses**, the **oracle path on Base Sepolia**, the **USDC allowlist status**, and a **genuine `novaw-linux` CLI**.

Ten questions below. Each states why we need it and the exact format that unblocks us.

**Answering B7, B8 and B9 first would unblock the most work.**

---

## What we have already verified

Please correct us if any of this is wrong — we would rather find out now than at deployment.

| Item | Value | How verified |
|---|---|---|
| Chain | Base Sepolia | Confirmed this, **not** the Horizen L3 chain, is the Vela testnet target |
| Chain ID | `84532` | Live RPC `eth_chainId` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | On-chain `decimals()=6`, `symbol()="USDC"` |
| tZEN | `0x107fdE93838e3404934877935993782F977324BB` | On-chain `decimals()=18` |
| Pyth ETH/USD feed ID | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | Pyth official registry |
| Pyth ZEN/USD feed ID | `0xd183ffe0155e8a55e7274155a14ea2e8b54059cef471f88fa3f7eb4b5d8dbc24` | Pyth official registry |
| Vela core images | `horizen/cce-*:v0.2.0` | `docker-compose.yml`; tag verified, **source commit and image digest unknown** |
| `vela-common-go` | `v0.2.0` | `go.sum` hashes |
| Toolchain | Go `1.24.0` + TinyGo `0.39.0` | Pinned and asserted in our `build.sh`; `-scheduler=none` builds clean |

We also note **Hermes now requires a Pyth API key** — confirmed on our side.

---

## Blocking questions

### B1 — `ProcessorEndpoint` address on Base Sepolia
**Why:** this is our sole request entry point. Our architecture forbids a direct-enclave shortcut, so without it there is no request path at all.
**Want:** deployed address + the ABI or source we should bind against, and confirmation it is the current version.

### B2 — `TEEAuthenticator` address
**Why:** required to authenticate inbound receipts and oracle updates. Unauthenticated deliveries must be rejected, and we cannot test rejection without the real contract.
**Want:** address + expected authentication scheme.

### B3 — `TokenAllowlist` address
**Why:** governs which custody tokens are acceptable.
**Want:** address + whether allowlisting is permissioned, and if so who the permissioned role holder is.

### B4 — `AuthorityRegistry` address
**Why:** needed to resolve which authorities we may accept deliveries from.
**Want:** address + how to query the current authority set.

### B5 — Is testnet `resetOperator` non-zero?
**Why:** if it is non-zero, an operator can reset state beneath us. We need to know whether to treat testnet state as durable, and whether our replay bindings survive a reset.
**Want:** yes/no, and if yes, the address and the reset semantics.

### B6 — Is USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` already allowlisted?
**Why:** it is our primary custody asset. If it is not allowlisted, we need the process to add it.
**Want:** yes/no. If no, the request path and expected turnaround.

---

### B7 — Pyth `IPyth` address on Base Sepolia, or your recommended oracle
**Why:** this is our single largest open risk. Our deployment spec requires every feed ID be verified against the **deployed `IPyth` contract**, not merely against Pyth's website. Candidate addresses we found appear stale or invalid, and your documented oracle partner is **Stork**, which does not by itself tell us the Base Sepolia path.
**Want:** either (a) the canonical `IPyth` address on Base Sepolia, or (b) an explicit recommendation to use Stork or another oracle, with its Base Sepolia address and update mechanism.

### B8 — Real `novaw-linux` CLI
**Why:** the artifact we have resolves to a **9-byte `Not Found` placeholder**. Our deployment spec fails closed on exactly this condition, so we cannot deploy the guest without a genuine binary.
**Want:** a working `novaw-linux` (or `novaw-linux.zip`), its expected SHA256 so we can verify what we receive, and the version/commit it corresponds to.

### B9 — Testnet access / deployment whitelisting
**Why:** we need to know whether deploying a Vela application to your Base Sepolia testnet is permissionless or gated.
**Want:** whether an allowlist application is required and the process if so, plus how `velaApplicationID` is assigned. We must read the real assigned value and freeze it; we are not willing to assume it.

### B10 — USDC/USD price source
**Why:** our deployment spec requires **exactly three** distinct Pyth feed IDs — USDC, ETH and ZEN. We have confirmed ETH/USD and ZEN/USD but have no USDC/USD feed. We are unwilling to silently hardcode USDC = $1, because that would make our committed oracle state incorrect and would mask a depeg.
**Want:** either a USDC/USD Pyth feed ID valid on Base Sepolia, or your view on whether a fixed-peg assumption is acceptable for testnet.

---

## Also useful (non-blocking)

- Source commit and image digest for `horizen/cce-*:v0.2.0` — we can verify the tag but cannot yet reproduce the image.
- Any published Base Sepolia deployment manifest or canonical address list we should be reading instead of asking about.
- Confirmation of the `ProcessResult.Withdrawals`, authenticated receipt and TRUSTPROCESS integration APIs for the pinned Vela version.

---

## Our timeline

We are running a 14-day plan to a Base Sepolia testnet deployment.

| Question | Blocks |
|---|---|
| B8 | Day 1 |
| B7, B10 | Day 5 (oracle adapter) |
| B1–B4, B6 | Day 6 (custody + deposit path) |
| B1–B9 | Days 13–14 (deployment and launch) |

Everything else proceeds locally in the meantime, so a partial answer still unblocks real work.

---

## Contact

**Project:** Noct Finance V1 · **Repository:** `noctfinance-vela`

---

*Send this document to the Vela / Horizen developer channel. Record each answer in `14-DAY-ROADMAP.md` under both the Blockers table and the Blocker resolution log, citing the reply as the source.*
