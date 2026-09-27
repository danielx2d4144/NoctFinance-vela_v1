# 34. Implementation Roadmap

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Phase 0 — Toolchain lock (1 week)

**Deliverables:**
- [ ] Pin one Vela version/commit and its exact `ProcessResult.Withdrawals`, authenticated receipt, and TRUSTPROCESS integration APIs (see Files 11, 12, 17)
- [x] Pin Go: 1.24.x — **DONE.** `noct-demo-wasm/go.mod:3` pins `go 1.24.0` and `build.sh` now asserts it (`GO_REQUIRED="1.24.0"`). This is not freely substitutable: TinyGo `0.39.0` rejects Go 1.26+ (`requires go version 1.19 through 1.25`), so `1.24.x` is the upper-compatible choice. Note the ambient toolchain on the verification machine is `go1.27.1`; the guest is built with a pinned Go 1.24.0 and `GOTOOLCHAIN=local`. See TOOLCHAIN-LOCK.md, "Scheduler resolution".
- [x] Pin TinyGo: 0.39.0 — **DONE.** `build.sh:15` pins `TINYGO_REQUIRED="0.39.0"` and `build.sh:33` asserts it against `tinygo version`, failing the build on mismatch. Verified to build `main.go` with `-scheduler=none`. This pin and the Go pin above are a **pair**, not two independent numbers.
- [ ] Pin Node: 20.11.x LTS — **CONTRADICTED, unresolved.** The verification machine runs Node **v22.20.0**, there is no `.nvmrc`, and neither `package.json` declares `engines`. Every Node-dependent artifact in Phase 0 was therefore produced under Node 22, not 20.11.x. Either re-verify under 20.11.x or move the baseline to 22.x; a recorded pin that does not match the version that produced the evidence is not a pin. See TOOLCHAIN-LOCK.md.
- [ ] Pin pnpm: 8.15.x — **CONTRADICTED, unresolved.** Four sources disagree (this file: `8.15.x`; `README.md:47`: `9.x`; TOOLCHAIN-LOCK.md baseline: `9.x`; installed: `11.5.2`), and the repository contains `deploy-scripts/package-lock.json` (**npm**, resolved with `npm 10.9.3`) with **no** `pnpm-lock.yaml` anywhere. npm is currently the only package manager with reproducible evidence in this repository. Resolve the manager before pinning its version.
- [ ] Pin TypeScript: 5.3.x
- [ ] Pin ethers: 6.x
- [ ] Pin Noir: 0.26.x
- [ ] Pin Barretenberg: 0.26.x
- [ ] Pin zkVerifyJS: (check latest stable)
- [ ] Pin Foundry: latest
- [ ] Set up monorepo structure (pnpm workspaces + Turborepo)
- [ ] Configure linters (golangci-lint, ESLint, Slither)
- [ ] Set up CI/CD pipelines (GitHub Actions)
- [ ] Create Docker Compose local dev stack

**Acceptance gate:**
✅ All team members can build WASM, contracts, and SDK locally within 15 minutes
✅ CI pipeline green on all checks
✅ Dependency versions documented in TOOLCHAIN-LOCK.md
✅ Pinned Vela API contract is covered by compatibility tests for native withdrawals, authenticated receipts, TRUSTPROCESS delivery, and deterministic retry behavior

**Estimated time:** 1 week

## Phase 1 — Vela skeleton (2 weeks)

**Deliverables:**
- [ ] Boot Vela Starter Kit locally (Docker)
- [ ] Create minimal TinyGo WASM with the exports required by the pinned Vela runtime
- [ ] Implement P-521 ECDH encryption/decryption in WASM
- [ ] Create TypeScript client bridge
- [ ] Validate private state persistence (restart enclave, state retained)
- [ ] Implement request/response processing that returns native `ProcessResult.Withdrawals`
- [ ] Implement authenticated Vela/TRUSTPROCESS delivery hooks for inbound receipts and oracle updates

**Acceptance gate:**
✅ Client can send encrypted request to enclave
✅ Enclave can decrypt, process, and return encrypted response
✅ State persists across enclave restarts
✅ A test transition returns a native withdrawal binding deterministic withdrawal ID, asset, amount, and destination
✅ Duplicate result delivery is deduplicated by the pinned Vela runtime
✅ Unauthenticated receipt and oracle-update calls are rejected
✅ Phase-level p50/p95/p99 latency is recorded for the actual ProcessorEndpoint → Manager/Executor → stateUpdate path; no direct-enclave shortcut or unmeasured SLA is used

**Test coverage:** 80% unit (Go), 75% unit (TypeScript)

**Estimated time:** 2 weeks

## Phase 2 — State (2 weeks)

**Deliverables:**
- [ ] Implement `NoctStateV1` exactly as specified in File 08: global, reserve, oracle, configuration, commitment, private-account, pending-operation, and receipt state
- [ ] Implement `PrivateAccount` with `cashUSDC`, `collateralUSDC`, `borrowedZEN`, `borrowedETH`, `scaledDebtZEN`, `scaledDebtETH`, `positionNonce`, and `lastUpdateTimestamp`; do not add principal or entry-index fields
- [ ] Implement checked U256 financial types with canonical 32-byte big-endian encoding: WAD amounts/prices/ratios and RAY rates/indexes/scaled debt (see Files 08, 10, 11)
- [ ] Integrate an audited TinyGo-compatible checked U256 library with full-width `mulDivDown` and `mulDivUp`; restrict `uint64` to non-financial counters and time metadata — **AMENDED: partially met, and the "audited" requirement is NOT met.**
  - **What exists.** `noct-demo-wasm/noctmath` is a **hand-written** checked U256 kernel, not an integrated audited library. It provides the full SPEC-10 required surface (`Add`, `Sub`, `Mul`, `Div`, `MulDivDown`, `MulDivUp`, `FromBytes32`, `ToBytes32`, `Cmp` as `(U256, ok bool)` free functions, in `spec10.go`) over a single implementation with a true 512-bit intermediate (`mul512`/`quoRem512` in `div.go`), so `mulDivDown`/`mulDivUp` are full-width as required.
  - **Evidence of correctness.** 94.2% statement coverage; conformance vectors in `golden_test.go`; differential testing against `math/big` in `differential_test.go`; and the compiled WASI probe's output diffed line-for-line against the native Go golden (8/8 identical) under the pinned toolchain with `-scheduler=none`. `go vet` clean. *(Corrected 2026-09-27: this line previously read 94.6% and 24/24. Re-measured with the pinned Go 1.24.0 the coverage is 94.2%, and `cmd/schedprobe/expected.txt` contains 8 lines — no 24-line golden file exists. The old figures were unsupported. See `TOOLCHAIN-LOCK.md` "Evidence hygiene".)*
  - **Why this is still OPEN.** Test coverage and differential testing are **not** an audit. A hand-rolled kernel has had no independent security review, no formal verification, and no external bug bounty history — precisely the assurance this line was written to require. The roadmap MUST NOT be marked complete on the strength of the test suite alone.
  - **Conflict with SPEC-10.** `TOOLCHAIN-LOCK.md` SPEC-10 property 5 requires the kernel be "vendored into the repository with its license and a recorded SHA256, **or implemented in-repo with its own test suite**". `noctmath` satisfies the second branch, so SPEC-10 treats this kernel as conformant while this roadmap line does not. The two documents set different bars for the same component; that discrepancy is recorded in TOOLCHAIN-LOCK.md ("Conformance status") and MUST be resolved deliberately.
  - **Required resolution.** Either (a) replace `noctmath` with a genuinely audited TinyGo-compatible U256 library, or (b) formally re-scope this line to "hand-written kernel" to match SPEC-10 property 5 and commission an independent audit of `noctmath` before mainnet. Whichever is chosen, the `uint64` restriction to non-financial counters and time metadata still applies and is separately testable.
- [ ] Implement account creation, read, update (CRUD)
- [ ] Implement complete replay state: monotonic position nonces plus append-only consumed receipt IDs, committed operation IDs, deterministic withdrawal IDs, and stored successful results (see Files 08, 12, 23)
- [ ] Implement canonical `configCommitment`, `oracleCommitment`, and the five File 09 subroots — `accountRoot`, `reserveRoot`, `pendingOperationRoot`, `consumedReceiptRoot`, `historyRoot` — combined into `appRoot = H(NOCT_APP_ROOT_V1 || canonicalSerialize(GlobalRootStateV1))`, covering global/version, reserve, oracle, account, pending-operation, receipt, replay, and pending-outbound state, with `stateVersion` incrementing exactly once per committed transition
- [ ] Implement state serialization/deserialization with golden vectors
- [ ] Integrate and test the pinned Vela Manager's encrypted versioned-state persistence and canonical on-chain root recovery; guest WASM MUST NOT implement a checkpoint or `SaveState` API

**Acceptance gate:**
✅ 100 accounts can be created and updated
✅ Every financial field rejects non-canonical width, overflow/underflow, and native-integer or floating-point execution paths
✅ Golden vectors verify WAD/RAY encoding, full-width `mulDivDown`/`mulDivUp`, and required rounding directions
✅ `configCommitment`, `oracleCommitment`, all five File 09 subroots, the derived `appRoot`, and `stateVersion` update atomically where applicable
✅ Nonces, receipt IDs, operation IDs, and withdrawal IDs prevent duplicate mutation or emission across 1000 replay attempts
✅ State serialization round-trip is lossless
✅ Restart selects the encrypted state version matching the canonical `ProcessorEndpoint` root and recovers byte-identical Noct state/commitments

**Test coverage:** 90% unit (state management is critical)

**Invariant tests:**
- `reserve.totalScaledDebt[a] = Σ account.scaledDebt[a]`
- `borrowIndex[a] >= RAY` and never decreases
- `Custody[a] = Ledger[a] + PendingInbound[a] + PendingOutbound[a]` for USDC, ZEN, and ETH
- State version, nonces, oracle epoch/timestamp, receipt states, and operation states never regress

**Estimated time:** 2 weeks

## Phase 3 — Core accounting (3 weeks)

**Deliverables:**
- [ ] Implement T01: `CONSUME_DEPOSIT_USDC` from finalized authenticated receipts
- [ ] Implement T03: `SUPPLY_USDC` (cash → collateral)
- [ ] Implement T04: `RELEASE_COLLATERAL_USDC` (collateral → cash) with fresh accepted oracle state and post-state `maxLTV`
- [ ] Implement T02: `WITHDRAW_CASH_USDC` as one atomic ledger debit plus native Vela `ProcessResult.Withdrawals` emission; do not implement debit-after-settlement lock/unlock
- [ ] Implement deterministic withdrawal IDs, stored results, Vela pending-outbound reconciliation, and duplicate-delivery handling
- [ ] Implement custody reconciliation for `Custody = Ledger + PendingInbound + PendingOutbound`, halting affected transitions on mismatch
- [ ] Implement finalized receipt replay after enclave failure without duplicate credit or withdrawal emission

**Acceptance gate:**
✅ E2E test: finalized receipt for 1000 USDC → consume once → native withdrawal of 1000 USDC (100 iterations)
✅ E2E test: Deposit → supply → release → withdraw
✅ Duplicate deposit receipt and withdrawal request return the stored outcome with no second credit, debit, or emission
✅ Every withdrawal atomically moves value from `Ledger[USDC]` to `PendingOutbound[USDC]`; Vela finality reduces custody and pending outbound together
✅ Custody conservation holds for 1000 randomized inbound-consume-withdraw-finalize sequences, including timeout and reorg delivery scenarios
✅ Reconciliation halts and alerts on a mismatch and never invents a balancing entry
✅ Vela versioned-state recovery + crash + authenticated receipt/result redelivery = no duplicate effect across 100 crash simulations

**Test coverage:** 85% unit, 70% integration

**Smart contract tests:**
- Pinned-Vela integration tests for native withdrawal execution and deduplication
- Invariant tests for USDC custody conservation across pending inbound and pending outbound states
- Fuzz testing: random receipt, deposit, reclassification, release, and withdrawal amounts

**Estimated time:** 3 weeks

## Phase 4 — Lending (4 weeks)

**Deliverables:**
- [ ] Fund testnet Vela custody reserves with 100K ZEN and 100 ETH, then consume finalized authenticated reserve-funding receipts through T11; do not create a parallel `ReserveManager` balance ledger
- [ ] Implement `ReserveState` with `availableLiquidity`, `totalScaledDebt`, RAY `borrowIndex`, and `lastAccrualTimestamp`
- [ ] Implement T05: `BORROW_ZEN` / `BORROW_ETH` using upward-rounded scaled-debt shares and post-state `maxLTV`
- [ ] Implement T06: `WITHDRAW_BORROWED_ASSET` as an atomic private-balance debit plus native Vela withdrawal; debt and reserve liquidity remain unchanged
- [ ] Implement the Pyth `OracleAdapter` and authenticated TRUSTPROCESS ingestion that validates feed identity, confidence, exponent-to-WAD conversion, freshness, deviation, monotonic epoch/timestamp, and updates the committed `OracleState` (see Files 10, 18)
- [ ] Make lending transitions consume only the latest accepted authenticated `OracleState`; reject caller-selected snapshots, prices, and signatures
- [ ] Implement File 19 lazy, bounded, deterministic RAY borrow-index accrual to the accepted oracle timestamp; do not accrue account-by-account or on every block
- [ ] Implement conservative WAD USD valuation and `maxLTV`/liquidation-threshold calculations with explicit rounding

**Acceptance gate:**
✅ Pyth `OracleAdapter` → TRUSTPROCESS → `OracleState` integration accepts valid updates and rejects wrong feeds, bad confidence/exponent conversion, stale/deviant data, and epoch/timestamp regression
✅ Risk-sensitive transitions fail closed on stale accepted state and cannot select a transaction-local oracle snapshot
✅ Borrow succeeds only when post-state debt is within `maxLTV`; liquidation threshold is not used as the borrow gate
✅ Borrow adds the same upward-rounded scaled delta to account and reserve, decreases liquidity, and credits a Vela-custodied private borrowed balance
✅ File 19 vectors pass for kink rates, one-second/year/chunked accrual, rounding, timestamp regression, chunk cap, and near-U256 limits
✅ Invariants: `totalScaledDebt = Σ account.scaledDebt`, monotonic index, and custody conservation for USDC, ETH and ZEN
✅ Reserve exhaustion rejects only the new borrow without partial mutation
✅ Borrowed-asset withdrawal emits exactly one native Vela withdrawal and does not change debt or available liquidity

**Test coverage:** 85% unit, 65% integration

**Property-based tests:**
- Borrow index and derived debt never decrease; accrual leaves scaled debt and liquidity unchanged
- Borrow always decreases reserve liquidity by the borrowed WAD amount and increases both scaled-debt fields equally
- Collateral rounds down, debt rounds up, and risk gates are correct for all accepted price combinations

**Estimated time:** 4 weeks

## Phase 5 — Repay (2 weeks)

**Deliverables:**
- [ ] Implement T07: `PREPARE_REPAY` with exact quote, exclusive debt lock, operation ID, pre-payment TTL, and no debt or liquidity mutation
- [ ] Capture the exact prepared debt-asset payment through the authenticated trigger/escrow path and bind its finalized inbound receipt to the operation ID
- [ ] Implement TRUSTPROCESS-only T08: `COMMIT_REPAY` that atomically consumes the receipt, subtracts the stored scaled reduction from account and reserve, credits available liquidity, removes the lock, and stores the committed result
- [ ] Implement full repayment as exact current upward-rounded debt with all scaled debt cleared; implement partial repayment with nonzero `mulDivDown(payment, RAY, index)` reduction
- [ ] Retry captured-payment commits until idempotently successful; permit expiry only while `PREPARED`, never after payment capture

**Acceptance gate:**
✅ E2E test: borrow 100 ZEN → advance accepted oracle time/accrue → prepare → capture exact receipt → commit
✅ Prepare does not reduce debt or increase liquidity, and no commit succeeds without a matching unconsumed authenticated receipt
✅ Full repayment clears account and reserve scaled debt by exactly the account's full scaled balance
✅ Partial repayment uses the stored floor-rounded nonzero scaled reduction; dust and amount ≥ current debt partial requests are rejected
✅ Commit increases reserve liquidity by the exact captured payment amount and consumes the receipt once
✅ After payment capture, timeout/retry never refunds or expires the operation; lost acknowledgements return the original result without a second mutation

**Test coverage:** 85% unit, 70% integration

**Scenario tests:**
- Borrow → immediate prepare/capture/commit (minimal interest)
- Borrow → advance accepted oracle time → accrue → repay
- Borrow → partial commit → accrue → final full commit
- Multiple borrows → single prepared repayment
- Crash before and after receipt capture, commit, and acknowledgement → deterministic idempotent recovery

**Estimated time:** 2 weeks

## Phase 6 — Liquidation (5 weeks)

**Deliverables:**
- [ ] Use the latest accepted Pyth `OracleAdapter` state; discovery and liquidation requests cannot inject oracle snapshots
- [ ] Implement T09: `PREPARE_LIQUIDATION` with fresh accepted oracle state, both reserves accrued, liquidation-threshold re-verification, close-factor enforcement, exact cross-asset WAD valuation, and exclusive debt/collateral locks
- [ ] Implement liquidation bot with privileged private candidate discovery over scaled debt and the latest accepted `OracleState` (see File 20)
- [ ] Implement authenticated trigger/escrow payment capture bound to the prepared operation ID
- [ ] Implement TRUSTPROCESS-only T10: `COMMIT_LIQUIDATION` that consumes the receipt, applies the stored scaled reduction, credits reserve liquidity, debits borrower collateral, and emits the operation-ID-derived USDC `ProcessResult.Withdrawals` entry atomically
- [ ] Treat prepare, payment capture, and commit as separate phases; do not assume cross-contract/EVM atomicity
- [ ] Implement explicit dust/insufficient-collateral bad-debt handling without zero-payment seizure or invented reserve absorption
- [ ] Add liquidation and captured-receipt monitoring dashboard

**Acceptance gate:**
✅ Preparation succeeds only when `debtUsd > floor(collateralUsd × liquidationThreshold)` using a fresh accepted epoch, and fails if the position recovered
✅ Close factor is enforced against upward-rounded current debt; zero scaled reduction and zero-payment seizure are rejected
✅ Seized USDC uses debt-asset price → USD → USDC conversion plus the configured bonus with specified upward rounding and collateral cap
✅ Prepare changes no debt, liquidity, or collateral ownership; commit is impossible without the exact finalized payment receipt
✅ Commit atomically reduces account/reserve scaled debt equally, credits captured debt tokens, debits collateral, and emits one native USDC withdrawal
✅ Captured operations never expire or timeout-refund; retries and lost acknowledgements produce no duplicate mutation or withdrawal
✅ Custody and scaled-debt invariants hold through 100 simulated prepare/capture/commit failures and recoveries
✅ Bounded private discovery scans meet the approved account-count/starvation target measured under File 28
✅ Discovery, prepare, capture, commit, claim availability, and wallet delivery are measured separately; release targets are set only from pinned-deployment p95/p99 results

**Test coverage:** 90% unit (liquidation is critical), 75% integration

**Stress tests:**
- Rapid accepted Pyth price drop (40%) → prepare/capture/commit executes
- Multiple underwater positions → bot prepares non-conflicting liquidations
- Concurrent liquidation or repayment → exclusive lock rejects the conflict
- Duplicate receipt and commit delivery → stored result returned with no duplicate collateral withdrawal

**Estimated time:** 5 weeks

## Phase 7 — ZK benchmark (3 weeks)

**Deliverables:**
- [ ] Implement Noir circuits for the applicable receipt-driven state-machine transitions:
  - consume_deposit.nr
  - borrow.nr
  - prepare_repay.nr / commit_repay.nr
  - prepare_liquidation.nr / commit_liquidation.nr
  - withdraw.nr
- [ ] Implement Merkle tree verification in circuits
- [ ] Implement balance update proofs
- [ ] Compile circuits to WASM (browser-compatible)
- [ ] Benchmark proof generation on desktop + mobile
- [ ] Measure proof size and verification time
- [ ] Test proof verification in enclave (Mode 1: direct)

**Acceptance gate:**
✅ Proof generation works for all transaction types
✅ Invalid proofs rejected by enclave (100% rejection rate for malformed proofs)
✅ Desktop, mobile, and dedicated-prover p50/p95/p99 latency, failure rate, CPU, RAM, and thermal behavior are measured
✅ Proof size, constraint count, public-input count, and direct-verifier time/memory/fuel are measured against approved deployment budgets
✅ Stale-root regeneration rate is measured under concurrent Vela traffic
✅ WASM binary size and pinned-runtime compatibility are measured before selecting no-ZK, direct verification, or zkVerify authorization

**Test coverage:** 80% unit (circuit logic)

**Performance decision:**
- Do not freeze browser/mobile proof-time targets before File 28 measurements
- Compare browser, mobile, dedicated prover, and no-custom-ZK paths
- Keep custom ZK off the mandatory path unless approved p95/p99, failure-rate, stale-root, and resource budgets all pass

**Estimated time:** 3 weeks

## Phase 8 — ZK/zkVerify (3 weeks)

**Deliverables:**
- [ ] Choose Mode 1 (direct) or Mode 2 (zkVerify) based on WASM size
- [ ] If Mode 2: Integrate zkVerify SDK
- [ ] Implement complete proof/authorization context binding (see Files 08, 10, 12, 23): app ID, chain ID, protocol/circuit version, VK hash, transition type, identity, nonce, expected state version, old/new position roots, `configCommitment`, `oracleCommitment`/accepted epoch where required, operation/receipt/withdrawal ID, asset, amount, and destination as applicable
- [ ] Implement proof-to-state verification against the current complete committed context, not an account root alone
- [ ] Add circuit version tracking (VK hash)
- [ ] Bind commit proofs to the prepared operation and authenticated receipt; bind withdrawal proofs/results to the deterministic withdrawal ID and exact native Vela output
- [ ] Test proof verification and replay protection under all failure modes

**Acceptance gate:**
✅ zkVerify verifies valid proofs (if Mode 2)
✅ zkVerify rejects invalid proofs (if Mode 2)
✅ Enclave verifies zkVerify receipts (if Mode 2)
✅ Old/new position roots plus complete state/config/oracle context prevent stale-state and parameter replay (1000 attempts rejected)
✅ Cross-app, cross-chain, cross-version, wrong-VK, wrong-transition, wrong-user, wrong-operation/receipt, and wrong-withdrawal-output replays are rejected
✅ Consumed receipt IDs and committed operation/withdrawal results remain replay-safe after canonical Vela versioned-state recovery
✅ Proof, verification, stale-root regeneration, Vela processing, and settlement latency meet operation-specific targets approved from File 28 measurements
✅ Fallback to Mode 1 works if zkVerify unavailable (if Mode 2)

**Test coverage:** 85% unit, 70% integration

**Security tests:**
- Replay proof with old position root, state version, nonce, operation ID, receipt ID, or withdrawal ID → rejected or returns the stored idempotent result as defined by the transition
- Replay proof from testnet on mainnet or another application/version/circuit → rejected
- Proof with wrong config or oracle commitment/epoch → rejected
- Proof whose asset, amount, destination, or transition type differs from the committed output → rejected
- Malformed proof → rejected

**Estimated time:** 3 weeks

## Phase 9 — Vela/ProcessorEndpoint integration (2 weeks)

**Deliverables:**
- [ ] Deploy only the testnet contracts required for custody ingress, Pyth `OracleAdapter`, and TRUSTPROCESS receipt delivery; do not deploy parallel vault/reserve accounting
- [ ] Deploy the pinned Vela enclave/runtime to AWS Nitro
- [ ] Deploy facilitator service (Node.js + Docker)
- [ ] Deploy receipt, native-withdrawal, custody, and commitment reconciliation workers
- [ ] Run E2E native Vela withdrawal and receipt-driven prepare/capture/commit lifecycle tests (see Files 17, 21)
- [ ] Test recovery scenarios (crash, reorg, timeout, lost acknowledgement, duplicate delivery) against the fail-closed/idempotent rules in Files 12 and 22
- [ ] Verify PCR pinning and TRUSTPROCESS/OracleAdapter authorization on-chain

**Acceptance gate:**
✅ Finalized deposit and reserve-funding receipts are consumed exactly once; p50/p95/p99 timing is reported against the configured finality policy
✅ Cash, borrowed-asset, and liquidation-collateral withdrawals execute through native Vela `ProcessResult.Withdrawals` with deterministic deduplication
✅ Repayment and liquidation complete through authenticated `PREPARED → PAYMENT_CAPTURED → COMMITTED` processing without debt reduction before receipt consumption
✅ Custody, pending inbound/outbound, scaled-debt, and complete commitment reconciliation remains exact across 1000 transactions
✅ Supported Manager/Executor restart recovers the encrypted state version matching the canonical Vela root and stored idempotent results; measured recovery time is reported without an unsupported fixed guarantee
✅ Facilitator outage: users can self-relay where the pinned Vela flow permits it

**Test coverage:** 60% E2E (full stack)

**Disaster recovery tests:**
- Enclave crash before/after withdrawal emission or receipt commit → replay returns the same result without duplicate effect
- Facilitator down → user self-relays successfully where supported
- Reorg before required finality → no receipt is consumed; finalized redelivery remains idempotent
- Captured repayment/liquidation commit delivery failure → operation remains locked and retries to completion

**Estimated time:** 2 weeks

## Phase 10 — Security/performance (4 weeks)

**Deliverables:**
- [ ] Implement Foundry invariant tests
- [ ] Run Echidna fuzzing (10M iterations)
- [ ] Adversarial testing (malicious inputs, front-running, sandwich attacks)
- [ ] Privacy leakage analysis (timing attacks, error messages)
- [ ] Load testing (100 concurrent users, 1 hour sustained)
- [ ] Chaos engineering (random enclave crashes, network partitions)
- [ ] Gas optimization (reduce deployment + transaction costs)
- [ ] External security review (if budget allows)

**Acceptance gate:**
✅ Checked-U256, WAD/RAY rounding, scaled-debt equality, monotonic index/state, and custody conservation invariants hold under fuzzing (100K iterations minimum)
✅ No debt reduction occurs without single-use receipt consumption; no native withdrawal exists without the matching atomic ledger debit
✅ Complete commitment and replay bindings reject stale/cross-context inputs and preserve idempotent results through 100 crash tests
✅ No privacy leakage detected (timing analysis, error string audit)
✅ Sustained-load tests identify achieved finalized TPS, saturation point, queue growth, and recovery; the approved release target is based on File 28 evidence
✅ Graceful degradation under facilitator, OracleAdapter, and TRUSTPROCESS delivery failure
✅ No critical/high vulnerabilities from Slither
✅ Gas costs measured and optimized for custody ingress, OracleAdapter updates, and trigger/escrow capture

**Test coverage:** Maintain >80% unit, >60% integration

**Stress tests:**
- Flash crash simulation (60% accepted Pyth price drop)
- Liquidation cascade with conflicting-lock and close-factor checks
- Pyth feed/confidence/exponent/staleness/deviation manipulation attempts and unauthorized TRUSTPROCESS calls
- Concurrent transaction, duplicate-receipt, and duplicate-result flood (1000 deliveries/block)

**Estimated time:** 4 weeks

## Phase 11 — Testnet (2 weeks)

**Deliverables:**
- [ ] External audit complete (minimum 1 firm, critical issues resolved)
- [ ] Bug bounty program launched ($100K+ pool)
- [ ] User documentation complete (deposit, borrow, repay, liquidate guides)
- [ ] Developer documentation complete (SDK, API reference)
- [ ] Deploy web UI to Vercel/Netlify
- [ ] Testnet announcement (Twitter, Discord, blog post)
- [ ] Onboard 100+ testnet users
- [ ] Monitor for 2 weeks (99.9% uptime target)

**Acceptance gate:**
✅ External audit complete, critical issues resolved
✅ 100+ testnet users onboarded
✅ 10,000+ transactions processed successfully
✅ 99.9% uptime over 2 weeks
✅ Incident response tested (simulated attack drill)
✅ Community feedback collected and prioritized
✅ No critical bugs reported
✅ Operation-specific p95/p99 latency, claim availability, wallet delivery, and multi-phase commit metrics meet targets approved from the pinned testnet measurements

**Metrics dashboard:**
- Total Value Locked (TVL)
- Active users
- Transaction volume
- Error rates
- Liquidation success rate
- Reserve utilization

**Go/no-go criteria for mainnet:**
- [ ] Testnet stable for 6+ weeks
- [ ] All testnet bugs fixed
- [ ] Multi-sig governance deployed
- [ ] Emergency pause tested
- [ ] Mainnet parameter review complete (community governance)
- [ ] Insurance fund capitalized
- [ ] Second audit complete (recommended)

**Estimated time:** 2 weeks

---

## Total Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Toolchain | 1 week | 1 week |
| Phase 1: Vela skeleton | 2 weeks | 3 weeks |
| Phase 2: State | 2 weeks | 5 weeks |
| Phase 3: Core accounting | 3 weeks | 8 weeks |
| Phase 4: Lending | 4 weeks | 12 weeks |
| Phase 5: Repay | 2 weeks | 14 weeks |
| Phase 6: Liquidation | 5 weeks | 19 weeks |
| Phase 7: ZK benchmark | 3 weeks | 22 weeks |
| Phase 8: ZK/zkVerify | 3 weeks | 25 weeks |
| Phase 9: Integration | 2 weeks | 27 weeks |
| Phase 10: Security | 4 weeks | 31 weeks |
| Phase 11: Testnet | 2 weeks | **33 weeks** |

**Total: 33 weeks (~8 months) from Phase 0 to testnet launch**

**Mainnet: +8-12 weeks after testnet stabilization**

**Total to mainnet: 41-45 weeks (~10-11 months)**
