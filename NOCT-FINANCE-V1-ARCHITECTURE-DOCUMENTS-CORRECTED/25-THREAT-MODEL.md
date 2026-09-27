# 25. Threat Model

**Status:** Implementation architecture baseline — expanded from a stub under SPEC-09.
**Audience:** Noct engineering team, junior developer, coding agent
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.

The previous version of this file was a 42-line list of adversary labels and a seven-row control
table. It named no capabilities, no attack paths and no file references, so it could not be used to
review a design decision. This version states, for each adversary, what it controls, what it can
attempt, and the specific control that stops it.

## Protected assets

- user funds held in Vela custody (USDC, ETH, ZEN);
- protocol reserve liquidity and the integrity of `totalScaledDebt`;
- private position state inside the TEE;
- debt and collateral correctness, including both risk gates;
- proof integrity and the proof-to-state binding;
- settlement integrity: no duplicated or unbacked withdrawal.

## Trust assumptions

V1 assumes the following are **trusted** and does not defend against their compromise except as noted:

| Trusted component | Basis | If compromised |
|---|---|---|
| Vela TEE execution | Nitro enclave attestation | Total: plaintext state and keys exposed. Out of V1 scope; File 06 covers the trust model. |
| `NoctTrigger` / `ProcessorEndpoint` | Noct-deployed contracts | Can forge `TRUSTPROCESS` payloads. Mitigated only by deployment review. |
| `OracleAdapter` + official Pyth EVM | Noct-deployed, Pyth-verified | Can inject arbitrary prices. See "Oracle manipulator". |
| `governanceIdentity` | Committed in `GlobalRootStateV1` (File 09) | Can invoke `T13` to write off debt. See below. |
| Vela custody endpoint | Vela contracts | Can misreport custody. Detected by File 11 reconciliation, not prevented. |

Everything else — users, liquidators, facilitators, frontends, RPC providers, keepers — is untrusted.

## Adversaries, capabilities and controls

### Passive blockchain observer

**Controls:** the public request payload (`18:129`), trigger `AppEvent` and `TRUSTPROCESS` payloads.
**Can attempt:** infer positions from settlement amounts, recipients and timing.
**Defense:** File 24. Amounts and destinations of real token transfers are inherently public; Noct
MUST NOT additionally leak position data in any public payload (`18:131`, `18:187`).

### Malicious borrower

**Controls:** own account, a valid signature, and the ability to open many accounts.

1. Borrow beyond capacity — blocked by the **LTV gate** on `collateralFactorWad` (File 12, SPEC-01).
2. **Stale-quote arbitrage** — prepare a repayment, wait for the index to rise, then pay the stale
   amount. Blocked by `maxQuoteIndexDriftRay` plus re-derivation at the current index (File 12 `T08`,
   SPEC-07).
3. **Liquidation blockade** — hold a `PREPARE_REPAY` lock open without funding so the position cannot
   be liquidated. Blocked by liquidation priority over repay locks, `maxConcurrentRepayLocks = 1` and
   `repayLockCooldownSeconds = 3600` (File 12 `T07`, SPEC-06).
4. Claim a deposit or repayment that never happened — blocked because debt decreases only on
   consumption of an authenticated captured receipt (Files 11 and 12).
5. Exploit rounding — every direction is fixed by the File 19 rounding table: collateral rounds down,
   debt rounds up, partial reductions round down.
6. Escape a fractional obligation — `mulDivUp` on debt derivation means rounding always favours the
   protocol (`08:81`).

### Malicious liquidator

**Controls:** own funds and the ability to observe liquidatable positions.

1. Seize more collateral than the bonus permits — `collateralToWithdraw` is derived from the committed
   quote and clamped by `min(...)` (File 12 `T09`).
2. Pay in the wrong asset or a wrong amount — the receipt is bound to `operationID`, asset and exact
   amount (Files 12 and 21).
3. Commit without paying — commit requires a captured, unconsumed receipt (File 12 `T10`).
4. Replay a commit — `COMMITTED` is terminal and returns the stored result (Files 12 and 23).
5. Seize sub-quantum dust — `quantizeDown` at preparation makes every emitted amount a whole native
   unit (File 08, SPEC-02).

### Malicious facilitator

**Controls:** request submission, ordering and delivery.
**Can attempt:** reorder, drop, replay or forge requests, and substitute prices.
**Defense:** encrypted user payloads; `TRUSTPROCESS` is not user-submittable (`18:129`); prices come
only from the accepted `OracleState` epoch and never from a caller (`08:116`, `10:163`); nonces and
`appRoot` bind every request (File 23). A facilitator can censor by withholding delivery, which is a
**liveness** failure, not a safety failure — captured payments are still committed on retry (File 22).

### Oracle manipulator

**Controls:** the keeper role, Pyth `updateData`, and network timing.
**Can attempt:** stale prices, future-dated prices, low-confidence prices, manipulation of a single
feed, and epoch replay.
**Defense:** the ten adapter checks in `18:47-58` — official Pyth EVM verification for the exact
configured feed IDs, `price > 0`, publish-time window, strictly newer publish time per feed, checked
exponent normalization, confidence-ratio bound, deviation breaker, and all-or-none atomicity. Epoch
acceptance requires strict monotonic increase (`18:153-159`). `maxRiskDelaySeconds = 120` is enforced
on-chain by `NoctTrigger` (`18:178`, File 10, SPEC-08).

### Replay attacker

**Controls:** captured payloads from any source.
**Defense:** File 23. `requestCommitment` binds `velaRequestID`, request type, expected old Vela root
and payload hash; `noncesCommitment` binds old and new account and Vela app nonces; `historyRoot` is
append-only; consumed receipt IDs and committed operation IDs can never regress (`08:196`).

### Invalid-proof submitter

**Defense:** `circuitID` and `vkHash` are public inputs 4 and 5 (`09:151-152`); `configCommitment` and
`oracleCommitment` are inputs 6 and 7; `oldAppRoot` and `newAppRoot` are inputs 8 and 9. A proof for a
different circuit, config or state cannot verify. zkVerify enforces the pinned verifier variant
(File 15).

### Compromised frontend or RPC provider

**Defense:** the frontend never enforces a financial rule (File 26); every value is re-derived inside
the TEE from committed state. A malicious RPC can lie about chain state but cannot produce a valid
receipt, because receipts arrive only through the trusted Vela/on-chain integration (`08:154`).

### Malicious infrastructure operator

**Controls:** hosting, networking and the prover fleet.
**Can attempt:** withhold service, corrupt backups, observe plaintext inside the enclave boundary.
**Defense:** deterministic execution means a re-run on the same inputs yields the same `appRoot`
(File 09); append-only `historyRoot` and `consumedReceiptRoot` make state rollback detectable;
File 22 defines recovery. Confidentiality inside the TEE is a Vela/Nitro property, not a Noct one.

### Malicious or compromised `governanceIdentity`

**Controls:** the only key able to invoke `T13 ABSORB_BAD_DEBT`.
**Can attempt:** write off a solvent user's debt and seize their collateral.
**Defense:** `T13` requires the account to be **provably liquidatable** under the threshold gate and
**provably unresolvable** by `T09` at the current accepted epoch (File 12 `T13`). A proof therefore
constrains the write-off, so governance cannot absorb a healthy position. `T13` emits no withdrawal
and cannot direct value to a chosen destination. `writtenOffDebtUsd` and `protocolBadDebtUsd` are
committed and monotonic, so every absorption is auditable. Residual risk — governance engineering the
preconditions via price manipulation — is bounded by the oracle controls above. This key MUST be held
by a multisig and every use MUST alert.

## Control mapping

| Threat | Control | Normative source |
|---|---|---|
| Replay | `requestCommitment` + nonces + append-only `historyRoot` | File 23, `09:169-176` |
| Double withdrawal | deterministic `withdrawalID` + `outcomeCommitment` | File 12 `T02`/`T06`, `09:112` |
| Invalid borrow | LTV gate + proof | File 12 `T05`, SPEC-01 |
| Oracle spoof | Pyth EVM verification + epoch monotonicity + delay bound | File 18, SPEC-08 |
| Facilitator abuse | encrypted payload + opaque IDs + non-submittable `TRUSTPROCESS` | `18:129`, File 21 |
| Wrong circuit | `circuitID` / `vkHash` binding | `09:151-152`, File 15 |
| Stale state | `stateVersion` + `appRoot` equality | Files 09 and 23 |
| Stale-quote arbitrage | `maxQuoteIndexDriftRay` + re-derivation at current index | File 12 `T08`/`T10`, SPEC-07 |
| Liquidation blockade | lock priority + concurrency cap + cooldown | File 12 `T07`, SPEC-06 |
| Immortal dust position | `minLiquidationDebtUsdWad` + `T13` | File 12, SPEC-04/05 |
| Decimal confusion | `quantum` / `quantizeDown` at every boundary | File 08, SPEC-02 |
| Uncommitted state field | 21-field account leaf + three-reserve `reserveRoot` | File 09, SPEC-03 / N-1 |
| Arithmetic overflow wrap | checked U256 kernel with explicit `ok` return | `TOOLCHAIN-LOCK.md`, SPEC-10 |
| Gate collapse | strict `collateralFactorWad < liquidationThresholdWad` | File 10 bounds, SPEC-01 |
| Governance abuse | `T13` preconditions + committed identity + no withdrawal | File 12 `T13`, File 09 |

## Out of scope for V1

Nitro/Vela TEE compromise, Pyth protocol-level failure, chain reorganization beyond the configured
`ethereumConfirmations = 12`, and `governanceIdentity` key theft are detected or bounded but not
prevented. Each MUST be covered by an operational runbook rather than by protocol logic.

Every real incident becomes a regression test (File 29).


