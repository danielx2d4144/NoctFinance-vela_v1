# Noct Finance V1 — 14-Day Delivery Roadmap

**Target:** public testnet deployment on **Base Sepolia** (chain ID `84532`) on Day 14.
**Created:** 2026-09-27
**Normative sources:** `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/` (Files 01–34) and `TOOLCHAIN-LOCK.md`.
**Compressed baseline:** `34-IMPLEMENTATION-ROADMAP.md` (33 weeks / 12 phases).

---

## How to use this file

1. Work one day at a time, top to bottom.
2. Tick each `- [ ]` deliverable only when it is genuinely finished — not when started.
3. A day is **Done** only when its **Exit gate** passes. The gate is the contract; deliverables are the means.
4. When a day is Done, fill in its **Completion record** (date, commit SHA, evidence) and flip its row in the Summary tracker to ✅.
5. Never mark a day Done on the strength of a test suite that does not actually exercise the stated gate.
6. If a day slips, record the slip and reason in the Completion Log. Do not silently renumber days.
7. If a blocker is resolved, record the answer in the Blockers table **and** cite the source (tx hash, doc URL, dev-team reply).

**Status legend:** ⬜ Not started · 🟡 In progress · ✅ Done · ⛔ Blocked (external dependency)

---

## ⚠️ Scope reality check — read before starting

`34-IMPLEMENTATION-ROADMAP.md` specifies **33 weeks across 12 phases** to reach testnet. This file compresses that into **14 days**. That is only possible by deliberately cutting scope. The cuts are real reductions in assurance, not scheduling optimism, and they are listed in full under [Deferred scope](#deferred-scope-out-of-the-14-day-sprint).

**What 14 days buys:** a working end-to-end **deposit → supply → borrow → repay → liquidate** path, driven by real Pyth prices, deployed and exercised on Base Sepolia.

**What it does not buy:** ZK proofs, an external audit, or mainnet readiness.

**Largest cut — ZK.** File 34 Phases 7 and 8 (ZK benchmarking + UltraHonk/zkVerify, 6 weeks) are removed entirely. Consequently `circuitID` and `vkHash` (public inputs 4 and 5) remain OPEN, and File 31 deployment assertion 8 (public-input width ≤ 32) cannot be evaluated at all. A Day 14 deployment is therefore **unproven**: it demonstrates plumbing, not the trust model in File 06. This must be stated in any public testnet announcement.

**Second cut — `noctmath` stays unaudited.** File 34 Phase 2 requires an *audited* TinyGo-compatible U256 library. `noctmath` is hand-written, with 94.2% statement coverage, golden vectors, and differential testing against `math/big`. Per File 34 that is explicitly **not** an audit, and the line "MUST NOT be marked complete on the strength of the test suite alone." This sprint records it as a hand-written kernel with the audit deferred to pre-mainnet — i.e. it takes resolution branch (b) of the SPEC-10 property 5 conflict, and that choice must be made deliberately, not by drift.

---

## Verified constants — safe to hardcode

Confirmed on-chain or from official registries during pre-flight. Do not re-derive these from memory or from stale docs; they were checked against the live chain and Pyth's registry.

| Item | Value | Status |
|---|---|---|
| Chain | Base Sepolia (**not** the Horizen L3 chain) | ✅ Verified |
| Chain ID | `84532` | ✅ Verified via live RPC |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | ✅ `decimals=6`, `symbol=USDC` |
| tZEN | `0x107fdE93838e3404934877935993782F977324BB` | ✅ `decimals=18` |
| Pyth ETH/USD feed ID | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` | ✅ Exists in Pyth registry |
| Pyth ZEN/USD feed ID | `0xd183ffe0155e8a55e7274155a14ea2e8b54059cef471f88fa3f7eb4b5d8dbc24` | ✅ Exists in Pyth registry |
| Go | `1.24.0` (`GOTOOLCHAIN=local`) | ✅ Pinned, asserted by `build.sh` |
| TinyGo | `0.39.0` | ✅ Pinned, asserted by `build.sh:33` |
| **Vela `ProcessorEndpoint`** (Base Sepolia) | `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` | ✅ Reply + `eth_getCode` (46,494 hex chars) + status page — three sources agree |
| **Vela `TEEAuthenticator`** (Base Sepolia) | `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3` | ✅ Reply + `eth_getCode` (7,396 hex chars) |
| **Vela RPC** (Base Sepolia) | `https://sepolia.base.org` | ✅ Live RPC answered `eth_chainId = 0x14a34` |
| **Vela SubGraph** (Base Sepolia) | `https://api.goldsky.com/api/public/project_cml7x1bnbintv01xu7tih85gl/subgraphs/vela-base-sepolia/0.2.0/gn` | ✅ Reply + status page agree |
| **Vela protocol version** | `0.2.0` | ✅ Facilitator, subgraph, `vela-nova` release and our pinned `vela-common-go` all agree |
| **Gasless facilitator** (Base Sepolia) | wallet `0xd028cC273cC9A512ed074C7139d813f002e52D06`; `/submit` `/claim` `/verify` `/settle` `/supported` | ✅ Status page |
| `vela-nova` app ID (Base Sepolia) | `11579806367557720661` | ✅ **Reference only — NOT ours.** Ours is assigned at deploy time, which is blocked by B11 |

⚠️ **Event-name correction.** The Horizen reply says `OnChainRefound`; the real event is
**`OnChainRefund`**. The reply also omits `OnChainWithdrawal` and `ClaimExecuted`. Bind
against the five real names — see `VELA-TESTNET-CONSTANTS.md` §4. Code written from the
reply's spelling would silently match nothing, which is the worst failure mode.

The Go and TinyGo pins are a **pair**, not two independent numbers: TinyGo `0.39.0` rejects Go 1.26+, so `1.24.x` is the upper-compatible choice. Decimals above already satisfy File 31 assertion 1 (USDC=6, ZEN=18).

Hermes now requires a **Pyth API key** — provision it as a secret (File 31 secret management), never committed.

---

## ⛔ External blockers — Vela / Horizen dev team

Days 5, 6, 13 and 14 **cannot complete** without these answers. The request was prepared in `VELA-DEV-TEAM-REQUEST.md` and has now been **sent**; the Horizen team replied in three parts. **Part 1 received 2026-09-28 and recorded in `VELA-TESTNET-CONSTANTS.md`** — it resolved B1, B2, B8 and B9, partially advanced B4 and B6, and surfaced a new critical blocker B11 (`DEPLOYER_ROLE`). Parts 2 and 3 are still pending. Log each answer here with its source.

| # | Blocker | Blocks | Answer | Source |
|---|---|---|---|---|
| B1 | `ProcessorEndpoint` address on Base Sepolia | 6, 13, 14 | ✅ `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` — verified on-chain | Reply pt.1 + `eth_getCode` + status page |
| B2 | `TEEAuthenticator` address | 6, 13, 14 | ✅ `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3` — verified on-chain | Reply pt.1 + `eth_getCode` |
| B3 | `TokenAllowlist` address | 6, 13, 14 | ✅ `0x8774E760B45a60a15B75770Fd7c60338006beEfa` — **self-derived** from `ProcessorEndpoint.tokenAllowlist()`, 2,096 B of code | On-chain probe, §8.1 |
| B4 | `AuthorityRegistry` address | 6, 13, 14 | ✅ `0x754a26f68E3E4Fab1BD05FB6B227bedEC2e732d3` — **self-derived** from `authorityRegistry()`, 1,124 B. A contract does exist; the reply's HTTP URL is a service in front of it | On-chain probe, §8.1 |
| B5 | Is testnet `resetOperator` non-zero? | 13, 14 | ✅ **Premise was wrong.** No `resetOperator()` exists; `RESET_OPERATOR()` returns a *role hash* `0xc580ee…5917`, held by Horizen's deployer | On-chain probe, §8.2 |
| B6 | Is USDC `0x036C…dCF7e` already allowlisted? | 6, 13 | ✅ **YES** — the subgraph's `TokenAllowed` holds exactly one token and it is our USDC (block 43,658,026). **tZEN is NOT allowlisted** → see B12 | Subgraph query, §8.1 |
| B7 | Pyth `IPyth` address on Base Sepolia (or the recommended oracle path) | 5, 13, 14 | ⬜ Not in pt.1 — **still the largest technical risk** | — |
| B8 | Real `novaw-linux` CLI | 1 | ✅ Real 14,034,960-byte asset at `vela-nova` release `v0.2.0`, SHA-256 `6ab01f2f…8941a2`; also buildable from public Go source | GitHub release API |
| B9 | Testnet access / deployment whitelisting | 13, 14 | ✅ **PERMISSIONED** — "only Horizen can deploy new apps". Escalated to B11. ⚠️ The reply's "only `vela-nova` is installed" is **incomplete**: a second app `4474814306369175243` exists, deployed by the same sender (§8.4) | Reply pt.1 + subgraph |
| B10 | USDC/USD price source | 5 | ⬜ Not in pt.1 | — |
| **B11** | **`DEPLOYER_ROLE` on the Base Sepolia `ProcessorEndpoint`** — new, derived from pt.1 | **13, 14** | ⛔ **CRITICAL.** Role hash proven: `0xfc425f22…184c`. Horizen's deployer `0x2eaaf2…aacb8` holds it but is **not** `DEFAULT_ADMIN_ROLE`, so the grant must come from whoever holds the admin key | Reply pt.1 + on-chain probe, §8.3 |
| **B12** | **tZEN is not on the `TokenAllowlist`** — new, found by probing | **6** | ⛔ The allowlist contains USDC only. Either Horizen allowlists tZEN `0x107f…24BB`, or Day 6 is re-scoped to USDC-only | Subgraph `TokenAllowed`, §8.8 |

> Full detail, verification method, the event-name correction and the exact B11 ask live in
> **`VELA-TESTNET-CONSTANTS.md`**. Parts 2 and 3 of the Horizen reply are still pending and
> must be appended there — do not rewrite what is already recorded.

**B7 note.** Horizen's documented oracle partner is **Stork**, which does not by itself confirm a Base Sepolia path. Prior candidate Pyth addresses were found stale or invalid. Until `IPyth` is confirmed, Day 5 can only be built against a local/mock adapter — which is legitimate work but is **not** evidence of a live oracle, and must not be recorded as such.

**B10 is a real design gap, not a formality.** File 31 assertion 4 requires **exactly three** distinct Pyth feed IDs (USDC, ETH, ZEN), each copied from Pyth's official registry and verified against the deployed `IPyth`. Only ETH/USD and ZEN/USD are confirmed. Either a USDC/USD feed ID is obtained, or the three-feed requirement is formally re-scoped for testnet with the decision written down. **Do not silently hardcode USDC = $1.** That would make `oracleCommitment` a lie in exactly the way assertion 3 warns about, and it would hide a depeg.

---

## Summary tracker

Update this table as days complete. **Days complete: 0 / 14.**

| Day | Theme | File 34 phase | Status | Completed | Evidence |
|---|---|---|---|---|---|
| 1 | Toolchain truth reset | Phase 0 | 🟡 | partial | `tools/build-guest.ps1`, `artifacts/BUILD-EVIDENCE.md`, `VELA-TESTNET-CONSTANTS.md` |
| 2 | Monorepo + local Vela stack | Phase 0 / 1 | ⬜ | — | — |
| 3 | `NoctStateV1` + `noctmath` promotion | Phase 2 | ⬜ | — | — |
| 4 | State commitment & File 09 subroots | Phase 2 | ⬜ | — | — |
| 5 | Oracle adapter (Pyth / File 18) | Phase 3 dep. | ⛔ B7, B10 | — | — |
| 6 | Custody ingress + deposit path | Phase 3 | 🟢 B12 only (B1–B4, B6 ✅) | — | — |
| 7 | Borrow + interest accrual | Phase 3 / 4 | ⬜ | — | — |
| 8 | Repay (two-phase T07/T08) | Phase 5 | ⬜ | — | — |
| 9 | Liquidation + discovery (T09/T10) | Phase 6 | ⬜ | — | — |
| 10 | Replay protection + failure recovery | Files 22, 23 | ⬜ | — | — |
| 11 | Deployment assertions + hardening | File 31 | ⬜ | — | — |
| 12 | SDK, indexer, dashboard | Phase 9 | ⬜ | — | — |
| 13 | Base Sepolia deploy + E2E | Phase 9 / 11 | ⛔ **B11**, B3–B7, B10 | — | — |
| 14 | Testnet launch + go/no-go | Phase 11 | ⛔ **B11** + Day 13 | — | — |

⛔ means the day has an unresolved external dependency. Work can often proceed against mocks, but the day **cannot be marked Done** until the blocker is answered — a green test against a mock is not a green test against Base Sepolia.

---

# Day-by-day plan

## Day 1 — Toolchain truth reset
**File 34 phase:** 0 · **Status:** 🟡 In progress — toolchain/guest subset **complete and evidenced**; blocker B8 is now **answered** (download + hash-verify still outstanding) and the environment pins remain open

**Why this is first:** every later day builds on the guest artifact and on `TOOLCHAIN-LOCK.md` as its evidence record. Building Days 2–14 on top of placeholder WASM and a lock file containing a false verified-artifact claim would poison all downstream evidence. Fixing the truth is cheaper now than at Day 13.

### Correction to this day's own premises

Three deliverables below were written from a misdiagnosis, and the evidence now contradicts them. They are retained, struck through, with the finding recorded — deleting a wrong premise silently is how it comes back.

**The guest artifacts were never broken.** `guest_final.wasm` was a correct `-scheduler=none` build all along (`total=6 asyncify=false`). What was false was the *evidence describing it*: `artifacts/imports_guest.txt` recorded `total=14 asyncify=true` because it had been generated from `noct-demo-default.wasm`, the default asyncify build. Timestamps settle it — that evidence is 12:37–12:39, the pinned toolchain arrived 13:11–13:15, and `guest_final.wasm` is 13:41.

The real defect was that **nothing enforced the toolchain pair on Windows**. `build.sh` asserts both versions and sets `GOROOT`, but needs a POSIX shell; invoking a bare `tinygo` resolved to system TinyGo `0.42.0` + Go `1.27.1`, which cannot link `-scheduler=none` and silently falls back to asyncify.

### Deliverables

- [x] ~~Remove the two identical asyncify guest `.wasm` files from `artifacts/`~~ — **premise wrong.** They were identical `-scheduler=none` builds (`asyncify=false`), not asyncify. Removed as exact byte-duplicates of the canonical `guest_final.wasm` (SHA256 verified equal before deletion).
- [x] ~~Remove or replace `wasmoptstub.exe` — it is **not** real `wasm-opt`~~ — **partly wrong.** It is legitimately valid for `-scheduler=none` verification, since there is no Asyncify transform to apply. The real defects were that `tools/wasmoptstub.exe` had never been built, and that `tools/wasmoptstub` sits on the persistent PATH so a `wasm-opt.exe` placed there masquerades machine-wide as binaryen. Stub built; the shadowing copy removed; provenance now determined by asking the binary, not by its name.
- [x] ~~Correct the false verified-artifact claim in `TOOLCHAIN-LOCK.md`~~ — **premise wrong.** The `total=6 asyncify=false` claim was correct and is now independently reproduced. Three *other* values were false and are corrected: probe `123,840` → **16,625** bytes (it had been built without the mandated flags), golden `24/24` → **8/8** lines (`expected.txt` has 8 lines; no 24-line golden exists), coverage `94.6%` → **94.2%**.
- [ ] Obtain the real `novaw-linux` CLI (blocker B8) and verify it is not the 9-byte `Not Found` placeholder — SPEC-14 / File 31 assertion 9. **B8 ANSWERED 2026-09-28:** the real asset is `novaw-linux` from `HorizenOfficial/vela-nova` release `v0.2.0` (commit `44f6093`) — 14,034,960 bytes, SHA-256 `6ab01f2f0a4e5556a6d9bdc432058b372bdfa19b57e404d27f45df60368941a2`, or buildable from the public Go source with our pinned Go `1.24.0`. The box stays **unchecked** until the local file is downloaded and hashes to that digest; a known digest is not a verified artifact. See `VELA-TESTNET-CONSTANTS.md` §3.
- [x] ~~Strip `fmt`, `os` and `encoding/json` from the guest source; replace with WASM-safe equivalents~~ — **NOT REQUIRED; disproven.** Under the correctly paired pinned toolchain the guest links cleanly with `-scheduler=none` *including* `encoding/json`, `fmt` and the `utils.LogInfo` → `time.Sleep` path. That link failure was a property of Go 1.27.1, not of the guest code. Stripping the JSON codec would have destroyed the ABI for no benefit. Recorded so the work is not done later on the strength of the old diagnosis.
- [x] Rebuild the guest with canonical binary encoding — `tools/build-guest.ps1`
- [x] Prove the `asyncify=false` build succeeds — guest `total=6`, probe `total=3`, both `asyncify=false`
- [x] Prove the `-scheduler=none` build succeeds — links cleanly; no scheduler fallback
- [x] Record `sha256(noct-demo.wasm)` for the build — `E91DA072B9314381A2E3F05E7532011B2DA1E995C2ECBAF552BD2CB51A2DF44C`
- [x] Publish the deployable from the gated build — `noct-demo.wasm` had drifted to 966,462 bytes matching no mandated flag set while `deploy.js`, `quickstart.sh` and `demo-transaction.sh` all upload it; now synced, with a `.provenance.txt` sidecar
- [ ] Resolve the **Node** pin contradiction: `20.11.x` documented vs `v22.20.0` installed, no `.nvmrc`, no `engines` field. Pick one and make the evidence match the pin.
- [ ] Resolve the **package-manager** contradiction: pnpm `8.15.x` (File 34) vs `9.x` (README, TOOLCHAIN-LOCK) vs `11.5.2` installed — and only `deploy-scripts/package-lock.json` (npm) exists, with no `pnpm-lock.yaml` anywhere. npm is currently the only manager with reproducible evidence.
- [ ] Install Foundry
- [ ] Write the verified Base Sepolia constants (chain ID, USDC, tZEN, feed IDs, **plus the now-verified Vela `ProcessorEndpoint`, `TEEAuthenticator`, RPC and SubGraph URLs**) into config — see `VELA-TESTNET-CONSTANTS.md` §1. Do **not** copy the `vela-nova` `ApplicationID`; ours does not exist yet (B11).
- [ ] Install **real binaryen `wasm-opt`** and re-run `tools/build-guest.ps1 -Release`. Until then no release artifact exists; the gate refuses to publish one.

### Exit gate
`build.sh` passes with `-scheduler=none` **and** `asyncify=false`; WASM SHA256 recorded; `TOOLCHAIN-LOCK.md` contains no claim unsupported by evidence; `novaw-linux` is a genuine binary; every recorded pin matches the version that actually produced the evidence.

> A recorded pin that does not match the version that produced the evidence is not a pin.

| Gate criterion | Status | Evidence |
|---|---|---|
| Build passes with `-scheduler=none` | ✅ PASS | `tools/build-guest.ps1`, exit 0, clean log |
| Build passes with `asyncify=false` | ✅ PASS | guest `total=6`, probe `total=3`, `artifacts/imports_guest.txt` |
| WASM SHA256 recorded | ✅ PASS | `artifacts/BUILD-EVIDENCE.md`, `noct-demo.wasm.provenance.txt` |
| Build is reproducible | ✅ PASS | two builds in one run byte-identical; hash also reproduced across sessions |
| Deployable matches the verified build | ✅ PASS | `noct-demo.wasm` = 309,580 B = `guest_final.wasm` |
| `TOOLCHAIN-LOCK.md` has no unsupported claim | ✅ PASS | 3 false values corrected; see "Evidence hygiene" |
| Every recorded pin matches the evidence producer | ✅ PASS | TinyGo `0.39.0` + Go `1.24.0` asserted from TinyGo's own output |
| `novaw-linux` is a genuine binary | 🟡 **UNBLOCKED, NOT DONE** | B8 answered: real 14,034,960 B asset with published SHA-256 (`VELA-TESTNET-CONSTANTS.md` §3). The local file is still the 9-byte placeholder until downloaded and hash-verified |
| Node / package-manager pins resolved | ⬜ OPEN | not started |
| Foundry installed | ⬜ OPEN | not started |
| Base Sepolia constants in config | ⬜ OPEN | not started |
| Release artifact built with real binaryen | ⬜ OPEN | binaryen absent; `-Release` gate refuses (verified exit 2) |

**Day 1 is NOT complete.** The toolchain and guest-artifact truth reset is done and independently
reproducible, but the exit gate is conjunctive. B8 is now **answered** — the real `novaw-linux` is a published `v0.2.0` release asset with a known SHA-256 — yet answering a blocker is not the same as executing it: the local file is still the 9-byte placeholder, and the Node / package-manager / Foundry pins are untouched.

### Completion record
| Field | Value |
|---|---|
| Date completed | — (toolchain/guest subset completed 2026-09-27) |
| Commit SHA | — |
| WASM SHA256 | `E91DA072B9314381A2E3F05E7532011B2DA1E995C2ECBAF552BD2CB51A2DF44C` (`guest_final.wasm` = `noct-demo.wasm`, 309,580 B) |
| Probe SHA256 | `981C58F369C100542778D7DBBA0449742C0516F42C31783F8333118455E1B53D` (`probe_final.wasm`, 16,625 B) |
| Toolchain | TinyGo `0.39.0` (`using go version go1.24.0`, LLVM `19.1.2`), Go `1.24.0`, `GOROOT` explicit, `GOTOOLCHAIN=local` |
| Evidence (log / CI link) | `artifacts/BUILD-EVIDENCE.md`; quarantined pre-pin evidence in `artifacts/stale-prepin/` |
| Notes, slips, deviations | Three Day 1 premises were wrong and are struck through above with the finding recorded. The guest never needed `fmt`/`os`/`encoding/json` stripped — that was Go 1.27.1 failing to link, not a guest defect. The artifacts were correct; the evidence files describing them were stale. `wasm-opt` is the stub, so **no release artifact exists yet**; `-Release` correctly refuses. |

---

## Day 2 — Monorepo scaffold + local Vela stack
**File 34 phase:** 0 / 1 · **Status:** ⬜ Not started

### Deliverables
- [ ] Scaffold the monorepo with the package manager resolved on Day 1 (workspaces + Turborepo)
- [ ] Create workspaces: `contracts`, `guest`, `sdk`, `facilitator`, `indexer`, `dashboard`, `config`, `scripts`
- [ ] Add pinned-toolchain scripts (Go 1.24.0 / TinyGo 0.39.0 assertions reused from `build.sh`)
- [ ] Configure linters: `golangci-lint`, ESLint, Slither
- [ ] Add CI gates (GitHub Actions): toolchain-version check, guest build, contract build, lint, unit tests
- [ ] Stand up the local Vela Docker stack (`horizen/cce-*:v0.2.0`) and confirm it is healthy
- [ ] Record the Vela core image **source commit and digest** (tag is VERIFIED, digest is OPEN per File 31)
- [ ] Confirm `.env` is git-ignored; verify no secrets are committed
- [ ] Add CI failure on any placeholder artifact reintroduced

### Exit gate
`docker compose up` reaches healthy; CI is green on all checks; every workspace builds; a fresh clone builds WASM, contracts and SDK within 15 minutes (File 34 Phase 0 acceptance).

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Vela image digest | — |
| CI run link | — |
| Notes, slips, deviations | — |

---

## Day 3 — `NoctStateV1` + `noctmath` promotion
**File 34 phase:** 2 · **Status:** ⬜ Not started

### Deliverables
- [ ] Promote `noctmath` from `noct-demo-wasm/noctmath` into the shared monorepo package
- [ ] Carry over its existing evidence: golden vectors (`golden_test.go`), differential tests vs `math/big` (`differential_test.go`), 94.2% coverage, `go vet` clean
- [ ] Implement `NoctStateV1` exactly per File 08: global, reserve, oracle, configuration, commitment, private-account, pending-operation and receipt state
- [ ] Implement `PrivateAccount` with `cashUSDC`, `collateralUSDC`, `borrowedZEN`, `borrowedETH`, `scaledDebtZEN`, `scaledDebtETH`, `positionNonce`, `lastUpdateTimestamp` — **do not add principal or entry-index fields**
- [ ] Implement checked U256 financial types with canonical 32-byte big-endian encoding: WAD for amounts/prices/ratios, RAY for rates/indexes/scaled debt
- [ ] Verify `mulDivDown` / `mulDivUp` are full-width (true 512-bit intermediate)
- [ ] Restrict `uint64` to non-financial counters and time metadata; add a test that enforces this
- [ ] Implement account CRUD
- [ ] Re-run the WASI probe and diff its output line-for-line against the native Go golden under the pinned toolchain with `-scheduler=none`

### Exit gate
Full SPEC-10 surface present (`Add`, `Sub`, `Mul`, `Div`, `MulDivDown`, `MulDivUp`, `FromBytes32`, `ToBytes32`, `Cmp`); differential tests pass; WASI probe output matches the native golden; `uint64` restriction test passes.

**Record honestly:** this day delivers a *hand-written kernel*, not an audited library. File 34's Phase 2 line stays OPEN pending audit — see Deferred scope.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Test coverage | — |
| WASI-vs-golden diff | — |
| Notes, slips, deviations | — |

---

## Day 4 — State commitment & File 09 subroots
**File 34 phase:** 2 · **Status:** ⬜ Not started

### Deliverables
- [ ] Implement canonical `configCommitment` over the exact File 10 field order
- [ ] Implement canonical `oracleCommitment`
- [ ] Implement the five File 09 subroots: `accountRoot`, `reserveRoot`, `pendingOperationRoot`, and the remaining two per File 09
- [ ] Produce golden vectors for **all** leaves and subroots
- [ ] Bind `maxRiskDelaySeconds` in config so it equals the `NoctTrigger` value (File 31 assertion 3)
- [ ] Freeze the protocol configuration and derive `configCommitment`
- [ ] Implement complete replay state: monotonic position nonces, append-only consumed receipt IDs, committed operation IDs, deterministic withdrawal IDs, stored successful results (Files 08, 12, 23)

### Exit gate
Golden vectors for all leaves and subroots match (File 31 requires this at **every** environment gate — local, testnet and production). A commitment change alters its root deterministically. `configCommitment` is reproducible from frozen config.

> File 31 lists golden vectors as MUST at all three gates. This is the one assurance item that is **not** cut by the 14-day compression.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| `configCommitment` | — |
| Golden vector file | — |
| Notes, slips, deviations | — |

---

## Day 5 — Oracle adapter (File 18)
**File 34 phase:** 3 dependency · **Status:** ⛔ Blocked on B7, B10

### Deliverables
- [ ] Implement the Solidity `OracleAdapter` consuming Pyth price updates
- [ ] Wire the two confirmed feed IDs (ETH/USD, ZEN/USD) from the Verified constants table
- [ ] Resolve the USDC/USD feed question (B10) — obtain a third feed ID **or** write down a formal re-scope of assertion 4
- [ ] Confirm the `IPyth` address on Base Sepolia (B7); verify each feed ID against the deployed contract
- [ ] Implement staleness check against `maxOracleStalenessSeconds`
- [ ] Implement deviation check and confidence-interval handling
- [ ] Enforce `0 < maxRiskDelaySeconds <= maxOracleStalenessSeconds`
- [ ] Implement the accepted-epoch model: transitions read only the latest **accepted** oracle state
- [ ] Ensure oracle updates arrive only through the authenticated TRUSTPROCESS delivery path — unauthenticated calls rejected
- [ ] Provision the Hermes Pyth API key as a secret

### Exit gate
`OracleAdapter` accepts a genuine Pyth update on Base Sepolia and rejects stale, deviating and unauthenticated inputs. Feed IDs verified against the deployed `IPyth`, not just against Pyth's website.

**If B7/B10 are unresolved:** build and test against a local mock adapter, and mark the day ⛔ — not ✅. Record explicitly that no live-oracle evidence exists yet.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| `IPyth` address | — |
| USDC/USD resolution | — |
| Notes, slips, deviations | — |

---

## Day 6 — Custody ingress + deposit path
**File 34 phase:** 3 · **Status:** 🟢 Substantially unblocked — B1, B2, B3, B4 and B6 are all now **verified addresses/facts**; blocked on **B12** (tZEN not allowlisted) and on B11 for anything touching deployment

### Deliverables
- [ ] Integrate `ProcessorEndpoint` as the sole request entry point — no direct-enclave shortcut. **Address now known and verified:** `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` on Base Sepolia (B1 ✅). Entry points are `submitRequest()` / `submitRequestFor()` (the latter is what the gasless facilitator uses).
- [ ] Integrate `TEEAuthenticator`, `TokenAllowlist`, `AuthorityRegistry`. **All three addresses are now known and verified:** `TEEAuthenticator` `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3` (B2 ✅), `TokenAllowlist` `0x8774E760B45a60a15B75770Fd7c60338006beEfa` (B3 ✅), `AuthorityRegistry` `0x754a26f68E3E4Fab1BD05FB6B227bedEC2e732d3` (B4 ✅ — a contract *does* exist; the `AuthorityServiceURL` in the reply is an HTTP service in front of it, not a substitute). ⚠️ Their **ABIs are unknown**: every guessed accessor reverted (§8.6), so read their state from the Goldsky subgraph rather than from contract getters.
- [x] Confirm whether USDC `0x036C…dCF7e` is already allowlisted (B6) — **YES.** Verified from the subgraph's `TokenAllowed` entities: exactly one token is allowlisted and it is our USDC (block 43,658,026). No allowlisting action needed for USDC.
- [ ] Implement custody ingress for USDC and tZEN. ⛔ **B12: tZEN is NOT allowlisted** — the `TokenAllowlist` holds USDC only, so a tZEN deposit fails until Horizen adds it. Build the USDC path first and gate tZEN behind B12; do not ship a two-asset ingress against a one-asset allowlist, and do not paper over it by silently dropping tZEN from the design without recording the decision.
- [ ] Implement the request lifecycle per File 21 (submit → Manager/Executor → `stateUpdate`)
- [ ] Implement T01 deposit transition against the File 12 state machine
- [ ] Implement P-521 ECDH encryption/decryption in the guest. **Assumption now externally confirmed:** the facilitator's `ASSOCIATEKEY` path takes a raw **133-byte P-521 public key** encoded `0x04 ‖ x ‖ y` (`VELA-TESTNET-CONSTANTS.md` §6.1). Match that encoding exactly — it is a third-party-pinned format, not our choice.
- [ ] Return native `ProcessResult.Withdrawals` bindings deterministic withdrawal ID, asset, amount and destination
- [ ] Implement authenticated delivery hooks for inbound receipts and oracle updates
- [ ] Verify private state persists across enclave restart

### Exit gate
Client sends an encrypted request → enclave decrypts, processes, returns an encrypted response → state persists across restart → a test transition returns a **native** withdrawal binding → duplicate result delivery is deduplicated by the pinned runtime → unauthenticated receipt/oracle calls are rejected. Record p50/p95/p99 latency for the real `ProcessorEndpoint → Manager/Executor → stateUpdate` path.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Vela contract addresses | `ProcessorEndpoint` `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` ✅ · `TEEAuthenticator` `0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3` ✅ · `TokenAllowlist` ⬜ B3 · `AuthorityRegistry` 🟡 B4 (HTTP URL only) |
| Latency p50/p95/p99 | — |
| Notes, slips, deviations | — |

---

## Day 7 — Borrow + interest accrual
**File 34 phase:** 3 / 4 · **Status:** ⬜ Not started

### Deliverables
- [ ] Implement interest accrual per File 19: RAY `borrowIndex`, upward-rounded accrual, `lastAccrualTimestamp`
- [ ] Enforce reserve-level accrual before any risk check
- [ ] Implement T04 borrow with collateral-factor check against the latest accepted oracle state
- [ ] Implement cross-asset WAD valuation (debt asset → USD → collateral asset)
- [ ] Enforce `collateralFactorWad < liquidationThresholdWad` strictly for every asset
- [ ] Update reserve `totalScaledDebt` and account `scaledDebt*` atomically
- [ ] Emit the borrow withdrawal through native `ProcessResult.Withdrawals`
- [ ] Set genesis reserve state per File 31 assertion 10: `borrowIndex = RAY`, `totalScaledDebt = 0`, `writtenOffDebtUsd = 0`, `protocolBadDebtUsd = 0`, `stateVersion = 0`

### Exit gate
E2E: deposit USDC → supply → borrow 100 ZEN → advance accepted oracle time → accrue → balances and indexes match hand-computed golden values. Borrow fails when it would breach the collateral factor. No debt mutation occurs without the matching atomic ledger credit.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| E2E test link | — |
| Notes, slips, deviations | — |

---

## Day 8 — Repay (two-phase T07 / T08)
**File 34 phase:** 5 · **Status:** ⬜ Not started

### Deliverables
- [ ] Implement T07 `PREPARE_REPAY`: binds operation ID and pre-payment TTL, with **no** debt or liquidity mutation
- [ ] Capture the exact prepared debt-asset payment through the authenticated trigger/escrow path; bind its finalized inbound receipt to the operation ID
- [ ] Implement TRUSTPROCESS-only T08 `COMMIT_REPAY`: atomically consume the receipt, subtract stored scaled reduction from account **and** reserve, credit available liquidity, remove the lock, store the committed result
- [ ] Full repayment = exact current upward-rounded debt with all scaled debt cleared
- [ ] Partial repayment = nonzero `mulDivDown(payment, RAY, index)` reduction
- [ ] Reject dust and partial requests where amount ≥ current debt
- [ ] Retry captured-payment commits until idempotently successful
- [ ] Permit expiry only while `PREPARED` — never after payment capture

### Exit gate
E2E: borrow 100 ZEN → advance accepted oracle time → accrue → prepare → capture exact receipt → commit. Prepare does not reduce debt or increase liquidity. No commit succeeds without a matching unconsumed authenticated receipt. After payment capture, timeout/retry never refunds or expires the operation; lost acknowledgements return the original result without a second mutation.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Crash-recovery tests passed | — |
| Notes, slips, deviations | — |

---

## Day 9 — Liquidation + discovery (T09 / T10)
**File 34 phase:** 6 · **Status:** ⬜ Not started

File 34 allocates **5 weeks** to this phase. One day is the most aggressive compression in the sprint; the bad-debt and dashboard items are explicitly deferred.

### Deliverables
- [ ] Implement T09 `PREPARE_LIQUIDATION`: fresh accepted oracle state, both reserves accrued, liquidation-threshold re-verification, close-factor enforcement, exact cross-asset WAD valuation, exclusive debt/collateral locks
- [ ] Implement the liquidation bot with privileged private candidate discovery over scaled debt and the latest accepted `OracleState` (File 20)
- [ ] Implement authenticated trigger/escrow payment capture bound to the prepared operation ID
- [ ] Implement TRUSTPROCESS-only T10 `COMMIT_LIQUIDATION`: consume receipt, apply stored scaled reduction, credit reserve liquidity, debit borrower collateral, emit the operation-ID-derived USDC `ProcessResult.Withdrawals` entry atomically
- [ ] Treat prepare / capture / commit as separate phases — do **not** assume cross-contract EVM atomicity
- [ ] Enforce close factor against upward-rounded current debt
- [ ] Compute seized USDC via debt-asset price → USD → USDC, plus configured bonus, with specified upward rounding and collateral cap
- [ ] Reject zero scaled reduction and zero-payment seizure
- [ ] Enforce `0 < closeFactorWad <= WAD`, `liquidationBonusWad <= WAD`, `0 < minLiquidationDebtUsdWad`

### Exit gate
Preparation succeeds only when `debtUsd > floor(collateralUsd × liquidationThreshold)` using a fresh accepted epoch, and **fails if the position recovered**. Commit is impossible without the exact finalized payment receipt. Flash-crash simulation (60% accepted Pyth price drop) produces correct liquidations with no invariant break.

**Deferred from this day:** explicit dust/insufficient-collateral bad-debt handling, and the liquidation monitoring dashboard. Both are listed under Deferred scope and must be closed before mainnet.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Flash-crash sim result | — |
| Notes, slips, deviations | — |

---

## Day 10 — Replay protection + failure recovery
**File 34 phase:** Files 22, 23 · **Status:** ⬜ Not started

### Deliverables
- [ ] Complete replay bindings: monotonic position nonces, append-only consumed receipt IDs, committed operation IDs, deterministic withdrawal IDs
- [ ] Reject stale and cross-context inputs
- [ ] Preserve idempotent results through repeated delivery
- [ ] Implement failure recovery per File 22 across facilitator, OracleAdapter and TRUSTPROCESS delivery failure
- [ ] Run crash tests at every phase boundary: before/after receipt capture, commit, acknowledgement
- [ ] Verify conservation invariants hold after every crash point
- [ ] Verify no debt reduction without single-use receipt consumption
- [ ] Verify no native withdrawal without the matching atomic ledger debit
- [ ] Audit error strings and timing for privacy leakage (File 24)

### Exit gate
100 crash tests pass with deterministic idempotent recovery. Duplicate results and duplicate receipts are deduplicated. No conservation-invariant break under adversarial ordering. No privacy leakage detected in timing analysis or error-string audit.

> File 34 Phase 10 requires 100K fuzzing iterations for conservation invariants. This day runs the **100 crash tests** only; the fuzzing campaign is deferred.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Crash tests passed | — / 100 |
| Notes, slips, deviations | — |

---

## Day 11 — Deployment assertions + contract hardening
**File 34 phase:** File 31 / 10 · **Status:** ⬜ Not started

### Deliverables
- [ ] Implement **all 10 File 31 deployment assertions** as fail-closed checks — deployment MUST abort, not warn
  - [ ] 1. Token decimals: on-chain `decimals()` equals committed `nativeDecimals` (6 USDC, 18 ETH, 18 ZEN)
  - [ ] 2. Config bounds: `collateralFactorWad < liquidationThresholdWad`; `liquidationBonusWad <= WAD`; `0 < closeFactorWad <= WAD`; `0 < minLiquidationDebtUsdWad`; `RAY < maxQuoteIndexDriftRay <= 1.2 * RAY`; `0 < maxRiskDelaySeconds <= maxOracleStalenessSeconds`
  - [ ] 3. Oracle delay agreement: `NoctTrigger.maxRiskDelaySeconds` equals the value inside `configCommitment`
  - [ ] 4. Feed IDs: exactly three distinct Pyth feed IDs, each verified against the deployed `IPyth`
  - [ ] 5. Identity freeze: `velaApplicationID` and `chainID` read from the actual Vela deployment, never assumed
  - [ ] 6. Governance: `governanceIdentity` set, is a multisig, is frozen; `T13` unreachable from any user request path
  - [ ] 7. Arithmetic kernel: checked U256 kernel present and conformance vectors pass
  - [ ] 8. Public-input width ≤ 32 for the pinned backend — **cannot be evaluated, ZK deferred** (record as N/A with reason)
  - [ ] 9. Vela Nova: `novaw-linux.zip` is not the 9-byte `Not Found` placeholder
  - [ ] 10. Genesis state per reserve: `borrowIndex = RAY`, `totalScaledDebt = 0`, `writtenOffDebtUsd = 0`, `lastAccrualTimestamp` = initial accepted oracle timestamp; `protocolBadDebtUsd = 0`; `stateVersion = 0`
- [ ] Run Slither; resolve all critical and high findings
- [ ] Measure gas for custody ingress, OracleAdapter updates, and trigger/escrow capture
- [ ] Implement the custody reconciliation harness (File 11)
- [ ] Clear every OPEN row in `TOOLCHAIN-LOCK.md` that is required for testnet — File 31 makes this a **MUST** at the testnet gate

### Exit gate
All assertions abort deployment on mismatch (proved by deliberately injecting each failure). No critical/high Slither findings. Gas costs recorded. `TOOLCHAIN-LOCK.md` free of OPEN rows blocking testnet.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Assertions passing | — / 10 |
| Slither crit/high | — |
| Notes, slips, deviations | — |

---

## Day 12 — SDK, indexer, dashboard
**File 34 phase:** 9 · **Status:** ⬜ Not started

### Deliverables
- [ ] TypeScript client bridge: encrypt request, submit to `ProcessorEndpoint`, decrypt response
- [ ] SDK covering deposit, supply, borrow, repay, liquidate
- [ ] Indexer for on-chain events and operation state
- [ ] Dashboard UI: position view, health factor, reserve state, operation status
- [ ] Liquidation and captured-receipt monitoring view
- [ ] Metrics: operation-specific p95/p99 latency, claim availability, wallet delivery, multi-phase commit timings
- [ ] Graceful-degradation UX for facilitator, OracleAdapter and TRUSTPROCESS delivery failure

### Exit gate
A user can complete deposit → borrow → repay through the UI against the **local** stack, with correct health factor and reserve state displayed. Latency metrics recorded from real measurements — no unmeasured SLA and no direct-enclave shortcut cited as evidence.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Preview URL | — |
| Notes, slips, deviations | — |

---

## Day 13 — Base Sepolia deployment + E2E
**File 34 phase:** 9 / 11 · **Status:** ⛔ Blocked on **B11 (critical)**, B3–B7, B10

**Hard rule:** do not attempt this day until the remaining blockers are answered. A deployment against guessed addresses is not a deployment. B1 and B2 are now verified, which removes the *address-guessing* failure mode — but it does not make this day reachable.

> ⛔ **B11 is a hard external stop, and it is new.** Part 1 of the Horizen reply states that
> deployment is **permissioned**: "only Horizen can deploy new apps", and the only app
> installed on either instance is `vela-nova`. The `vela-nova` wallet README names the
> mechanism — the deploy sender must hold **`DEPLOYER_ROLE`** on `ProcessorEndpoint`.
>
> Therefore **"Register the Vela application" below is not something we can do.** No amount
> of local engineering closes this. The day must be re-scoped from *we deploy* to *we hand
> over a hash-verified artifact plus a deploy request, and consume whatever `ApplicationID`
> comes back*. Until that grant exists, every downstream item that depends on our own
> `velaApplicationID` (assertion 5, genesis state, replay protection) is unreachable, and
> the E2E cannot run. This supersedes the old B9 "is it permissionless?" question — the
> answer is no.
>
> Note also that assertion 5 becomes *more* important under this model, not less: the ID will
> arrive out-of-band from a third party, so it must be read back from the chain or from their
> deploy receipt and cross-checked, never transcribed once and trusted.

### Deliverables
- [ ] Confirm all blocker answers are recorded in the Blockers table with sources
- [ ] Fund the deployer; verify `chainID = 84532` from the live RPC
- [ ] Deploy `OracleAdapter` and `NoctTrigger` to Base Sepolia
- [ ] Register the Vela application; read the **actual** `velaApplicationID` — never assume it. ⛔ **B11: we cannot self-register.** Either Horizen grants `DEPLOYER_ROLE` on `0xd5E405a84753635608E7a28A59D7349BB2DAaEeF` to an address we control, or they deploy for us and return the ID. Do **not** substitute `vela-nova`'s `11579806367557720661` — that is a different application.
- [ ] Freeze `velaApplicationID` and `chainID` into initial state (assertion 5)
- [ ] Verify USDC and tZEN against `TokenAllowlist`; confirm `decimals()` on-chain (assertion 1)
- [ ] Run all 10 deployment assertions against the live deployment — fail closed
- [ ] Set genesis reserve state (assertion 10)
- [ ] Set `governanceIdentity` to a multisig; freeze it; confirm `T13` unreachable (assertion 6)
- [ ] Confirm `resetOperator` status (B5) and record it
- [ ] Deploy the guest WASM through the real `novaw-linux`; record WASM SHA256. ⛔ Requires B11. Mechanics are now known: `novaw deployapp --wasm <path> --max-value-fee "100 wei"` uploads to `AuthorityServiceURL` `/deploy/upload` and submits `mode=artifact_ref` on-chain. Note the upload channel is **plaintext HTTP to a bare IP** — send the SHA-256 out-of-band so what they deployed can be checked against what we built.
- [ ] Fund controlled test USDC / tZEN reserves
- [ ] Run the full E2E on Base Sepolia: deposit → supply → borrow → accrue → repay → liquidate
- [ ] Record every deployed address, tx hash and artifact hash in the Completion record

### Exit gate
Full E2E green **on Base Sepolia** against real Pyth prices. All 10 assertions pass (or assertion 8 recorded N/A with the ZK-deferral reason). Every artifact hash and contract address recorded and reproducible from the repository.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| `OracleAdapter` | — |
| `NoctTrigger` | — |
| `velaApplicationID` | — |
| WASM SHA256 | — |
| Deploy tx hashes | — |
| Notes, slips, deviations | — |

---

## Day 14 — Testnet launch + go/no-go
**File 34 phase:** 11 · **Status:** ⛔ Blocked on **B11 (critical)** — inherits every Day 13 dependency

### Deliverables
- [ ] Re-run all deployment assertions against the final live contracts
- [ ] Deploy the dashboard publicly (Vercel/Netlify)
- [ ] Publish user documentation: deposit, borrow, repay, liquidate guides
- [ ] Publish developer documentation: SDK and API reference
- [ ] Stand up monitoring and alerting on `T13`, custody mismatch and oracle breaker
- [ ] Write the incident runbook
- [ ] Metrics dashboard live: TVL, active users, volume, error rates, liquidation success rate, reserve utilization
- [ ] Onboard first testnet users; run a simulated attack drill
- [ ] Publish the **honest scope statement**: ZK proofs deferred, `noctmath` unaudited, no external audit, fuzzing not run — this is a plumbing testnet, not the File 06 trust model
- [ ] Complete the go/no-go review against File 31 environment gates

### Exit gate
Public Base Sepolia testnet is live and usable end-to-end. Monitoring and runbook in place. The scope statement is published alongside the announcement. `TOOLCHAIN-LOCK.md` has no OPEN rows required for testnet.

### File 31 testnet gates — final checklist
| Gate | Requirement | Status |
|---|---|---|
| All 10 deployment assertions | MUST | ⬜ |
| `TOOLCHAIN-LOCK.md` free of OPEN rows | MUST | ⬜ |
| Golden vectors for all leaves and subroots | MUST | ⬜ |
| ZK + E2E benchmarks (Files 27, 28) | MUST | ⬜ **cannot pass — ZK deferred** |
| Custody reconciliation harness (File 11) | MUST | ⬜ |
| Incident runbook + alerting | SHOULD | ⬜ |

**The ZK benchmark gate cannot be satisfied in this sprint.** Launching on Day 14 therefore means launching with a documented, deliberate exception to a MUST-level File 31 testnet gate. That exception must be written down and signed off — not quietly skipped. Local execution also does not prove production Nitro security and MUST NOT be cited as evidence of TEE behaviour.

### Completion record
| Field | Value |
|---|---|
| Date completed | — |
| Commit SHA | — |
| Public URL | — |
| Users onboarded | — |
| Scope statement published | ⬜ |
| Notes, slips, deviations | — |

---

## Deferred scope (out of the 14-day sprint)

Each item below is work that File 34 or File 31 requires and that this sprint deliberately does **not** deliver. Every one must be closed before mainnet. This list is the honest cost of the compression — keep it visible.

| # | Deferred item | Source | Why it matters |
|---|---|---|---|
| D1 | ZK benchmarking | File 34 Phase 7 (3 weeks) | No evidence for the Files 27/28 performance claims |
| D2 | UltraHonk circuits + zkVerify integration | File 34 Phase 8 (3 weeks) | `circuitID` / `vkHash` stay OPEN; File 06 trust model unproven |
| D3 | UltraHonk verifier variant choice (`V3_0` / `V0_84` / Legacy) | File 31 | Exactly one MUST be chosen; cannot be, with no circuit |
| D4 | Public-input width assertion (≤ 32) | File 31 assertion 8 | Unevaluable without a backend |
| D5 | Independent audit of `noctmath` | File 34 Phase 2 | Hand-rolled U256 with no external review guards all value movement |
| D6 | External audit (≥ 1 firm) + bug bounty ($100K+) | File 34 Phase 11 | Testnet gate requirement, skipped |
| D7 | 100K-iteration conservation-invariant fuzzing | File 34 Phase 10 | Only 100 crash tests run on Day 10 |
| D8 | Liquidation cascade stress test (conflicting-lock, close-factor) | File 34 Phase 10 | Concurrency behaviour under stress unverified |
| D9 | Duplicate-result flood (1000 deliveries/block) | File 34 Phase 10 | Saturation point and queue growth unknown |
| D10 | Explicit dust / insufficient-collateral bad-debt handling | File 34 Phase 6 | No zero-payment seizure path; bad debt unmodelled |
| D11 | Liquidation + captured-receipt monitoring dashboard | File 34 Phase 6 | Operators partially blind |
| D12 | 2-week soak at 99.9% uptime, 100+ users, 10K+ txs | File 34 Phase 11 | Stability unproven over time |
| D13 | Multi-sig governance deployment + emergency pause test | File 34 go/no-go | Mainnet prerequisites |
| D14 | Insurance fund capitalisation | File 34 go/no-go | Mainnet prerequisite |
| D15 | Vela core image source commit + digest | File 31 | Tag VERIFIED, digest OPEN |
| D16 | Mainnet | — | Explicitly out of scope |

**Cumulative deferred effort:** roughly 20+ weeks of File 34 work. The 14-day sprint is a plumbing milestone, not a launch.

---

## Completion log

Append one row per completed day. Do not edit history — if a day was reopened, add a new row saying so.

| Date | Day | Outcome | Commit | Evidence | Deviations / carry-forward |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## Blocker resolution log

| Date | Blocker | Resolution | Source |
|---|---|---|---|
| 2026-09-27 | B1–B10 | **UNRESOLVED — request prepared and version-controlled, NOT yet transmitted.** `VELA-DEV-TEAM-REQUEST.md` contains all ten questions with the format that unblocks each. This environment has no configured contact channel for the Vela/Horizen dev team, so the document could not be sent from here; a human must post it to the Vela/Horizen developer channel. All ten answers remain ⬜. | `VELA-DEV-TEAM-REQUEST.md` (committed) |
| 2026-09-27 | B8 | **OPEN — hard-blocks the Day 1 exit gate.** Verified against the git object store: the tracked `novaw-linux.zip` blob is exactly 9 bytes containing the literal string `Not Found` (blob `8537307`). No `novaw-linux` binary exists anywhere in the tree. The file has now been removed from version control so the placeholder can no longer be mistaken for a deliverable. | `git cat-file -s/-p 8537307`; File 31 assertion 9 |
| 2026-09-27 | B8 (partial) | **Day 1 toolchain/guest subset completed without `novaw-linux`.** The guest build, asyncify gate, WASI golden diff and reproducibility check all pass and are recorded in `artifacts/BUILD-EVIDENCE.md`. This does **not** close B8: the Day 1 exit gate is conjunctive, and deployment still requires a genuine CLI because the spec fails closed on the placeholder condition. | `tools/build-guest.ps1`, `artifacts/BUILD-EVIDENCE.md` |
| 2026-09-27 | — (new, local) | **Real binaryen `wasm-opt` is not installed.** This is a local tooling gap, not a dev-team question, so it gets no B-number. Consequence: no release artifact exists. `tools/build-guest.ps1 -Release` was negative-tested and correctly refuses with exit 2 rather than publishing a stub-built module as release-ready. | `tools/build-guest.ps1 -Release`, exit 2 |

---

**Current status:** Day 1 in progress. The toolchain truth reset is complete and independently reproducible — pinned TinyGo `0.39.0` + Go `1.24.0` asserted at build time, guest `asyncify=false`, WASI golden output `8/8`, byte-identical rebuild, deployable synced and provenance-recorded. Day 1 is **not** closed: its exit gate is conjunctive and B8 (real `novaw-linux`) is unanswered, and the Node/package-manager pins, Foundry and the Base Sepolia config constants are untouched. **No release artifact exists yet** — binaryen `wasm-opt` is not installed, so `-Release` correctly refuses. Days 5, 6, 13 and 14 remain ⛔ until the dev team answers B1–B7, B9 and B10; `VELA-DEV-TEAM-REQUEST.md` is prepared but still needs a human to send it.
