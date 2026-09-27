# Noct Finance V1 — Audit of the CORRECTED Architecture Set and the TinyGo WASM Demo

**Scope:** `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/` (Files 01–34, README, TOOLCHAIN-LOCK),
`noct-demo-wasm/` (the only executable protocol code in the repository), the pinned dependency
`github.com/HorizenOfficial/vela-common-go v0.2.0` (verified from the local module cache), and the
root-level guides.

**Relationship to the prior three reports in this directory:** `EVM_SMART_CONTRACT_AUDIT.md`,
`PROTOCOL_ECONOMICS_AUDIT.md` and `TEE_CRYPTOGRAPHIC_AUDIT.md` were written against the
*pre-correction* documents. Several of their "undefined" findings have since been frozen
(WAD/RAY scales, `AdapterBlockTimestamp` as the interest clock, per-asset risk parameters).
**The findings below are new defects introduced or left behind by that correction pass**, plus
the first source-level audit of the demo WASM and the first verification of the pinned SDK's
actual arithmetic surface. Where a prior report already owns a finding it is referenced rather
than re-claimed.

---

## 1. Executive protocol summary

Noct Finance V1 is a **privacy-preserving, over-collateralized lending market** built as a guest
application on Horizen's **Vela** confidential-computing platform. Its distinguishing structural
choice is that *all* economic state lives inside a TEE as encrypted WASM state, and every state
transition is a single deterministic guest computation:

```
old encrypted state + authenticated request
  -> deterministic guest computation (TinyGo -> WASM)
  -> invariant validation
  -> ProcessResult { new state, withdrawals, events, report }
```

**Asset model (multi-collateral V1).** Three assets — USDC, ETH, ZEN (`08-NOCTSTATE-V1.md:41-45`) —
are each simultaneously collateral and borrowable (`10-PROTOCOL-CONFIGURATION.md:34-36`,
`32-V1-LIMITATIONS.md:9-11`). Liquidity is **Noct-funded**, not user-supplied: there are no
supplier shares, no supply index and no supplier yield in V1
(`11-ASSET-RESERVE-MODEL.md:21`, `32-V1-LIMITATIONS.md:19-20`). The protocol therefore earns the
full borrow spread and bears the full liquidity risk.

**The central accounting invariant is "deposit is not supply."** A deposit lands in a private
`cash[asset]` bucket; only an explicit `SUPPLY` transition reclassifies cash into
`collateral[asset]`, the only bucket that contributes to the health factor
(`08-NOCTSTATE-V1.md:66-70`, `12-COMPLETE-STATE-MACHINE.md:188-199`, `README.md:17-21`).
Borrowed funds land in a *third* bucket, `borrowed[asset]`, withdrawable to a wallet via a
separate transition (`12-COMPLETE-STATE-MACHINE.md:246,248-265`).

**Debt representation.** There is no stored principal and no entry index. Debt exists only as
RAY-scaled shares, with the reserve's monotonic `borrowIndex` as the single accrual accumulator:
`accountDebt(a) = mulDivUp(account.scaledDebt[a], reserve.borrowIndex[a], RAY)`
(`08-NOCTSTATE-V1.md:74-81`, `19-INTEREST-ACCRUAL.md:27-32`). Accrual is **lazy**: reserves are
advanced at the start of any transition that reads or mutates their debt
(`19-INTEREST-ACCRUAL.md:148-158`), in bounded chunks
(`maxAccrualChunkSeconds`, 4,096-chunk cap, `19-INTEREST-ACCRUAL.md:143-146`).

**The interest clock is not the host clock.** Every financial timestamp is
`OracleState.AdapterBlockTimestamp` — the EVM block time of the on-chain `OracleAdapter` snapshot
(`18-ORACLE-ARCHITECTURE.md:165-167`, `10-PROTOCOL-CONFIGURATION.md:167-171`). `time.Now()` is
prohibited in consensus logic. The guest deliberately performs **no** self-freshness check because
it has no authenticated independent clock; freshness is an EVM-side property
(`18-ORACLE-ARCHITECTURE.md:163`).

**Oracle path.** A keeper pushes Pyth `updateData` into an on-chain `OracleAdapter`, which verifies
it through the official Pyth EVM contract under ten explicit checks and accepts all feeds
atomically or none (`18-ORACLE-ARCHITECTURE.md:36-60`). A private risk intent is staged by
`process_request`, coupled by `NoctTrigger` to a *newly verified* epoch, and delivered back into
the guest over Vela's authenticated `TRUSTPROCESS` route
(`20-LIQUIDATION-DISCOVERY.md:15-30`, `18-ORACLE-ARCHITECTURE.md:127-161`). Callers can never
supply a price, a snapshot, or an older epoch.

**Settlement is explicitly non-atomic.** Repayment and liquidation are three-phase
PREPARE / CAPTURE / COMMIT workflows. The spec is unusually candid that this is *not* cross-contract
atomicity: safety comes from exclusive locks, authenticated receipts, exact operation binding,
append-only replay protection and idempotent commit
(`12-COMPLETE-STATE-MACHINE.md:354`, `20-LIQUIDATION-DISCOVERY.md:110-112`). Once a payment is
captured the operation **cannot** expire or be refunded; commit is retried until idempotently
successful (`10-PROTOCOL-CONFIGURATION.md:180`, `12-COMPLETE-STATE-MACHINE.md:315-320`).

**Privacy model.** Liquidation discovery runs *inside* the enclave: a permissionless keeper gets
back only an opaque `operationID` and a quote, never a candidate list, a borrower identity or a
health factor (`20-LIQUIDATION-DISCOVERY.md:9-11,114-123`). Two distinct roots are maintained and
must never be equated — Vela's `SHA256(encrypted AppData)` and Noct's own plaintext `appRoot` over
five subroots (`09-STATE-COMMITMENT-MODEL.md:11-20`).

**Assessment.** The *design* is sound and, in several places, better than typical lending specs:
the receipt-driven debt model, the fail-closed oracle posture, the layered replay domains
(`23-REPLAY-PROTECTION.md:9-19`) and the honest refusal to claim atomicity are all correct
instincts. **The problem is not the design — it is that the frozen documents do not implement
their own design consistently, and the sole executable artifact implements almost none of it.**

Three conclusions dominate this audit:

1. **The frozen specification is internally contradictory in ways that are individually
   fund-losing.** The most severe is that `liquidationThresholdWad` is declared, bounded and
   committed but **never used in any formula anywhere** — the borrow gate and the liquidation gate
   are the *same* inequality at the *same* boundary, giving V1 a **zero-percent liquidation buffer**
   (SPEC-01). Five other documents in this repository specify the two-gate design correctly, which
   proves the collapse is a regression, not an intent.

2. **The commitment scheme does not cover the multi-collateral state it is supposed to protect.**
   `accountRoot`'s leaf is still the two-asset V1 leaf and omits nine or more persisted economic
   fields; `reserveRoot` has **no USDC leaf at all** (SPEC-02, SPEC-03). Anything not in a leaf is
   not in `appRoot`, and therefore not constrainable by any ZK proof — including all USDC debt.

3. **The demo WASM is not a reduced-fidelity version of the spec; it is a different, exploitable
   protocol.** It has no reserves, no interest, no oracle, no prices, no asset dimension, no nonce
   check, no receipt verification, and an **unchecked modular multiply in its only solvency check**
   that permits unlimited borrowing against zero collateral in a single request (DEMO-01). Its
   `REPAY` path cancels debt from an unauthenticated JSON field (DEMO-02), and `requestType == 2`
   dumps the entire private ledger to any caller (DEMO-03).

There is also a **hard toolchain blocker** underneath all of this: the pinned
`vela-common-go v0.2.0` provides **no U256xU256 multiplication and no `mulDivDown`/`mulDivUp`**
(verified against the module cache), yet five frozen documents mandate exactly those primitives
(SPEC-10). The mandated arithmetic of V1 is **not implementable** with the dependency V1 has
pinned, and every row of `TOOLCHAIN-LOCK.md` is still `TODO`.

**No Solidity, Rust, Noir or Circom source exists anywhere in this repository** (verified by
recursive file enumeration). `OracleAdapter`, `NoctTrigger`, the custody/escrow contracts,
`ProcessorEndpoint` integration, and the entire UltraHonk/zkVerify layer are specification only.
The auditable attack surface is therefore ~19 KB of Go plus a document set.

---

## 2. Invariant breakdown

Each invariant below is one that the corrected set *asserts*. For each: where it is declared,
whether it is actually enforced by the frozen transition rules, and what breaks it.

### I-1. "Deposit is not supply"
**Declared:** `08-NOCTSTATE-V1.md:66-70`; `12-COMPLETE-STATE-MACHINE.md:188-199`; `README.md:17-21`.
**Enforced in spec:** Yes, cleanly. T01 credits `cash`, T03 alone reclassifies `cash -> collateral`,
and `weightedCollateralUsd` reads only `collateral` (`12:101-107`). No transition lets a deposit
reach `collateral` without T03.
**Broken by:** the demo. `ProcessDeposit` (`lending.go:52-79`) credits `account.CollateralBalance`
directly, erasing the `cash`/`collateral` distinction entirely (DEMO-05). There is no `cash` bucket
in `NoctAccount` (`state.go:20-27`) at all.

### I-2. Every mint/credit is backed by an authenticated receipt
**Declared:** `11-ASSET-RESERVE-MODEL.md:73-77`; `12-COMPLETE-STATE-MACHINE.md:64`;
`17-SETTLEMENT-ARCHITECTURE.md:13-16`.
**Enforced in spec:** Yes for repay (T09) and liquidation (T11/T12), which both consume
`DepositReceipts[asset]` and forbid debt reduction without one (`12:299,340,368,457-461`).
**Broken by:** the demo. `ProcessRepay` reduces `BorrowedBalance` from the request payload alone
(DEMO-02). The `deposit` export is the only receipt-authenticated entry point and repay never
touches it.

### I-3. Borrow gate is strictly tighter than the liquidation gate
**Declared (implicitly):** `10-PROTOCOL-CONFIGURATION.md:48-50` bounds
`0 < collateralFactorWad < liquidationThresholdWad <= WAD`, which only has economic meaning if the
two gates differ.
**Enforced in spec:** **NO.** This is SPEC-01 and it fails completely.

### I-4. `healthFactor >= 1.0` is the solvency boundary
**Declared:** `08-NOCTSTATE-V1.md:199`; `10:103-118`; `11:168-172`; `12:101-127`.
**Enforced in spec:** Consistently, in four places. That consistency *is* the problem: it is used
both as the borrow gate and as the liquidation trigger, so I-3 collapses into I-4.

### I-5. All debt is share-scaled and monotonic in the index
**Declared:** `08:74-81`; `19:38-41`; `12:115-116`; `17:59`.
**Enforced in spec:** Yes — every debt read is `mulDivUp(scaledDebt, index, RAY)`, every write
rescales, and the index is append-only and monotonic (`19:88-90`). Rounding direction is
consistently *against* the borrower at debt reads and *for* the reserve at repay rescales.
**Not implementable:** `mulDivUp`/`mulDivDown` do not exist in the pinned SDK (SPEC-10).
**Broken by:** the demo, which stores debt as unscaled principal with no index at all (DEMO-04).

### I-6. Reserve liquidity is conserved
**Declared:** `11:34-38,50-52,81-86`; `10:181-184`.
`Custody[a] = Ledger[a] + PendingInbound[a] + PendingOutbound[a]`, never negative, no cross-asset
netting, and post-transition reconciliation is mandatory.
**Enforced in spec:** Yes. `Ledger` bookkeeping is explicit per transition
(`12:186,197,223,227,244,263,276,293,349,373,389,395`), and no transition moves value between
assets except liquidation, which nets within the same collateral asset (`11:144-149`).
**Broken by:** the demo — `ProcessRepay` decreases `TotalBorrows` without increasing any asset
balance or `Ledger` counter, destroying value (DEMO-02, DEMO-04). `ProcessBorrow` emits a
withdrawal with no corresponding liquidity decrement (DEMO-10).

### I-7. The financial clock is authenticated
**Declared:** `18:163-167`; `10:167-171`; `19:59`.
**Enforced in spec:** Yes. `AdapterBlockTimestamp` derives only from a Pyth-verified EVM snapshot,
never from a request; `maxRiskDelaySeconds` bounds the gap between the intent's staging block and
the snapshot block; a snapshot that failed on-chain verification cannot be staged.
**Gap:** `maxRiskDelaySeconds` has no frozen value and is absent from `configCommitment` (SPEC-08),
so I-7 is unparameterized.
**Broken by:** the demo, which emits `account.Nonce` as a `"timestamp"` field and never reads a
clock at all (DEMO-11).

### I-8. Two roots, never equal
**Declared:** `09:11-20`.
**Enforced in spec:** Structurally yes — Vela commits `SHA256(encrypted state)`, Noct commits
`appRoot` over five subroots; the two are different domains by construction.
**Broken by:** the demo, which implements **neither**. Verified by full-text search: `appRoot` does
not appear anywhere in `noct-demo-wasm`, and `AppEvents` is hardcoded to `[]types.AppEvent{}` at all
eleven return sites in `operations.go`. There is no subroot construction, no `accountRoot`, no
`reserveRoot`, no `historyRoot`, and no `consumedReceiptRoot`. The only state commitment is Vela's
opaque hash of the serialized JSON blob (DEMO-08).

### I-9. Replay is refused at seven layered domains
**Declared:** `23:9-19,26,40-46,214-219`.
**Enforced in spec:** Yes in principle. The strongest property is `23:122` — because captured
payment receipts are consumed exactly once, a retried CAPTURE or COMMIT is idempotent rather than
double-spending, and this holds independently of nonce replay protection.
**Not implementable:** `23:16` and `12:173,181-183,469` require a "deterministic withdrawal ID",
but `types.Withdrawal` has exactly three fields and **no ID** (SPEC-10).
**Broken by:** the demo. `account.Nonce` is incremented but never compared; `applicationId` and
`chainID` are neither stored nor validated; state is a bare JSON blob with no version binding
(DEMO-07).

### I-10. Privacy is preserved under all discovery paths
**Declared:** `20:114-131`; `24-PRIVACY-LEAKAGE-ANALYSIS.md`.
**Enforced in spec:** Yes — the keeper receives only `operationID` and a quote; scanning returns
`nil`; the deanonymization route requires an authority key, an `AuthorityRegistry` check, an
explicit narrow scope, and single-use nonce binding.
**Broken by:** the demo, in the most direct way possible (DEMO-03).

### Invariants the spec does not state but needs
- **No dust-position floor or bad-debt socialization path.** `12:392` explicitly defers this
  (SPEC-04).
- **No liquidation profitability or seizability predicate** (SPEC-05).
- **No governance, pause, or upgrade authority model.** `24`, `25-THREAT-MODEL.md`,
  `26-SECURITY-MODEL.md` and `31-DEPLOYMENT-ARCHITECTURE.md` are ~1 KB stubs, and
  `IMPLEMENTATION_GUIDE.md:69-70` cites `31-GOVERNANCE-MODEL.md` and `32-COMPLIANCE-ARCHITECTURE.md`
  — **neither file exists** (SPEC-09).
- **No bound on `appState` growth from view-only transitions** (DEMO-09).

---

## 3. Vulnerability and gap catalog

Severity scale: **CRITICAL** = direct loss or theft of funds / total privacy break;
**HIGH** = protocol-wide insolvency risk, fund lock, or defeat of a frozen security control;
**MEDIUM** = correctness defect requiring specific conditions or degrading guarantees;
**LOW** = hygiene / auditability.

### SPEC-01 — Zero liquidation buffer: `liquidationThresholdWad` is never applied · CRITICAL

**Affected components.** `10-PROTOCOL-CONFIGURATION.md:48-67,103-118`;
`12-COMPLETE-STATE-MACHINE.md:101-127,204-222,336-350`; `08-NOCTSTATE-V1.md:95-99,199`;
`11-ASSET-RESERVE-MODEL.md:164-172`; `20-LIQUIDATION-DISCOVERY.md`.

**Mechanics.** File 10 defines the two risk parameters as an ordered pair:

```
0 < collateralFactorWad < liquidationThresholdWad <= WAD      (10:48-50)
```

and freezes ETH at `collateralFactorWad = 0.80`, `liquidationThresholdWad = 0.85` (`10:62-67`).
That strict inequality only carries meaning if the two factors gate *different* decisions. In the
frozen state machine they do not. The health factor is defined with `collateralFactorWad` already
applied to the numerator:

```
weightedCollateralUsd(a) = sum mulDivDown(collateral[a], price[a], WAD) * collateralFactorWad
weightedDebtUsd(a)       = sum mulDivUp(accountDebt(a), price[a], WAD)
healthFactor(a)          = weightedCollateralUsd / weightedDebtUsd      (10:103-118)
```

The borrow gate (`12:204-222`) requires `postHealthFactor >= WAD`. The liquidation gate
(`12:336-350`, `20`) triggers on `healthFactor < WAD`. **Same expression, same boundary.** A
position that has just passed the borrow gate is, by construction, already liquidatable — and
because `12:228` accrues all reserves *at the start of the borrow transition itself*, and
`weightedDebtUsd` rounds **up** (`mulDivUp`) while `weightedCollateralUsd` rounds **down**
(`mulDivDown`), it is frequently *strictly below* the boundary the instant it is created.

`liquidationThresholdWad` appears in File 10 only in the bounds clause and in the `configCommitment`
preimage. It is never a term in any formula in Files 08, 10, 11, 12, 17, 18, 19 or 20.
**The parameter is dead.**

**Quantified impact.** With ETH at `cf = 0.80`, `lt = 0.85`:

| Design | Borrow allowed while | Liquidatable when | Buffer |
|---|---|---|---|
| Frozen spec (File 10/12) | `0.80·C >= D` | `0.80·C < D` | **0.00%** |
| Intended (lt applied) | `0.80·C >= D` | `0.85·C < D` | collateral may fall **5.88%** |
| Repo's earlier docs (`ARCHITECTURE_FREEZE_COMPLETE.md:159-160`) | HF >= 1/0.60 | HF < 1/0.75 | **20%** |

The 5.88% figure is `0.85/0.80 - 1`. The correction pass did not merely shrink the buffer — it
eliminated it.

**Why this is CRITICAL and not merely a parameter nit.** Every over-collateralized market depends
on a positive buffer for three reasons, all of which vanish at zero:

1. **Oracle granularity.** Between two `AdapterBlockTimestamp` values the guest cannot observe
   price movement (`18:163`). At zero buffer, *any* adverse tick between the borrow and the next
   snapshot liquidates. Positions churn through liquidation on pure noise.
2. **Interest accrual is monotonic and unavoidable.** `19:27-32` increases `borrowIndex` strictly
   over time, so `weightedDebtUsd` strictly increases with no user action. A position borrowed at
   exactly `HF = 1.0` crosses `HF < 1.0` within one accrual chunk (`maxAccrualChunkSeconds`).
   **Every max-LTV borrower is guaranteed to be liquidated** at the earliest opportunity, paying
   `liquidationPenaltyWad` on top. This converts a lending product into a deterministic
   fee-extraction machine against its own users.
3. **Keeper latency becomes solvency risk.** `20` is a discover-stage-execute pipeline with an EVM
   round trip. With zero buffer there is no price room in which to absorb that latency, so the only
   defense against a fast adverse move is the penalty — which is sized for a *buffered* design.

**Simulation.**

```
Config (10:62-67, ETH): cf = 0.80e18, lt = 0.85e18, borrowIndex = 1.0e27
Price ETH = 3000e18 USD; user collateral = 1.0 ETH  => collateralUsd = 3000e18
weightedCollateralUsd = mulDivDown(3000e18, 0.80e18, WAD) = 2400e18

BORROW: gate is postHealthFactor >= WAD
  max weightedDebtUsd = 2400e18  =>  D_max = 2400 USDC
  at D = 2400 USDC: HF = 2400e18 / 2400e18 = 1.0e18 -> ACCEPTED (>= WAD)

ONE SECOND LATER, lazy accrual runs (19:88-90), 2% base APR:
  borrowIndex  1.0e27 -> 1.000000000063e27
  accountDebt  = mulDivUp(scaledDebt, newIndex, RAY) = 2400.000000152 USDC
  weightedDebtUsd = mulDivUp(2400.000000152e6, 1e18, WAD) rounds up further
  HF = 2400e18 / 2400.000000152e18 < WAD  -> LIQUIDATABLE

Collateral seized with liquidationPenaltyWad on a position that was solvent one
second ago and took no action. This repeats for every borrower at max LTV.
```

The same result holds with **no** price movement and **no** accrual if `mulDivUp` rounds debt up by
a single wei on a position whose debt exactly equals its weighted collateral — which is precisely
the position the borrow gate is designed to permit. The two-sided rounding in `10:103-118`
(collateral down, debt up) makes the equality case resolve *against* the borrower.

**Corroboration that this is a regression, not intent.** Five documents in this repository specify
the two-gate design correctly:
`NOCT_MULTI_COLLATERAL_ARCHITECTURE.md:495` (liquidate when
`debtUsd > mulDivDown(collateralUsd, liquidationThresholdWad, WAD)`) and `:509`
(borrow allowed if `postHF >= WAD / maxLTVWad`);
`ARCHITECTURE_FREEZE_COMPLETE.md:159-160` (explicitly names a "15% buffer");
`IMPLEMENTATION_GUIDE.md:88`; `ROADMAP.md:135,192`;
`MULTI_COLLATERAL_EXECUTIVE_SUMMARY.md:495,509`.
The corrected File 10/12 pair folded `collateralFactorWad` into the health-factor numerator and
then failed to introduce the threshold anywhere, silently merging the gates.

**Fix.** Restore a genuinely separate liquidation boundary. Option B is the smaller change and
preserves File 10's existing `healthFactor` definition; adopt one and propagate to
`08:95-99,199`, `11:164-172`, `12:101-127,204-222,336-350` and `20`.

```
# Option B (recommended, minimal diff)
rawCollateralUsd(a) = sum mulDivDown(collateral[a], price[a], WAD)
weightedCollateralUsd(a) = rawCollateralUsd(a) * collateralFactorWad / WAD        # borrow gate
liquidationCollateralUsd(a) = rawCollateralUsd(a) * liquidationThresholdWad / WAD  # liquidation gate
weightedDebtUsd(a) = sum mulDivUp(accountDebt(a), price[a], WAD)

healthFactor(a)            = weightedCollateralUsd(a)    / weightedDebtUsd(a)   # for borrowing
liquidationHealthFactor(a) = liquidationCollateralUsd(a) / weightedDebtUsd(a)   # for liquidation

BORROW GATE       (12:204-222): postHealthFactor            >= WAD
LIQUIDATION GATE  (12:336-350): liquidationHealthFactor     <  WAD
```

Add two **mandatory config invariants** to `10:48-50` and to the `configCommitment` validation
step, so the zero-buffer configuration cannot be committed at all:

```
ASSERT collateralFactorWad < liquidationThresholdWad
ASSERT minLiquidationBufferWad := liquidationThresholdWad - collateralFactorWad >= 0.05e18
```

Add to File 12 a borrow-headroom rule so a freshly created position cannot be liquidatable on the
next accrual tick:

```
REJECT borrow if postHealthFactor < WAD + minBorrowHeadroomWad
  where minBorrowHeadroomWad >= expected accrual over maxAccrualChunkSeconds at maxUtilizationRate
```

Finally, add a regression test to the acceptance suite: *borrow to the maximum permitted size,
advance the clock by one accrual chunk with all prices unchanged, and assert the position is
**not** liquidatable.*

---

### SPEC-02 — Decimal-domain confusion in cross-asset liquidation: unbounded collateral theft · CRITICAL

**Affected components.** `12-COMPLETE-STATE-MACHINE.md:396-409,426-439`;
`08-NOCTSTATE-V1.md:41-45,126-130,140-141`; `10-PROTOCOL-CONFIGURATION.md:35`;
`18-ORACLE-ARCHITECTURE.md:54,91`; `33-FUTURE-EXTENSIONS.md:70`; `11-ASSET-RESERVE-MODEL.md`.

**Mechanics.** V1 ships three assets — USDC, ETH, ZEN (`10:35`) — and USDC is **6-decimal**. Prices
are normalized to WAD, 18 decimals (`18:54`, `18:91` `normalizedPricesWad`). The frozen liquidation
conversion is:

```
debtPrice            = OracleState.prices[debtAsset]              # 18-dec WAD
collateralPrice      = OracleState.prices[collateralAsset]        # 18-dec WAD
debtPaymentUsd       = mulDivUp(paymentAmount, debtPrice, WAD)
baseCollateralNeeded = mulDivUp(debtPaymentUsd, WAD, collateralPrice)
collateralWithBonus  = mulDivUp(baseCollateralNeeded,
                                WAD + liquidationBonusWad[collateralAsset], WAD)
collateralToWithdraw = min(borrower.collateral[collateralAsset], collateralWithBonus)
                                                                  (12:398-408)
```

The unit of `collateralWithBonus` is entirely determined by the unit of `paymentAmount`, and **no
document defines the decimal domain of `paymentAmount`, `collateral[a]` or `scaledDebt[a]`, nor any
native<->WAD conversion step.** The repository states two mutually exclusive positions:

- `08:128,130` types `paymentAmount` and `collateralToWithdraw` as **`AmountWad`**, and `33:70`
  confirms "Internal V1-style accounting remains WAD" — i.e. 18-decimal everywhere.
- `33:70` *also* says "Assets with native decimals other than 18 **may be supported** through
  explicit checked conversion at custody boundaries... Conversion policy **MUST** define dust
  ownership and both rounding directions; native units **MUST never** be confused with WAD values."
  That places 6-decimal USDC in *future extensions* — while `10:35` and `08:41-45` ship it in V1.

Both readings are broken, in opposite directions.

**Reading A — internal accounting is native units** (as `11`'s custody ledger and `12:386-389`'s
direct `paymentAmount <= maxPayment` comparison imply). Then `borrower.collateral[USDC]` is
6-decimal, but `collateralWithBonus` inherited ETH's 18-decimal scale through `12:402-407`. The
`min()` at `12:408` compares across a **1e12** scale gap, and the result is written straight into
native collateral and a native-token withdrawal (`12:429,435-439`).

**Reading B — internal accounting is `AmountWad`** (as `08:128,130` states). Then `collateral[a]`
is 18-decimal and the `min()` is internally consistent — but `12:437` emits that WAD quantity as
`Withdrawal.Amount`, and Vela custody moves **native** ERC-20 units (`types.Withdrawal.Amount` is
`*Uint256`, `vela-common-go v0.2.0/wasm/types/common.go:22-26`). The 1e12 error simply moves to the
custody boundary. Symmetrically, `12:389` compares a WAD `maxPayment` against the native
`paymentAmount` the escrow actually collected.

**Simulation (Reading A, the canonical example from `01:54` and `32:13`: "pay ETH debt, seize USDC
collateral").**

```
Borrower: collateral[USDC] = 10,000 USDC = 10_000_000_000 (6-dec native)
          currentDebt[ETH] = 5 ETH; borrowIndex = 1e27 (RAY)
Config:   liquidationBonusWad[USDC] = 0.05e18 (10:56); closeFactorWad = 0.5e18 (10:57)
Prices:   ETH = 3000e18 (WAD), USDC = 1e18 (WAD)

Attacker calls PREPARE_LIQUIDATION with paymentAmount = 1_000_000_000 wei ETH (= 1e-9 ETH)

  maxPayment = min(5 ETH, mulDivDown(5 ETH, 0.5e18, WAD)) = 2.5 ETH
  require 1e-9 ETH <= 2.5 ETH                              -> PASS   (12:389)
  scaledDebtReduction = mulDivDown(1e9, 1e27, 1e27) = 1e9  -> nonzero, PASS (12:394)

  debtPaymentUsd       = mulDivUp(1e9, 3000e18, 1e18) = 3e12
  baseCollateralNeeded = mulDivUp(3e12, 1e18, 1e18)   = 3e12
  collateralWithBonus  = mulDivUp(3e12, 1.05e18, 1e18)= 3.15e12
  collateralToWithdraw = min(1e10, 3.15e12) = 1e10         <- ENTIRE BALANCE  (12:408)

COMMIT_LIQUIDATION (12:426-439):
  borrower.scaledDebt[ETH]  -= 1e9    (debt cut by 1e-9 ETH  ~ $0.000003)
  borrower.collateral[USDC] -= 1e10   (ALL 10,000 USDC removed)
  Withdrawal{ TokenAddress: USDC, Amount: 1e10, Destination: attacker }

RESULT: attacker pays $0.000003 of ETH debt and withdraws 10,000 USDC.
```

Every check the spec defines passes. The theft is bounded only by the victim's collateral balance,
and the required payment is bounded below only by `12:394`'s "require nonzero", which 1 wei of an
18-decimal debt asset satisfies whenever `index == RAY`. **This is a permissionless, unbounded
collateral-drain primitive against every USDC-collateralized borrower, in the frozen
specification's headline multi-asset feature.**

The mirror direction (USDC debt, ETH collateral) produces the opposite failure: `collateralWithBonus`
comes out 1e12 too small, so `min()` returns it, and the liquidator pays 50% of the debt while
receiving collateral worth ~1e-12 of it — an immediate, permanent loss (`12:419` forbids timeout or
refund after capture). Both are catastrophic; they simply hit different parties.

**Fix.** Introduce one explicit, frozen decimal policy and apply it at every boundary.

1. **Freeze the domains** in `10-PROTOCOL-CONFIGURATION.md` (new section), referenced from `08`,
   `11`, `12`, `17` and `19`:
   ```
   decimals[USDC] = 6, decimals[ETH] = 18, decimals[ZEN] = 18     # validated at deploy
   Internal accounting (collateral, cash, borrowed, scaledDebt-derived debt,
     paymentAmount, collateralToWithdraw, Ledger, availableLiquidity) is NATIVE units.
   Prices are WAD (18-dec) USD per whole token.
   Every USD intermediate is WAD-normalized:
     usdWad = mulDivUp(nativeAmount, priceWad, 10**decimals[asset])
   ```
2. **Rewrite `12:398-408`** so every term carries an explicit unit and the conversion is symmetric:
   ```
   debtPaymentUsdWad   = mulDivUp(paymentAmount, debtPrice, 10**decimals[debtAsset])
   baseCollateralNat   = mulDivUp(debtPaymentUsdWad, 10**decimals[collateralAsset], collateralPrice)
   collateralWithBonus = mulDivUp(baseCollateralNat,
                                  WAD + liquidationBonusWad[collateralAsset], WAD)
   collateralToWithdraw = min(borrower.collateral[collateralAsset], collateralWithBonus)
   ```
   `10**decimals[a]` must be a committed config value, never a literal `WAD`.
3. **Add a mandatory conservation assertion at PREPARE**, before the quote is stored:
   ```
   REQUIRE mulDivDown(collateralToWithdraw, collateralPrice, 10**decimals[collateralAsset])
           >= mulDivUp(paymentAmount, debtPrice, 10**decimals[debtAsset])
   REQUIRE collateralToWithdraw == collateralWithBonus        # no silent truncation
   ```
   Rejecting rather than clamping removes the entire `min()` silent-shortfall class (SPEC-05).
4. **Define the custody-boundary conversion and its dust owner**, as `33:70` already demands,
   including both rounding directions. Under the native-internal policy above, egress is identity;
   if any WAD-normalized representation is retained, specify
   `nativeAmount = mulDivDown(wadAmount, 10**decimals, WAD)` on egress and state that residual dust
   accrues to the reserve, never to the caller.
5. **Add decimal-consistency tests** to `29-TESTING-STRATEGY.md` for all six ordered
   `(debtAsset, collateralAsset)` pairs, asserting that liquidating `X` USD of debt seizes
   collateral within `[X, X*(1+bonus)]` USD for every pair.

---

### SPEC-03 — Commitment leaves do not cover the multi-asset state: USDC debt is uncommitted · CRITICAL

**Affected components.** `09-STATE-COMMITMENT-MODEL.md:45-70`; `08-NOCTSTATE-V1.md:41-45,66-81`;
`10-PROTOCOL-CONFIGURATION.md:35`; `12-COMPLETE-STATE-MACHINE.md` (all asset-keyed maps).

**Mechanics.** `09:47` states the intent correctly — "An account leaf commits **every** persisted
economic or authorization field" — and then freezes a leaf that is the *pre-multi-collateral*
two-asset shape:

```
H(NOCT_ACCOUNT_LEAF_V1 ||
  accountAddress ||
  cashUSDC || collateralUSDC || borrowedZEN || borrowedETH ||      (09:52)
  scaledDebtZEN || scaledDebtETH ||                                (09:53)
  positionNonce || lastUpdateTimestamp ||                          (09:54)
  debtLockZEN || debtLockETH || collateralLockUSDC)                (09:55)
```

Files 08, 10, 11 and 12 all model three assets that are **each simultaneously collateral and
borrowable** (`08:41-45,66-81`; `10:34-36`; `32:9-11`), with per-asset maps `cash[a]`,
`collateral[a]`, `borrowed[a]`, `scaledDebt[a]`, `debtLock[a]`, `collateralLock[a]`. The leaf
hardcodes one collateral asset and two borrowables. **Nine persisted economic fields are absent
from the commitment:**

| Missing field | Consequence |
|---|---|
| `cashETH`, `cashZEN` | Deposited-but-unsupplied ETH/ZEN is uncommitted |
| `collateralETH`, `collateralZEN` | **All ETH and ZEN collateral is uncommitted** |
| `borrowedUSDC` | Borrowed USDC awaiting withdrawal is uncommitted |
| `scaledDebtUSDC` | **All USDC debt is uncommitted** |
| `debtLockUSDC` | USDC repayment locks are uncommitted |
| `collateralLockETH`, `collateralLockZEN` | ETH/ZEN liquidation locks are uncommitted |

`reserveRoot` has the same defect, stated explicitly:

```
Each ZEN or ETH reserve leaf is: ...                                     (09:62)
"The root includes both supported assets in canonical asset-ID order."    (09:70)
```

**There is no USDC reserve leaf.** But USDC is borrowable (`10:35`), so it must have `borrowIndex`,
`availableLiquidity`, `totalScaledDebt` and `lastAccrualTimestamp` — and `12:228` requires the
reserves to be accrued on every borrow. USDC's accrual state is neither committed nor defined. Two
documents disagree on how many reserves exist: `09:62,70` says two; `10:35` and `08:41-45` say three.
`34-IMPLEMENTATION-ROADMAP.md:183` repeats the two-reserve assumption ("**both** reserves accrued").

**Impact.** `appRoot` is the value ZK proofs constrain and that `historyRoot` / `outcomeCommitment`
bind (`09:107-112`). Anything not in a leaf is:
- **not provable** — a zkVerify circuit over `GlobalRootStateV1` cannot assert anything about ETH
  collateral or USDC debt, because they contribute nothing to `accountRoot`;
- **not tamper-evident** — a compromised or buggy enclave could inflate `collateral[ETH]` or erase
  `scaledDebt[USDC]` and still produce a perfectly valid-looking `appRoot`;
- **not auditable** — the append-only `historyRoot` chain cannot detect it retroactively.

Since `09` and `26-SECURITY-MODEL.md` rest V1's integrity argument on commitment-plus-proof, this
defeats the primary control for two of three assets. It also compounds SPEC-02: that attack steals
`collateral[USDC]` (committed), but a variant stealing `collateral[ETH]` would leave **no trace in
`appRoot` at all**.

**Fix.** Make the leaves asset-generic and derived from the frozen asset list, never hand-enumerated.

```
# replaces 09:50-55
accountLeaf(addr) = H(NOCT_ACCOUNT_LEAF_V2 ||
    addr ||
    for asset in CANONICAL_ASSET_ORDER:                 # [USDC, ETH, ZEN], committed in config
        cash[asset] || collateral[asset] || borrowed[asset] || scaledDebt[asset] ||
        debtLock[asset] || collateralLock[asset] ||
    positionNonce || lastUpdateTimestamp)

# replaces 09:64-68
reserveLeaf(asset) = H(NOCT_RESERVE_LEAF_V2 ||
    assetID || availableLiquidity || totalScaledDebt ||
    borrowIndexRay || lastAccrualTimestamp || utilizationRateWad)
reserveRoot = H(NOCT_RESERVE_ROOT_V2 || leafCount ||
                reserveLeaf(asset) for asset in CANONICAL_ASSET_ORDER)
```

Additionally:
- Replace "ZEN or ETH" (`09:62`) and "both supported assets" (`09:70`, `34:183`) with "each asset in
  `CANONICAL_ASSET_ORDER`", and verify `leafCount == len(CANONICAL_ASSET_ORDER)` so a missing
  reserve cannot be silently dropped.
- Commit `CANONICAL_ASSET_ORDER` and `decimals[asset]` inside `configCommitment` (`10:186-220`), so
  leaf layout is bound to the configuration that produced it.
- Bump the domain separators to `_V2` and set `schemaVersion = 2` (`09:120`). Per `09:116`, proofs
  must serialize exactly one version; mixing V1 and V2 leaves would otherwise be undetectable.
- Add a **structural coverage test**: enumerate every field of `08`'s `AccountState` and
  `ReserveState` and assert a corresponding term exists in the leaf. This makes it impossible for a
  future asset or field to fall out of the commitment unnoticed.
- Extend the lock-encoding rule at `09:58` to cover *all* assets, not just the three named, and state
  that an absent lock uses the canonical zero encoding for every asset.

---

### SPEC-04 — 50% close factor plus dust rejection with no bad-debt path = permanently unliquidatable positions · CRITICAL

**Affected components.** `12-COMPLETE-STATE-MACHINE.md:385-394`;
`10-PROTOCOL-CONFIGURATION.md:57,66,75,84`; `32-V1-LIMITATIONS.md:28-29`.

**Mechanics.** The close-factor arithmetic is:

```
currentDebt = mulDivUp(borrower.scaledDebt[debtAsset], index[debtAsset], RAY)
closeLimit  = mulDivDown(currentDebt, assetConfig[debtAsset].closeFactorWad, WAD)
maxPayment  = min(currentDebt, closeLimit)
require paymentAmount <= maxPayment                                    (12:386-389)
```

All three assets freeze `closeFactorWad = 0.5e18` (`10:57,66,75`). Since `0.5 < 1`,
`closeLimit = floor(currentDebt/2) < currentDebt`, so **`maxPayment` is always `currentDebt/2`** —
the `min()` is dead code and one liquidation can never retire more than half the debt. Closing a
position therefore requires `ceil(log2(currentDebt / minPayment))` independent three-phase
PREPARE/CAPTURE/COMMIT cycles, each needing a fresh accepted oracle epoch (`12:411`) and an EVM
round trip.

At the terminal step the spec mandates a **hard rejection**:

> "If config permits a close factor below WAD and rounding makes `closeLimit = 0`, liquidation of
> that dust position MUST be rejected for explicit bad-debt handling; an implementation MUST NOT
> silently seize collateral for zero debt payment."  (`12:392`)

`closeLimit = mulDivDown(1, 0.5e18, WAD) = 0`, so any position whose `currentDebt` rounds to one
unit is **permanently unliquidatable**. The clause defers resolution to "explicit bad-debt
handling" — which V1 does not have:

> "If collateral value falls below debt value after liquidation, V1 monitors but does not
> auto-socialize losses. Bad debt handling (insurance reserves, socialized loss) is deferred to
> future versions."  (`32:28-29`)

So the spec routes the dust case to a mechanism that is explicitly out of scope. The position is
neither liquidatable nor resolvable: its collateral stays locked, its debt keeps accruing
(`19:27-32`), and it permanently occupies `totalScaledDebt` — which then overstates outstanding
debt relative to recoverable value and distorts `utilizationRate`, and therefore every borrower's
interest rate (`19`).

**Interaction with SPEC-01 makes this systemic rather than marginal.** With a zero liquidation
buffer, *every* max-LTV borrower becomes liquidatable on the next accrual tick. Liquidation is then
the protocol's only solvency mechanism, and it is the mechanism that (a) needs multiple cycles per
position, (b) loses money for liquidators in the truncation direction (SPEC-05), and (c) dead-ends
at dust. A volatile market therefore produces a growing population of stuck, unliquidatable,
still-accruing positions with no exit — exactly the condition `32:28-29` declines to handle.

**Simulation.**

```
Borrower: currentDebt[USDC] = 3e6 (3 USDC native); cf = 0.5e18; index = 1e27
Cycle 1: closeLimit = floor(3e6/2) = 1_500_000 -> maxPayment = 1.5 USDC; liquidator pays 1.5
Cycle 2: currentDebt = 1.5e6 + accrual -> closeLimit = 750_000; pays 0.75
   ... each cycle halves, while accrual pushes currentDebt back up ...
Cycle N: currentDebt = 1 -> closeLimit = mulDivDown(1, 0.5e18, 1e18) = 0
         maxPayment = 0; require paymentAmount <= 0 -> no valid payment exists
         12:392  -> MUST reject, defer to bad-debt handling
         32:28-29 -> bad-debt handling does not exist in V1
=> Terminal. Collateral locked forever; debt accrues forever;
   totalScaledDebt permanently contains an unrecoverable unit.
```

**Fix.**

1. **Set `closeFactorWad = WAD` for all three assets in V1** (`10:57,66,75`). A 50% close factor
   suits deep, competitive liquidation markets with many liquidators; V1 has a single-keeper
   discovery path (`20`) and no bad-debt backstop. Full close makes liquidation one-shot and
   removes the dust terminal state, because `closeLimit = currentDebt` can be `0` only when
   `currentDebt = 0` — no debt, nothing to liquidate. `12:394` already special-cases full repayment
   ("all scaled debt only when payment equals current debt"), so `closeFactorWad = WAD` is fully
   supported by the existing rules with no other change.
2. **If a sub-WAD close factor is retained**, add the missing terminal handler instead of deferring
   it: define a `WRITE_OFF` transition that, when `closeLimit == 0 && currentDebt > 0`, seizes all
   remaining `collateral[a]` into a protocol-owned `badDebtReserve[a]`, zeroes
   `scaledDebt[debtAsset]` and the corresponding `totalScaledDebt`, and emits an auditable event.
   Gate it with a committed `minLiquidatableDebtUsdWad` floor so it cannot fire on economically
   meaningless positions.
3. **Add a liquidation-completeness invariant** to `11`: after a full-close liquidation,
   `borrower.scaledDebt[debtAsset] == 0`. This is the property that currently fails at dust, and it
   is trivially testable.
4. **Add `badDebtReserve[a]` to `reserveLeaf`** (SPEC-03) so socialized loss is committed and
   auditable, and extend `11`'s custody identity:
   `Custody[a] = Ledger[a] + badDebtReserve[a] + PendingInbound[a] + PendingOutbound[a]`.
5. **Record the interaction** in `32-V1-LIMITATIONS.md`: if SPEC-01 is not fixed, state explicitly
   that V1's liquidation path is on the hot path for every max-LTV borrower and that item (1) is
   therefore mandatory rather than a tuning choice.

---

### SPEC-05 — Liquidation collateral clamp has no profitability guard: underwater positions become unliquidatable · HIGH

**Affected components.** `12-COMPLETE-STATE-MACHINE.md:402-408,417-419,426-439`;
`11-ASSET-RESERVE-MODEL.md:182`; `32-V1-LIMITATIONS.md:28-29`.

**Mechanics.** `12:408` clamps the seizure:

```
collateralToWithdraw = min(borrower.collateral[collateralAsset], collateralWithBonus)
```

When a position is under-collateralized — precisely the state that makes liquidation necessary —
`borrower.collateral[collateralAsset] < collateralWithBonus`, so the clamp binds and the liquidator
receives **less value than they paid**. The spec then removes every escape:

- `12:417`: the liquidator must send "the **exact** prepared debt asset amount"; there is no option
  to reduce `paymentAmount` to match the collateral actually available.
- `12:419`: "After capture, the operation **cannot timeout or refund** through Noct."
- `12:444`: a retried commit returns the original result — the shortfall is permanent.

There is **no** assertion anywhere that the seizure covers the payment, no re-quote at commit, and
no mechanism to reduce the prepared payment when collateral is short. `11:182` names
"cross-asset liquidation failures or starvation" as a known risk area but specifies no control.

**Impact.** A rational liquidator will not bid on an underwater position, because the payoff is
negative by construction. `20`'s discovery path is permissionless but *execution* is voluntary, so
the protocol cannot compel anyone to absorb the loss. Underwater positions therefore sit
unliquidated, collateral value keeps falling, and the shortfall becomes bad debt — which `32:28-29`
confirms V1 does not handle. This is the standard liquidation death spiral, and V1 has no circuit
breaker: no treasury backstop purchase, no partial-close option, no auction, no forced write-off.

Compounding factors: `closeFactorWad = 50%` (SPEC-04) means a liquidator can recover at most half
the debt per cycle, so they must fund two cycles before exiting, each with independent shortfall
risk; and SPEC-01's zero buffer means positions cross into liquidation on tiny moves, so the
population of marginal — and therefore occasionally underwater — positions is large.

**Simulation.**

```
Borrower: collateral[ETH] = 0.5 ETH; currentDebt[USDC] = 2000 USDC
liquidationBonusWad[ETH] = 0.08e18 (10:65); closeFactorWad = 0.5e18 (10:57)

ETH crashes from 3000e18 to 2000e18 between discovery and the liquidator's decision.
  collateral USD = 0.5 * 2000 = $1000 ; debt = $2000  -> underwater by $1000

PREPARE at the crashed epoch (12:402-408), debtAsset=USDC, collateralAsset=ETH:
  maxPayment          = 1000 USDC (closeFactor 50%)
  paymentAmount       = 1000 USDC
  debtPaymentUsd      = mulDivUp(1000 USDC, 1e18, 1e18) = $1000-equivalent
  baseCollateralNeeded= mulDivUp($1000, WAD, 2000e18)   = 0.5 ETH-equivalent
  collateralWithBonus = mulDivUp(0.5 ETH, 1.08e18, WAD) = 0.54 ETH-equivalent
  collateralToWithdraw= min(0.5 ETH, 0.54 ETH) = 0.5 ETH     <- CLAMP BINDS

Liquidator pays 1000 USDC ($1000) and receives 0.5 ETH = $1000.
Net result: $0 return on a $1000 outlay, plus gas, plus custody/withdrawal cost,
plus the risk that ETH falls further before the withdrawal lands.

12:419 forbids timeout or refund after capture; 12:444 makes the shortfall permanent.
A rational liquidator does not bid. Position stays underwater and unliquidated.
Residual $0 shortfall today becomes real bad debt on the next tick (32:28-29).
```

Note the clamp is *guaranteed* to bind for any underwater position, so this is not a tail case — it
is the definition of the case liquidation exists to handle.

**Fix.**

1. **Make PREPARE fail rather than clamp.** Replace `12:408` with:
   ```
   REQUIRE borrower.collateral[collateralAsset] >= collateralWithBonus
   collateralToWithdraw = collateralWithBonus
   ```
   If collateral is insufficient for the requested payment, reject and require the liquidator to
   reduce `paymentAmount`. Every accepted liquidation is then profitable by construction at the
   quoted epoch.
2. **Add a protocol-defined maximum repayable amount for underwater positions:**
   ```
   maxRepayableAtCollateral = mulDivDown(
       mulDivDown(borrower.collateral[collateralAsset], collateralPrice,
                  10**decimals[collateralAsset]),
       WAD, WAD + liquidationBonusWad[collateralAsset])
   maxPayment = min(currentDebt, closeLimit, maxRepayableAtCollateral)
   ```
   This lets a liquidator close the position *up to the value of available collateral* at a profit,
   and leaves the residual as explicit bad debt instead of an untradeable position.
3. **Specify the residual write-off transition** referenced by `12:392` (SPEC-04 item 2), so the
   remainder after a max-repayable liquidation moves into `badDebtReserve[a]`, is committed in
   `reserveLeaf`, and emits an auditable event.
4. **Add a re-quote guard at COMMIT** bounded by committed `maxQuoteIndexDriftRay` and a maximum
   price deviation, so an unbounded PREPARE→COMMIT delay cannot be arbitraged (SPEC-07).
5. **Add tests** to `29-TESTING-STRATEGY.md` for: underwater position with
   `collateral < collateralWithBonus` (must reject, or use `maxRepayableAtCollateral`); the
   exact-equality boundary; and all six `(debtAsset, collateralAsset)` orderings.

---

### SPEC-06 — PREPARE_REPAY debt lock is a free, renewable, permissionless liquidation block · HIGH

**Affected components.** `12-COMPLETE-STATE-MACHINE.md:288-309,318`;
`08-NOCTSTATE-V1.md:121-136`; `09-STATE-COMMITMENT-MODEL.md:55,78-84`; `20-LIQUIDATION-DISCOVERY.md`.

**Mechanics.** Preparing a repayment installs an exclusive debt lock with no payment required:

> "While it is active, **no borrow, repayment, or liquidation may mutate that account's scaled debt
> for the selected asset**."  (`12:305`)
>
> "Atomic effects: create `PREPARED` operation, **install the debt lock**, increment the user nonce
> and state version. **Debt and reserve liquidity are unchanged.**"  (`12:307`)
>
> "The pre-payment lock may expire after the configured TTL."  (`12:309`)

PREPARE_REPAY is an ordinary user transition. Nothing requires the user to hold the repayment asset,
post a bond, or pay a fee — `12:307` explicitly confirms no economic effect occurs. The only amount
constraints are `requestedAmount < currentDebt` (`12:299`) and `scaledDebtReduction > 0` (`12:302`),
both satisfiable with a single unit of an 18-decimal debt asset whenever `index == RAY`.

A borrower can therefore: (1) call PREPARE_REPAY with a minimal `requestedAmount`, installing the
lock; (2) never send the payment; (3) wait for TTL expiry (`12:309`), then immediately re-PREPARE.

Because the liquidation path must go through PREPARE_LIQUIDATION, which "exclusively locks that
scaled-debt slice" (`12:411`), and the borrower's lock is already installed, **the liquidator cannot
prepare at all**. The borrower can always install first: they need not wait for a price move, they
pay nothing, and they can hold the lock continuously. There is no lock-count cap, no cooldown, no
preemption by a liquidator, and no cost asymmetry between the parties.

**Impact.** Any borrower can make themselves **permanently unliquidatable at zero cost**, for any
asset they choose, indefinitely. Combined with SPEC-01 (zero buffer, so liquidation is the only
solvency mechanism) and SPEC-04/05 (liquidation already fragile), this is a direct route to
unbounded bad debt: borrow to the maximum, install a rolling repay lock, walk away while collateral
falls. `32:28-29` confirms nothing absorbs the shortfall.

The asymmetry is the root defect: the lock exists to make settlement safe for a borrower who is
*actively repaying*, but it is granted to anyone who merely *announces an intention* to repay.

**Simulation.**

```
Attacker: deposits 1 ETH, borrows 2400 USDC (max LTV under File 10 config).
ETH falls 30% -> healthFactor < 1.0 -> liquidatable (12:336-350).

Keeper discovers the position (20) and attempts PREPARE_LIQUIDATION(debtAsset=USDC, collateral=ETH).
  12:411 requires an exclusive lock on borrower.scaledDebt[USDC]
  attacker already holds debtLockUSDC from a PREPARE_REPAY
  -> PREPARE_LIQUIDATION REJECTED

Attacker loop (cost: one guest transition per TTL, no tokens, no fee):
  while true:
      if debtLockUSDC absent or (expiresAt - now) < 60s:
          PREPARE_REPAY(requestedAmount = 1 unit USDC)   # satisfies 12:299 and 12:302
      sleep(TTL / 2)          # never sends payment; lock expires per 12:309

Position stays liquidatable in theory and unliquidatable in practice, forever.
Debt accrues (19:27-32); collateral value falls; bad debt accumulates with no
V1 mechanism to absorb it (32:28-29).
```

**Fix.**

1. **Do not let an unfunded lock block liquidation.** Narrow `12:305` to:
   > "While a `PREPARED` repayment operation is active, no borrow or additional repayment may mutate
   > that account's scaled debt for the selected asset. **A PREPARE_LIQUIDATION for the same asset
   > preempts an uncaptured repayment lock**: the repayment operation is marked `EXPIRED`, its lock
   > released, and the liquidation proceeds in the same transition."

   This preserves the lock's real purpose (preventing concurrent debt mutation during settlement)
   while removing its use as a shield. Preemption before capture is safe because `12:309` already
   establishes that an uncaptured operation "does not refund anything because no payment has been
   captured."
2. **Never preempt after capture.** Keep `12:318` ("the operation and lock MUST NOT expire") for
   `PAYMENT_CAPTURED` operations — real funds are then in `PendingInbound` and preemption would
   strand them. The preemption right applies only to `PREPARED`.
3. **Make repeated unfunded preparation costly.** Add committed parameters to `10` and
   `configCommitment`: `maxUnfundedPreparations` (1 per account per asset),
   `preparationCooldownSeconds` (>= TTL), and a rule that an account whose previous repayment
   operation expired uncaptured cannot prepare another until the cooldown elapses. Persist the
   counter in the account leaf (SPEC-03) so it is committed.
4. **Cap the TTL.** Freeze `repayPreparationTtlSeconds` in `10`, and require
   `repayPreparationTtlSeconds <= 2 * maxLiquidationLatencySeconds`, so a lock can never outlast the
   window in which liquidation matters.
5. **Add a test**: position liquidatable, borrower holds a rolling `PREPARED` repayment lock; assert
   `PREPARE_LIQUIDATION` succeeds and the repayment operation transitions to `EXPIRED`.

---

### SPEC-07 — Stale quote at COMMIT with no index-drift bound: free debt cancellation · HIGH

**Affected components.** `12-COMPLETE-STATE-MACHINE.md:288-302,305,318-320,338,394,411,419`;
`19-INTEREST-ACCRUAL.md:27-32,88-90,143-146`; `10-PROTOCOL-CONFIGURATION.md:180,186-220`.

**Mechanics.** PREPARE_REPAY quotes the debt reduction against the index at preparation time:

```
scaledDebtReduction = mulDivDown(requestedAmount, RAY, currentIndex[asset])     (12:301)
```

and COMMIT applies that stored quantity regardless of how the index has since moved:

> "The commit uses the prepared scaled quantity **even if the reserve index has since increased**;
> the payment receipt proves the exact quote was captured."  (`12:338`)

Let `I0` be the index at PREPARE and `I1 >= I0` at COMMIT (`19:88-90` guarantees monotonicity). The
borrower pays `P` and scaled debt falls by `mulDivDown(P, RAY, I0)`. Their **actual** debt reduction,
measured at `I1`, is:

```
deltaDebt = mulDivUp(mulDivDown(P, RAY, I0), I1, RAY)  ~=  P * I1 / I0  >=  P
```

So the borrower extinguishes `P * I1/I0` of debt for a payment of `P`, extracting
`(I1/I0 - 1) * P` of **free debt cancellation** at the reserve's expense. The longer PREPARE→COMMIT
takes, the larger the gain — and `12:318-320` removes the only bound: once captured, "the operation
and lock **MUST NOT expire**", "Noct **MUST NOT** issue a timeout refund", and "`COMMIT_REPAY` is
retried until successful." No document imposes a maximum drift, a maximum elapsed time, or a
re-quote.

The same construction in the liquidation direction (`12:394,411,426`) transfers value the other way:
the stored `scaledDebtReduction` and `oracleEpoch` are fixed at PREPARE, so index growth between
PREPARE and COMMIT cancels more debt than the payment justifies — at the *borrower's* expense, with
the seized collateral also quoted at the stale epoch.

**Impact.** `12:324` and `12:423` restrict COMMIT to "authenticated TRUSTPROCESS processing", so an
attacker cannot invoke commit directly; the window is bounded in practice by the preparation TTL
(`12:309`) plus finality plus keeper latency. That makes this bounded leakage rather than an open
drain — hence HIGH, not CRITICAL. It escalates in two situations the spec does not rule out:
(a) if the keeper pipeline stalls after capture, the delay is unbounded because `12:318` forbids
expiry; (b) a borrower who controls *when* their payment is captured — by choosing when to send it
within the TTL — captures a predictable share of the drift.

Because `11` requires exact reserve conservation, this leakage also silently breaks the
`Custody = Ledger + PendingInbound + PendingOutbound` reconciliation that `10:181-184` mandates —
and it does so *invisibly*, since the ledger reduction is internally consistent.

**Simulation.**

```
PREPARE at I0 = 1.000000000e27, requestedAmount P = 1000 USDC
  scaledDebtReduction = mulDivDown(1000e6, 1e27, 1.0e27) = 1000e6

Keeper pipeline stalls 30 days. Accrual advances the index to I1 = 1.00164e27 (2% APR).

COMMIT (12:329-331, 12:338):
  account.scaledDebt[USDC]   -= 1000e6
  reserve.totalScaledDebt    -= 1000e6
  reserve.availableLiquidity += 1000e6        # only what was actually paid

Actual debt extinguished = mulDivUp(1000e6, 1.00164e27, 1e27) = 1001.64 USDC
Borrower paid            = 1000.00 USDC
Free cancellation        =     1.64 USDC   (0.164% of the payment)

Applied across a $50M annual repayment book with similar delays, the reserve
under-collects by six figures, and no invariant flags it: 11's reconciliation
compares custody against the ledger, and the ledger was reduced "correctly".
```

**Fix.**

1. **Bound the drift at COMMIT.** Add committed parameters to `10` and `configCommitment`:
   `maxQuoteIndexDriftRay` and `maxQuoteAgeSeconds`. Then in `12:338` and `12:426`:
   ```
   REQUIRE currentIndex[asset] <= mulDivDown(operation.quoteBorrowIndexRay,
                                             WAD + maxQuoteIndexDriftRay, WAD)
   REQUIRE OracleState.AdapterBlockTimestamp - operation.createdAt <= maxQuoteAgeSeconds
   ```
   `quoteBorrowIndexRay` is already committed in the operation leaf (`09:79`), so no new state is
   needed.
2. **Define a bounded-staleness remedy** instead of a hard failure that would strand captured funds
   (which `12:318-320` forbids). When drift exceeds the bound after capture, re-derive the reduction
   conservatively against the payer:
   ```
   COMMIT_REPAY: scaledDebtReduction = min(operation.scaledDebtReduction,
                                           mulDivDown(operation.paymentAmount, RAY, currentIndex))
   ```
   For liquidation, symmetrically recompute `collateralToWithdraw` at the current index and re-check
   the SPEC-05 conservation assertion. Record the adjustment as an auditable delta in
   `outcomeCommitment` (`09:112`).
3. **Add commit liveness monitoring.** Since `12:318` forbids expiry after capture, require that a
   captured-but-uncommitted operation older than `maxCommitLatencySeconds` raises an operator alert
   rather than being retried silently forever. Note that no monitoring/incident-response document
   exists in the corrected set (see SPEC-09), so this control currently has no home.
4. **Extend `11`'s reconciliation** to compare `totalScaledDebt` deltas against captured payment
   amounts *at the same index*, so drift-induced divergence is detectable.
5. **Add tests**: prepare at `I0`; advance the index by exactly `maxQuoteIndexDriftRay` and commit
   (must succeed); advance one unit further and commit (must apply the conservative re-derivation and
   must never strand the receipt).

---

### SPEC-08 — `maxRiskDelaySeconds` is unfrozen and absent from `configCommitment` · HIGH

**Affected components.** `18-ORACLE-ARCHITECTURE.md:126,178`; `20-LIQUIDATION-DISCOVERY.md:40`;
`30-END-TO-END-ARCHITECTURE.md:101`; `28-BENCHMARKING-PLAN.md:135`;
`10-PROTOCOL-CONFIGURATION.md:83-84,186-220`; `09-STATE-COMMITMENT-MODEL.md:82,130`.

**Mechanics.** `maxRiskDelaySeconds` is the single freshness bound protecting every risk-sensitive
transition:

- `18:126` — `NoctTrigger` "requires `block.timestamp - adapterBlockTimestamp <= maxRiskDelaySeconds`"
- `18:178` — a risk intent is rejected when "the adapter snapshot exceeds on-chain
  `maxRiskDelaySeconds`"
- `20:40` — the discovery path repeats the same inequality
- `30:101` — "`NoctTrigger` checks `block.timestamp - adapterBlockTimestamp <= maxRiskDelaySeconds`
  on chain. The guest has **no independent authenticated clock** and performs **no self-freshness
  claim**"

`30:101` is the critical sentence: the guest deliberately delegates *all* freshness assurance to
this one on-chain parameter because it has no clock of its own (`18:163`). It is load-bearing for the
entire risk path.

Yet `maxRiskDelaySeconds` **does not appear in `10-PROTOCOL-CONFIGURATION.md` at all** — not in the
frozen parameter tables, not in the bounds section (`10:83-84`), and not in the `configCommitment`
preimage (`10:186-220`). Verified by full-text search across the corrected set: the only occurrences
are `18:126,178`, `20:40`, `28:135` and `30:101`, all of which *use* it and none of which *define* it.

**Impact.**

1. **No frozen value.** There is no audited, reviewable number. An implementer must invent one, and
   independent implementations of `NoctTrigger` and the guest could reasonably disagree.
2. **Not committed.** Absent from the `configCommitment` preimage, changing it produces **no
   detectable change in `appRoot`**. Every operation leaf commits `configCommitment` (`09:82`), so the
   entire replay-and-commitment defense (`23`) is blind to this parameter. An operator who widens it
   from 60 s to 6 h — letting liquidations execute on six-hour-old prices — commits no observable
   state change and trips no invariant.
3. **Two homes, one control.** `18`/`20`/`30` treat it as an on-chain `NoctTrigger` parameter, while
   `10` is the frozen protocol configuration and `09:130` commits `configCommitment` into
   `GlobalRootStateV1`. A parameter enforced on-chain but configured off-book cannot be proven
   consistent with the guest's view. A guest assuming 60 s and a trigger configured for 1 h would
   disagree silently, and `30:101`'s "performs no self-freshness claim" means nothing would catch it.
4. **It is the only defense against stale-price liquidation.** With SPEC-01's zero buffer, positions
   sit exactly at the solvency boundary, so a stale snapshot means collateral is seized at prices that
   no longer reflect reality — over-seizing from borrowers who have recovered, or under-compensating
   liquidators after a further fall.

**Fix.**

1. **Freeze the value in `10-PROTOCOL-CONFIGURATION.md`** beside the other oracle parameters, with an
   explicit derivation:
   ```
   maxRiskDelaySeconds = 60
   # MUST satisfy:
   #   >= expected Pyth update interval on the target chain + max NoctTrigger coupling latency
   #   <= the price-move window the SPEC-01 liquidation buffer can absorb
   ```
   Justify it against `maxAccrualChunkSeconds` (`19:143`) and the liquidation buffer, since the buffer
   must absorb the worst-case move over `maxRiskDelaySeconds`.
2. **Add it to the `configCommitment` preimage** (`10:186-220`) and to `oracleCommitment`, so any
   change is reflected in `appRoot` and bound into every operation leaf (`09:82`).
3. **Store it in guest state at deploy and assert equality** with the value `NoctTrigger` reports in
   the authenticated risk delivery. This upgrades `30:101`'s blind delegation into a *consistency
   check*: the guest still cannot read a clock, but it can verify that the on-chain bound matches the
   committed configuration and reject the delivery otherwise. Add to `18`'s validation list:
   ```
   11. the delivered maxRiskDelaySeconds equals the value committed in configCommitment.
   ```
4. **Add bounds validation** in the style of `10:83-84`:
   ```
   ASSERT 0 < maxRiskDelaySeconds <= 300
   ASSERT maxRiskDelaySeconds <= minLiquidationBufferSeconds
   ```
5. **Implement the rejection-boundary benchmark** `28:135` already lists as pending, plus a test in
   `29` asserting a snapshot at exactly `maxRiskDelaySeconds` is accepted and one second older is
   rejected.

---

### SPEC-09 — No governance, pause or upgrade model; two cited architecture files do not exist · HIGH

**Affected components.** `24-PRIVACY-LEAKAGE-ANALYSIS.md` (1,081 B), `25-THREAT-MODEL.md` (1,128 B),
`26-SECURITY-MODEL.md` (1,128 B), `31-DEPLOYMENT-ARCHITECTURE.md` (948 B) — all stubs;
`IMPLEMENTATION_GUIDE.md:69-70`; `10-PROTOCOL-CONFIGURATION.md`;
`09-STATE-COMMITMENT-MODEL.md:116-139`; `12-COMPLETE-STATE-MACHINE.md` (T01–T12);
`22-FAILURE-RECOVERY.md`; `23-REPLAY-PROTECTION.md:233`.

**Mechanics.** The corrected set freezes detailed economics, commitments, oracles and settlement —
and then has no answer for who may change any of it, or how to stop it.

`IMPLEMENTATION_GUIDE.md` points at exactly those documents:

```
69: - **31-GOVERNANCE-MODEL.md** — parameter updates, emergency pause, upgrade authority
70: - **32-COMPLIANCE-ARCHITECTURE.md** — `DEANONYMIZATION`, AuthorityRegistry, scoped encrypted reports
```

**Neither file exists.** The actual Files 31 and 32 are `31-DEPLOYMENT-ARCHITECTURE.md` (a 948-byte
stub) and `32-V1-LIMITATIONS.md`; File 33 is `33-FUTURE-EXTENSIONS.md`. The guide references a
document set that was renumbered or never written, and the two subjects it defers — governance and
compliance — are consequently **unspecified anywhere in the repository**. This matters directly for
DEMO-03, because `32-COMPLIANCE-ARCHITECTURE.md` was supposed to define the `AuthorityRegistry` that
gates deanonymization.

Across the whole corrected set there is:

- **No pause or circuit-breaker transition.** `12` enumerates T01–T12 and none halts borrowing,
  liquidation or withdrawal. With SPEC-01 (zero buffer), SPEC-02 (unit confusion) and SPEC-05
  (unliquidatable positions) all live, there is no specified way to stop the protocol once a defect is
  observed in production.
- **No parameter-change authority.** `10` freezes values and commits them, but nothing states who may
  produce a new `configCommitment`, under what timelock, or how such a transition is authenticated.
  `09:139` freezes `velaApplicationID` and `chainID` at deploy and requires every call to match — a
  good *identity* control that says nothing about *configuration* authority.
- **No upgrade or migration path.** `09:116` requires global-root proofs to serialize "this exact V1
  structure and no other version", and `09:120` fixes `schemaVersion = 1`. SPEC-03's fix necessarily
  changes the leaf preimage and bumps `schemaVersion`, yet no document says how a live deployment
  migrates state between schema versions, who authorizes it, or how in-flight `PAYMENT_CAPTURED`
  operations — which `12:318` says must never expire — survive the migration.
- **No admin-key or multisig model**, and no statement of whether Noct operators can invoke
  transitions that mutate user balances. `12:324,423` restrict COMMIT to "authenticated TRUSTPROCESS
  processing", implying an operator-controlled path exists, but its authority boundary is undefined.
- **No emergency procedure with teeth.** `22-FAILURE-RECOVERY.md` covers state recovery, but `23:233`
  simultaneously forbids the obvious operator response — "Monitoring MUST NOT 'repair' the system by
  replaying deposits into a newly initialized ledger" — without saying what to do instead.

**Impact.** A protocol with no pause cannot contain an active exploit. A protocol with no defined
configuration authority either cannot be governed at all (parameters frozen forever, including any
wrong value such as SPEC-01's collapsed gates) or is governed by an undocumented key — an
unauditable centralization risk that belongs in `25-THREAT-MODEL.md` and does not appear there,
because that file is 1,128 bytes. A protocol with no migration path cannot fix SPEC-01 through
SPEC-05 without abandoning state, and `23:233` forbids the only recovery method the documents mention.

For a design whose central claim is that a TEE plus commitments plus proofs *replaces* on-chain
contract trust, the absence of a governance and upgrade model means the operator trust assumption is
**unstated rather than eliminated**. `26-SECURITY-MODEL.md` is cited in SPEC-03 as resting V1's
integrity argument on commitment-plus-proof; at 1,128 bytes it does not develop that argument, and
SPEC-03 shows the argument does not hold as written.

**Fix.**

1. **Write the two missing documents** (`31-GOVERNANCE-MODEL.md`, `32-COMPLIANCE-ARCHITECTURE.md`) or
   correct `IMPLEMENTATION_GUIDE.md:69-70` to point at files that exist. Either way a governance model
   and a compliance/authority model are required; the latter is a prerequisite for fixing DEMO-03.
2. **Add `PAUSE` / `RESUME` transitions to `12`** with a committed authority set and per-scope
   granularity, so borrowing can be halted without freezing withdrawals:
   ```
   PauseScope = { BORROW, LIQUIDATION, WITHDRAW_BORROWED, SUPPLY, UNSUPPLY, DEPOSIT }
   pausedScopes bitmap        # committed in GlobalRootStateV1 and in configCommitment
   every transition in 12 begins: REQUIRE (pausedScopes & scopeOf(transition)) == 0
   ```
   **Withdrawal of already-owned `cash[a]` and `borrowed[a]` MUST NOT be pausable**, or pause becomes
   a custody-confiscation power. Repayment and liquidation CAPTURE must likewise remain unpausable,
   since `12:318-320` guarantees captured funds cannot be stranded.
3. **Specify configuration authority in `10`.** A new `configCommitment` may be produced only by a
   transition carrying a quorum-authenticated governance directive, with a committed
   `configTimelockSeconds` between announcement and effect, and with the *pending* commitment stored
   in state so users can exit before it applies. Changes that reduce safety (`collateralFactorWad`
   down, `closeFactorWad` down, `maxRiskDelaySeconds` up, `liquidationThresholdWad` down) MUST use a
   longer timelock.
4. **Specify migration.** Define `MIGRATE_STATE` from `schemaVersion N` to `N+1`: who authorizes it,
   how `appRoot` continuity is proven across the boundary, and the rule that all `PAYMENT_CAPTURED`
   operations must be committed or explicitly carried forward before migration proceeds.
5. **Expand `24`, `25` and `26` from stubs into real documents**, enumerating at minimum: the Noct
   operator as an adversary (precisely what TRUSTPROCESS may invoke), the keeper as an adversary, the
   oracle operator as an adversary, and the enclave-compromise case that SPEC-03's commitment gap
   leaves undefended.
6. **State the operator trust assumption plainly** in `01-EXECUTIVE-SUMMARY.md` and
   `32-V1-LIMITATIONS.md`. Users must be able to determine whether Noct can move their funds; today no
   document answers that.

---

### SPEC-10 — The pinned SDK cannot express V1's mandated arithmetic; `TOOLCHAIN-LOCK.md` is entirely TODO · MEDIUM (blocking)

**Affected components.** `TOOLCHAIN-LOCK.md` (all 17 rows `TODO`); `noct-demo-wasm/go.mod`;
`vela-common-go v0.2.0/wasm/types/{uint256.go,helpers.go,common.go}`; every `mulDivDown`/`mulDivUp`
call site in `08`, `10`, `11`, `12`, `19`; `23-REPLAY-PROTECTION.md:16`.

**Mechanics.** Five frozen documents specify the protocol's arithmetic exclusively through two
primitives, `mulDivDown(a, b, den)` and `mulDivUp(a, b, den)`. They appear in `08:74-81` (debt
derivation), `10:103-118` (health factor, USD weighting), `11:144-149` (reserve accounting),
`12:101-127,301,386-408` (borrow gate, repayment rescale, close factor, cross-asset conversion) and
`19:27-41,88-90` (index accrual). **Every economic quantity in V1 passes through them.**

Verified directly against the pinned module in the local cache
(`C:\Users\Hi\go\pkg\mod\github.com\!horizen!official\vela-common-go@v0.2.0`), the complete public
arithmetic surface of `types.Uint256` is:

```
Add, AddOverflow, Add64, Add64Overflow          uint256.go:81,91,325,330
Sub, SubOverflow                                uint256.go:101,111
Mul64, Mul64Overflow                            uint256.go:305,310
Cmp, Eq, IsZero                                 uint256.go:125,141,146
SetBytes, Bytes, SetHex, ToHex, String          uint256.go:33,58,69,191,151
MarshalJSON, UnmarshalJSON                      uint256.go:219,225
divModWord(divisor uint64)                      uint256.go:174   <- UNEXPORTED
```

Four blocking gaps follow:

1. **No U256 × U256 multiplication.** The only multiply is `Mul64(y uint64)`. `mulDivDown` requires a
   256×256→512-bit intermediate, which cannot be formed.
2. **No public division of any kind.** The sole division helper, `divModWord`, is unexported and takes
   a `uint64` divisor. A guest cannot divide a `Uint256` by a `Uint256` at all — so `mulDivDown`'s
   final `/ den` step is unreachable even if a wide product could be built.
3. **WAD-scaled prices cannot be passed to `Mul64`.** `12:402` needs
   `mulDivUp(paymentAmount, debtPrice, WAD)` where `debtPrice` is an 18-decimal WAD price. Any token
   above roughly $18.45 has a WAD price exceeding `2^64`, so it does not fit the `uint64` parameter.
   **The frozen liquidation formula is not merely imprecise — it is not expressible.**
4. **`Mul64` silently truncates.** Source-verified at `uint256.go:304-307`:
   ```go
   // Mul64 sets z = z * y (mod 2^256).
   func (z *Uint256) Mul64(y uint64) {
       _ = z.Mul64Overflow(y)
   }
   ```
   The overflow flag is computed and then explicitly discarded. A wrapped product is indistinguishable
   from a correct one. This is the precise enabler of DEMO-01.

Separately, `23:16` and `12:173,181-183,469` require a "deterministic withdrawal ID" for replay
protection, but `types.Withdrawal` (`common.go:22-26`) has exactly three fields — `TokenAddress`,
`DestinationAddress`, `Amount` — and **no ID**. The withdrawal-ID replay domain cannot be implemented
against the host type. `helpers.go` offers only `SerializeAndWriteResult`, `PtrToUint256` and
`PtrToAddress`; it provides no math.

Meanwhile `TOOLCHAIN-LOCK.md` — the document that exists specifically to make the build reproducible
and to satisfy `09:116`'s "this exact V1 structure and no other version" determinism requirement —
has **all 17 rows set to `TODO`**, including Vela core, Vela Nova, TinyGo, Wasmtime-go, Noir,
Barretenberg, zkVerifyJS and the UltraHonk verifier. Its own CI rule ("CI must print the exact
versions/commits before build and test") therefore cannot be satisfied. `noct-demo-wasm/go.mod`
declares `go 1.24.0` while the lock table records "1.24.0 / toolchain 1.24.3 observed" with no exact
value.

**Impact.** Rated MEDIUM only because no funds are at risk *today* — the affected code does not yet
exist. It is nonetheless a **hard blocking dependency**: V1's mandated arithmetic is unimplementable
with V1's pinned dependency. Either the SDK must be extended/upgraded or a correct, audited
wide-arithmetic library must be vendored. Until that decision is made every formula in Files 08, 10,
11, 12 and 19 is unbuildable, and any implementation that proceeds with `Mul64` will reproduce
DEMO-01 by construction — not through developer error, but because the API is shaped that way.

**Fix.**

1. **Complete `TOOLCHAIN-LOCK.md`** with exact, hash-verified pins for every row, commit `go.sum`, and
   make CI fail if any row still reads `TODO`.
2. **Vendor a checked wide-arithmetic package**; do not use `Mul64` for economic math:
   ```go
   func Mul512(a, b Uint256) (hi, lo Uint256)            // full 512-bit product
   func MulDivDown(a, b, den Uint256) (Uint256, error)   // error on den == 0 or 512-bit overflow
   func MulDivUp(a, b, den Uint256) (Uint256, error)
   func Div256(a, b Uint256) (Uint256, error)            // the missing public divide
   ```
   Implement over `[4]uint64` limbs with explicit carry propagation and **return an error on any
   overflow — never a wrapped value**. Property-test against `math/big` for randomized inputs and at
   every boundary (0, 1, 2^64-1, 2^128, 2^256-1, `den == 0`).
3. **Ban `Mul64` from economic paths** by lint rule; use `Mul64Overflow` elsewhere with the flag
   actually handled. Add a CI check for discarded-flag patterns such as `_ = .*Overflow(`.
4. **Resolve the withdrawal-ID gap explicitly.** Either extend the guest model to carry a
   `settlementID = H(operationID || assetID || destination || amount)` committed in `historyRoot` per
   `09:112`, documenting that `types.Withdrawal` carries no ID; or file an upstream SDK change. Then
   amend `23:16` to state which mechanism provides the guarantee, since the current text implies the
   host type carries it.
5. **Add an arithmetic conformance suite** to `29-TESTING-STRATEGY.md`: rounding direction at every
   `mulDivDown`/`mulDivUp` call site, behaviour at `U256` overflow, and a differential test against a
   `math/big` reference for the borrow gate, accrual and cross-asset conversion formulas.

---

### SPEC-11 — Two incompatible global-state structures: `GlobalState` vs `GlobalRootStateV1` · MEDIUM

**Affected components.** `08-NOCTSTATE-V1.md:158-168`; `09-STATE-COMMITMENT-MODEL.md:114-139`;
`23-REPLAY-PROTECTION.md:40-46`.

**Mechanics.** File 08 defines the global state as:

```
GlobalState {
    protocolVersion   uint64
    stateVersion      uint64
    configCommitment  [32]byte
    oracleCommitment  [32]byte
    positionRoot      [32]byte
    stateCommitment   [32]byte
}                                                   (08:161-168)
```

File 09 defines a different, incompatible structure and forbids any other:

```
GlobalRootStateV1 {
    schemaVersion uint64 = 1 ; protocolVersion ; stateVersion
    velaApplicationID int64 ; chainID uint64
    accountRoot ; reserveRoot ; pendingOperationRoot ;
    consumedReceiptRoot ; historyRoot              # five subroots
    configCommitment ; oracleCommitment
    latestOracleEpoch ; latestOracleTimestamp
}
appRoot = H(NOCT_APP_ROOT_V1 || canonicalSerialize(GlobalRootStateV1))   (09:119-136)
```

> "The canonical global-root preimage is `GlobalRootStateV1`; global-root proofs MUST serialize this
> exact V1 structure **and no other version**."  (`09:116`)

The two cannot both be canonical. They differ in root count (two opaque roots versus five named
subroots), in field names (`positionRoot`/`stateCommitment` versus `accountRoot`/`reserveRoot`/…), in
schema versioning (`08` has none; `09` has `schemaVersion uint64 = 1`), and in application identity
(`08` has **neither** `velaApplicationID` nor `chainID`).

**Impact.** `09:139` makes application identity a security control: "Deployment MUST freeze both
values in initial state and **every call MUST match them**", and `23:40-46` relies on this to reject
"a request for another deployment, chain, endpoint, protocol version, or schema". Under File 08's
`GlobalState` that defense is **structurally impossible** — there is no field to store or compare. An
implementer following File 08 would ship a deployment with no cross-application replay protection,
which is exactly DEMO-07.

It also breaks the ZK layer: a circuit written against `09:119-136` and a guest serializing
`08:161-168` produce different `appRoot` values from identical economic state, so proofs would fail —
or an implementation would silently pick one and the audit trail would not reveal which.

**Fix.**

1. **Delete `GlobalState` from `08:158-168`** and replace the section with a forward reference:
   "The global/public state is `GlobalRootStateV1`, defined normatively in
   `09-STATE-COMMITMENT-MODEL.md`. File 08 defines only account and reserve state."
2. If `positionRoot` and `stateCommitment` carry meaning distinct from `accountRoot` and `appRoot`,
   define them explicitly in `09` and state the relationship; otherwise remove the terms from the
   repository so they cannot be implemented by accident.
3. **Add a cross-document consistency check to CI**: extract every `H(NOCT_*_V1 || ...)` preimage and
   every top-level state struct from all documents and assert each is defined exactly once. SPEC-02,
   SPEC-03, SPEC-08 and SPEC-11 are all instances of one failure mode — a value defined in one
   document and contradicted or omitted in another — and a mechanical uniqueness check would have
   caught all four.

---

### SPEC-12 — `pendingOperationRoot` leaf cannot bind the (debtAsset, collateralAsset) pair · MEDIUM

**Affected components.** `09-STATE-COMMITMENT-MODEL.md:72-86`; `08-NOCTSTATE-V1.md:121-136,149-151`;
`12-COMPLETE-STATE-MACHINE.md:305,356,396-411,421-439`; `01-EXECUTIVE-SUMMARY.md:54`;
`32-V1-LIMITATIONS.md:13`.

**Mechanics.** Cross-asset liquidation is a headline V1 feature:

> "Cross-asset liquidations are supported (e.g., pay ETH debt, seize USDC collateral)."
> (`01:54`, repeated at `12:64` and `32:13`)

File 08 models it with two distinct fields:

```
debtAsset        AssetID   // asset being repaid/liquidated            (08:126)
collateralAsset  AssetID   // asset being seized (liquidation only)    (08:127)
```

and `12:411` requires both to be stored: "Preparation stores the accepted oracle epoch, **debtAsset,
collateralAsset**, payment amount, scaled reduction and collateral amount."

But the commitment leaf has a **single** `assetID`:

```
H(NOCT_PENDING_OPERATION_LEAF_V1 ||
  operationID || kind || status || initiator || account || assetID ||      (09:78)
  paymentAmount || scaledDebtReduction || quoteBorrowIndexRay ||
  collateralToWithdraw || destination || ...)
```

`12:305` confirms the single field is meant to be the *debt* asset ("binds account, **asset
(debtAsset)**, exact payment amount..."). So **`collateralAsset` is not committed.**

**Impact.** The committed operation binds a payment amount, a debt reduction and a
`collateralToWithdraw` quantity — but not *which token* that collateral quantity is denominated in.
At COMMIT, `12:429` subtracts from `borrower.collateral[collateralAsset]` and `12:435-439` emits
`Withdrawal{ TokenAddress: collateralAsset, Amount: collateralToWithdraw }`. If the guest's in-memory
`collateralAsset` differs from what was prepared — through a bug, a state-recovery path (`22`), or a
compromised enclave — the committed leaf still validates, because it never mentioned the collateral
asset. A liquidation prepared against ETH collateral could commit as a USDC withdrawal and produce an
identical `appRoot`.

This is the commitment-layer analogue of SPEC-02: the *quantity* is bound but the *asset dimension*
is not, so `09:86`'s assurance that the leaf "commits enough data to prevent substitution" does not
hold for the collateral asset. It also weakens `23`'s exact-operation-binding guarantee, since the
operation identity does not cover the operation's full economic effect.

**Fix.**

1. **Commit both assets** in `09:77-84`:
   ```
   H(NOCT_PENDING_OPERATION_LEAF_V2 ||
     operationID || kind || status || initiator || account ||
     debtAssetID || collateralAssetID ||
     paymentAmount || scaledDebtReduction || quoteBorrowIndexRay ||
     collateralToWithdraw || destination ||
     requestID || initiatorNonce || accountNonce ||
     configCommitment || oracleCommitment || oracleEpoch ||
     createdAt || expiresAt || capturedReceiptID)
   ```
   For `REPAY` operations set `collateralAssetID` to a canonical `NONE` encoding rather than
   duplicating `debtAssetID`, so the two operation kinds stay distinguishable.
2. **Bump the domain separator and `schemaVersion`** per SPEC-03, since the preimage changes.
3. **Add an explicit COMMIT-time assertion** to `12:423`, re-derived from the committed leaf rather
   than from mutable guest memory:
   `REQUIRE operation.debtAsset == storedDebtAsset && operation.collateralAsset == storedCollateralAsset`.
4. **Add a test** preparing a liquidation with `(debtAsset=ETH, collateralAsset=USDC)` and asserting
   that a commit attempt against any other pair fails the leaf check.

---

### SPEC-13 — `NOCTFINANCE_V1_ENGINEERING_REVIEW.md` is truncated mid-finding · LOW

The file is 1,947 bytes and ends with the literal line `**Recommendation:**` followed by nothing —
truncated mid-finding, after announcing three CRITICAL items. It is the only document in the
repository that reads as an independent engineering review, and it cannot be relied upon: two of its
three CRITICAL items are lost, and nothing records whether they were ever addressed. A reader treating
it as the review of record will believe findings were raised and resolved when they were merely cut
off.

**Fix.** Restore the complete document, or delete it and record in `README.md` that no prior review
exists. Do not leave a truncated review in a repository that will be handed to implementers.

### SPEC-14 — `novaw-linux.zip` is a 9-byte placeholder · LOW

The archive is 9 bytes and contains the literal text `Not Found`. It is referenced as the Vela Nova
tooling artifact, while `TOOLCHAIN-LOCK.md` lists "Vela Nova | selected commit | **TODO**". Any build
or deployment step expecting this archive will fail — or silently proceed without it.

**Fix.** Replace it with the real artifact or remove the reference; fill the corresponding
`TOOLCHAIN-LOCK.md` row (SPEC-10 item 1); and add a CI check that every referenced binary artifact is
non-empty and hash-verified.

---

## 3b. Demo findings — `noct-demo-wasm`

The demo is the **only executable protocol code in the repository**. Its complete source is
`main.go` (2,109 B), `app/lending.go` (8,818 B), `app/operations.go` (8,301 B), `app/state.go`
(2,103 B) and `app/helpers.go` (765 B), plus `test-client.ts`, `deploy.js` and `demo-tx.js`.
It exports four WASM entry points (`main.go:13-65`): `deploy`, `load_module`, `deposit` and
`process_request`. There is no `claim` or `withdraw` export; all value egress flows through
`ProcessResult.Withdrawals`.

Framing matters here. `README.md` presents this as a demo, and `operations.go:269` labels the
compliance report "simplified for demo". But it is also the artifact that `34-IMPLEMENTATION-ROADMAP.md`
and `IMPLEMENTATION_GUIDE.md` point implementers at, it is the only thing in the repository that can
be built and run, and it is what the architecture documents' claims are most likely to be validated
against. The findings below are therefore assessed on their own terms — as an exploitable lending
application — while noting where a defect is plausibly "demo simplification" versus where it is a
pattern that will survive into production because the surrounding architecture encourages it.

The single most important structural observation: **the demo implements none of the corrected
specification's core mechanisms.** Verified by full-text search across all demo sources, the
following terms appear **zero** times: `appRoot`, `scaledDebt`, `borrowIndex`, `reserve`,
`availableLiquidity`, `oracle`, `price`, `healthFactor`, `receipt`, `operationID`, `configCommitment`,
`stateVersion`, `mulDiv`. The demo is not a partial implementation of V1; it is a different protocol
that shares only its vocabulary.

---

### DEMO-01 — Unchecked `Mul64` in the solvency check: unlimited borrowing against zero collateral · CRITICAL

**Affected components.** `app/lending.go:106-115` (`ProcessBorrow`), `app/lending.go:232-243`
(`ProcessWithdraw`); `vela-common-go v0.2.0/wasm/types/uint256.go:304-307`.

**Mechanics.** The demo's *only* solvency check is:

```go
// Check collateralization: borrowed_amount * collateral_ratio <= collateral * 100
maxBorrow := *collateral
maxBorrow.Mul64(100)                                    // lending.go:107-108

requiredCollateral := newBorrow
requiredCollateral.Mul64(state.CollateralRatio)         // lending.go:110-111

if requiredCollateral.Cmp(maxBorrow) > 0 {              // lending.go:113
    return nil, nil, nil, fmt.Errorf("insufficient collateral: need %d%% ratio", state.CollateralRatio)
}
```

Both operands are multiplied with `Uint256.Mul64`, whose implementation is (source-verified,
`uint256.go:304-307`):

```go
// Mul64 sets z = z * y (mod 2^256).
func (z *Uint256) Mul64(y uint64) {
    _ = z.Mul64Overflow(y)
}
```

The overflow flag is computed and **explicitly discarded**. The product is therefore taken modulo
`2^256`, and a wrapped result is indistinguishable from a correct one. The check at `lending.go:113`
is a modular comparison, not a real-valued one.

An attacker who controls `newBorrow` controls the left-hand side of a modular inequality and can
choose it to wrap to any value — including zero. The `AddOverflow` guard at `lending.go:101-104` does
not help: `newBorrow` only needs to be below `2^256`, and `2^253` is.

`ProcessWithdraw` (`lending.go:234-238`) contains the identical pattern, so the same bypass also lets
an attacker drain collateral while holding a large recorded debt.

**Simulation.** With the deployed default `CollateralRatio = 200` (`operations.go:31-33`) and a fresh
account (`collateral = 0`, `currentBorrow = 0`):

```
attacker calls process_request{ operation: "BORROW", amount: "0x2000...0" }    // 2^253

lending.go:101  newBorrow = AddOverflow(0, 2^253) = 2^253 ; overflow = false    -> PASS
lending.go:108  maxBorrow          = 0 * 100       = 0
lending.go:111  requiredCollateral = 2^253 * 200 mod 2^256
                                   = 2^253 * (8 * 25) mod 2^256
                                   = 2^256 * 25     mod 2^256
                                   = 0
lending.go:113  0.Cmp(0) = 0 , NOT > 0                                          -> PASS

lending.go:118  account.BorrowedBalance = 2^253
lending.go:123  state.TotalBorrows = AddOverflow(prev, 2^253)   (flag DISCARDED; see DEMO-08)
lending.go:146  Withdrawal{ TokenAddress: 0x0, DestinationAddress: attacker, Amount: 2^253 }

RESULT: a zero-collateral account is authorized to withdraw 2^253 units.
```

Every guard the demo defines passes. The attack generalizes: the attacker does not need `2^253`
specifically — they need any `B` with `B * ratio ≡ 0 (mod 2^256)`, i.e. any multiple of
`2^256 / gcd(ratio, 2^256)`. For `ratio = 200 = 8 * 25` that is `2^253`; for `ratio = 256` it is
`2^248`. A deployer choosing a "rounder" ratio makes the attack cheaper, not harder.

A second, subtler consequence: after seeding `BorrowedBalance = 2^253`, a follow-up borrow of a
normal amount `x` gives `requiredCollateral = (2^253 + x) * 200 mod 2^256 = 200x`, so the check
degenerates to `200x <= 100 * collateral`, i.e. `x <= collateral/2`. The configured 200% requirement
silently becomes a **50% LTV** test for that account, permanently.

**Fix.** Use the checked variant and reject on overflow. The demo already ships correct helpers in
`app/helpers.go:18-29` (`AddUint256`/`SubUint256` return the flags) — verified by search, **they are
never called anywhere**; every call site uses the raw discarding form instead.

```go
// app/lending.go:106-115 replacement (ProcessBorrow)
// Check collateralization: newBorrow * ratio <= collateral * 100, rejecting overflow.
maxBorrow := *collateral
if maxBorrow.Mul64Overflow(100) {
    return nil, nil, nil, fmt.Errorf("collateral value overflow")
}

requiredCollateral := newBorrow
if requiredCollateral.Mul64Overflow(state.CollateralRatio) {
    return nil, nil, nil, fmt.Errorf("required collateral overflow")
}

if requiredCollateral.Cmp(maxBorrow) > 0 {
    return nil, nil, nil, fmt.Errorf("insufficient collateral: need %d%% ratio", state.CollateralRatio)
}
```

Apply the identical change at `app/lending.go:234-238` (`ProcessWithdraw`).

Beyond the local patch, three structural controls are needed because this class will recur:

1. **Ban `Mul64` repo-wide** in favour of `Mul64Overflow`, enforced by a lint rule and a CI grep for
   `_ = .*Overflow(` and bare `.Mul64(`. See SPEC-10.
2. **Bound the ratio at deploy.** `operations.go:31-33` only maps `0 -> 200` and otherwise accepts any
   `uint64`. Require `100 <= CollateralRatio <= 10_000` and reject the deploy otherwise, so the
   product `newBorrow * ratio` cannot wrap for any realistic balance.
3. **Add the invariant test that catches this class**: for every operation, assert in `math/big` that
   `postCollateral * 100 >= postBorrow * CollateralRatio` over randomized inputs including values near
   `2^256`. One property test over the borrow gate would have found DEMO-01 immediately.

---

### DEMO-02 — `REPAY` cancels debt from an unauthenticated JSON field: free debt erasure · CRITICAL

**Affected components.** `app/lending.go:157-207` (`ProcessRepay`); `app/operations.go:174-190`;
`app/main.go:50-65` (`process_request` export).

**Mechanics.** `ProcessRepay` reduces the borrower's debt using only the amount from the request
payload:

```go
func ProcessRepay(state *NoctState, sender *types.Address, token *types.Address,
                  repayAmount *types.Uint256) (*NoctState, []types.PlainEvent, error) {
    account := state.GetOrCreateAccount(sender)                        // lending.go:161
    currentBorrow, err := ParseUint256(account.BorrowedBalance)        // lending.go:163
    ...
    if repayAmount.Cmp(*currentBorrow) > 0 {                           // lending.go:169
        return nil, nil, fmt.Errorf("repayment exceeds debt")
    }
    ...
    account.BorrowedBalance = newBorrow.ToHex()                        // lending.go:180
```

`repayAmount` originates in `OperationRequest.Amount`, a plain JSON string field parsed at
`operations.go:175` from `payloadJSON`, which is `utils.PtrToString(payloadPtr, payloadLen)` at
`main.go:57` — the raw request body. There is **no receipt, no balance deduction, no escrow reference
and no token movement anywhere in the function**.

The dispatch site states the assumption but never enforces it:

```go
// Repay needs the deposit to have been processed first       operations.go:188
zeroAddr := types.Address{}                                   // operations.go:189
newState, events, err = ProcessRepay(state, sender, &zeroAddr, amount)   // operations.go:190
```

That is a comment, not a check. `token` is passed as the zero address and `ProcessRepay` never reads
it. The only receipt-authenticated entry point in the whole application is the `deposit` export
(`main.go:32-48` → `operations.go:62-107`), and the repay path never touches it.

This violates the corrected specification's most emphatic rule:

> "A user request is not proof of payment, and debt MUST NOT decrease before an authenticated inbound
> payment receipt is captured and consumed."  (`12:64`)
>
> "Debt MUST NOT be reduced merely because a user requested, approved, or prepared a repayment."
> (`11:75`)

**Second defect: the payment vanishes.** Even reading the demo charitably — that the host moves tokens
because `test-client.ts:140-144` passes `assetAmount` on the Vela call — `ProcessRepay` never credits
anything:

- `lending.go:183-186`: `state.TotalBorrows` is **decreased** by `repayAmount`.
- `state.TotalDeposits` is **untouched**. No `cash`, no `collateral`, no reserve liquidity, no
  `PendingInbound` — the demo has none of these.

Tokens leave the user's wallet and are recorded nowhere in the ledger. `11:34-38`'s conservation
identity `Custody[a] = Ledger[a] + PendingInbound[a] + PendingOutbound[a]` is violated outright, and
the demo has no reconciliation step (`10:181-184`) that could detect it.

**Simulation.**

```
1. attacker deposits 100 units            -> collateral = 100, TotalDeposits = 100
2. attacker borrows 50 (ratio 200: 50*200 = 10000 <= 100*100 = 10000, PASS)
                                           -> BorrowedBalance = 50, TotalBorrows = 50
                                           -> Withdrawal{ 0x0, attacker, 50 }    (lending.go:146)
   attacker now holds 50 units of withdrawn value AND 100 collateral.

3. attacker calls process_request{ operation: "REPAY", amount: "0x32" }   // 50
   operations.go:174  -> case OpRepay
   lending.go:169     -> 50.Cmp(50) = 0, NOT > 0                          -> PASS
   lending.go:180     -> BorrowedBalance = 0
   lending.go:185     -> TotalBorrows    = 0       (SubOverflow flag DISCARDED)
   NO receipt checked. NO token debited. NO balance credited.

4. attacker calls process_request{ operation: "WITHDRAW", amount: "0x64" } // 100
   lending.go:233     -> currentBorrow.IsZero() == true -> ratio check SKIPPED ENTIRELY
   lending.go:246     -> CollateralBalance = 0
   lending.go:274     -> Withdrawal{ 0x0, attacker, 100 }

Net: attacker deposited 100 and withdrew 50 + 100 = 150. Profit = 50 units,
     created from nothing, with every demo guard satisfied. Repeatable without limit.
```

Step 3→4 is the whole exploit: erasing debt unlocks the collateral, and `lending.go:233`'s
`if !currentBorrow.IsZero()` means a zero-debt account skips the solvency check on withdrawal
entirely. The loop is unbounded because step 1's deposit is returned in full at step 4.

**Fix.** Repayment must consume an authenticated receipt. In demo terms, the minimal correct shape:

```go
// operations.go: replace the OpRepay case so repayment is receipt-driven only.
case OpRepay:
    // Repayment is NOT a self-declared operation. It is completed by the deposit()
    // export, which is the only receipt-authenticated entry point.
    stateBytes, _ := state.Serialize()
    return types.ProcessResult{
        State:       stateBytes,
        Events:      []types.PlainEvent{},
        AppEvents:   []types.AppEvent{},
        Withdrawals: []types.Withdrawal{},
        Report:      nil,
        Fuel:        types.NewUint256(1000),
        Error: "REPAY must be performed by sending assets to the deposit endpoint with " +
               "purpose=REPAY; a self-declared repayment is not accepted",
    }
```

and extend `DepositFunds` (`operations.go:62-107`) to accept a purpose and route repayments:

```go
// New ProcessRepayFromReceipt, invoked only from the deposit() export:
//   1. verify the receipt is unconsumed and bound to this sender
//   2. repayAmount = receipt.Amount          <- NEVER the request payload
//   3. reduce BorrowedBalance by min(repayAmount, currentBorrow)
//   4. credit any excess to a real cash bucket (see DEMO-05); never discard it
//   5. mark the receipt CONSUMED and append its ID to a consumed-receipt set
```

Structural requirements, matching `12:64`, `11:75` and File 17:

1. **Remove `Amount` from the repay request type entirely.** If the field cannot be supplied it cannot
   be trusted; derive the amount from the receipt.
2. **Add the missing `cash` bucket** so a repayment or overpayment has somewhere to land, and credit
   the excess rather than dropping it. `lending.go:169` rejects overpayment today, which is safe only
   because nothing is credited at all.
3. **Track consumed receipt IDs** in `NoctState` and reject reuse, per `08:156` and `23:9-19`.
4. **Add a conservation assertion** at the end of every transition:
   `sum(collateral) + sum(cash) + sum(borrowed) + reserveLiquidity ==
   TotalDeposits + capturedInflow - emittedOutflow`. The demo has no post-transition check of any
   kind, which is why step 3 destroys value silently.
5. **Add a test** asserting that a `REPAY` request with no accompanying receipt changes no state and
   returns an error.

---

### DEMO-03 — `requestType == 2` dumps the entire private ledger to any caller · CRITICAL

**Affected components.** `app/operations.go:115-118,253-292`; `app/main.go:50-65`;
`20-LIQUIDATION-DISCOVERY.md:114-131`; `24-PRIVACY-LEAKAGE-ANALYSIS.md`; the missing
`32-COMPLIANCE-ARCHITECTURE.md` (SPEC-09).

**Mechanics.** The dispatch is unconditional:

```go
// Handle deanonymization (requestType = 2)
if requestType == 2 {                                                     // operations.go:116
    return handleDeanonymization(appId, sender, payloadJSON, stateJSON)    // operations.go:117
}
```

There is no authority check, no allowlist, no signature verification, no scope restriction, no nonce
binding and no audit event. `sender` is accepted and used only for a log line (`operations.go:254`).
The handler then serializes the complete private state:

```go
// Create compliance report (simplified for demo)                operations.go:269
report := map[string]interface{}{
    "app_id":         appId,
    "total_accounts": len(state.Accounts),
    "total_deposits": state.TotalDeposits,
    "total_borrows":  state.TotalBorrows,
    "accounts":       state.Accounts,                            // operations.go:275
}
reportBytes, _ := json.Marshal(report)                            // operations.go:278
...
Report: reportBytes,                                              // operations.go:288
```

`state.Accounts` is `map[string]*Account` (`state.go:11`), keyed by **address hex** (`state.go:61`,
`address.Hex()`), each value holding `CollateralBalance`, `BorrowedBalance` and `Nonce`
(`state.go:20-22`). The report is therefore a complete plaintext mapping of *every user address* to
*that user's exact collateral and debt*.

This is a total defeat of the product's central property. The corrected set is explicit about what
the route requires — an authority key, an `AuthorityRegistry` check, an explicit narrow scope, and
single-use nonce binding (`20:114-131`). **None of the four exists.** And the document that was
supposed to define `AuthorityRegistry` and "scoped encrypted reports" —
`32-COMPLIANCE-ARCHITECTURE.md`, cited at `IMPLEMENTATION_GUIDE.md:70` — **does not exist**
(SPEC-09), so there is no specification to implement against either.

Two aggravating details:

- **The report is plaintext at the guest boundary.** `ProcessResult.Report` is returned as raw bytes.
  Whether Vela encrypts or access-controls it downstream is a host property this repository never
  states, and `24-PRIVACY-LEAKAGE-ANALYSIS.md` — the document that would analyse exactly this — is a
  1,081-byte stub. A guest must not rely on an unstated host guarantee for its most sensitive output.
- **No audit trail.** `operations.go:285-286` returns `Events: []types.PlainEvent{}` and
  `AppEvents: []types.AppEvent{}`. A full-ledger disclosure produces **no event of any kind**, so it
  is invisible to monitoring and cannot be reconstructed afterwards. `23:214-219` requires
  deanonymization to be nonce-bound and auditable; neither holds.

**Simulation.**

```
Any externally-owned account — no role, no key, no deposit, no history — calls:

  process_request(appId, sender = attacker, requestType = 2, payload = "{}", state = <current>)

operations.go:116  requestType == 2            -> handleDeanonymization
operations.go:256  DeserializeState(stateJSON) -> full ledger
operations.go:275  "accounts": state.Accounts  -> every address -> balances
operations.go:288  Report: reportBytes         -> returned to the caller

Response body, in plaintext:
  { "app_id": 7, "total_accounts": 4217,
    "total_deposits": "0x...", "total_borrows": "0x...",
    "accounts": {
      "0xAbC...1": {"collateral_balance":"0x...","borrowed_balance":"0x...","nonce":7},
      "0xDeF...2": {"collateral_balance":"0x...","borrowed_balance":"0x...","nonce":3},
      ... 4217 entries ... } }

No event emitted. No nonce consumed. Fully repeatable and costless.
```

Beyond the disclosure itself, this hands an adversary everything needed to *target* the other demo
defects: exact collateral balances let them size DEMO-01 borrows precisely, and exact nonces reveal
which accounts are inactive.

**Fix.**

1. **Fail closed by default.** Until a compliance model exists (SPEC-09), the handler must refuse:
   ```go
   func handleDeanonymization(appId int64, sender *types.Address,
                              payloadJSON, stateJSON string) types.ProcessResult {
       return types.ProcessResult{
           State: []byte(stateJSON), Events: []types.PlainEvent{},
           AppEvents: []types.AppEvent{}, Withdrawals: []types.Withdrawal{},
           Report: nil, Fuel: types.NewUint256(1000),
           Error: "deanonymization is not enabled in this build",
       }
   }
   ```
2. **Require all four controls from `20:114-131`** before re-enabling: an **authority key set**
   committed in state at deploy and included in `configCommitment`; a verified **signature** over the
   request from a key in that set; an explicit **scope** naming the specific accounts and fields
   requested — never `state.Accounts`; and **single-use nonce binding** so a captured request cannot
   be replayed (`23:214-219`).
3. **Never return the whole map.** Build the report from the requested scope only, and reject a scope
   exceeding a committed `maxReportAccounts` bound.
4. **Encrypt the report to the requesting authority** rather than emitting plaintext at the guest
   boundary, per `IMPLEMENTATION_GUIDE.md:70`'s "scoped **encrypted** reports". Do not depend on an
   unstated host guarantee.
5. **Emit an auditable event for every disclosure** — requester identity, scope hash, nonce and report
   commitment — even though the report body stays encrypted. Route it through `AppEvents`, which is
   currently always empty.
6. **Add a test** asserting that `requestType == 2` from a non-authority sender returns an error, a
   `nil` report, and no state change.

---

### DEMO-04 — No interest, no reserves, no oracle, no prices, no asset dimension · HIGH

**Affected components.** all of `app/state.go`, `app/lending.go`, `app/operations.go`;
`08-NOCTSTATE-V1.md:41-81`; `11-ASSET-RESERVE-MODEL.md`; `18-ORACLE-ARCHITECTURE.md`;
`19-INTEREST-ACCRUAL.md`.

**Mechanics.** `NoctState` is the entire protocol state:

```go
type NoctState struct {                                    // state.go:10-16
    Accounts        map[string]*Account `json:"accounts"`
    TotalDeposits   string              `json:"total_deposits"`
    TotalBorrows    string              `json:"total_borrows"`
    CollateralRatio uint64              `json:"collateral_ratio"`
    Version         string              `json:"version"`
}

type Account struct {                                      // state.go:19-23
    CollateralBalance string `json:"collateral_balance"`
    BorrowedBalance   string `json:"borrowed_balance"`
    Nonce             uint64 `json:"nonce"`
}
```

Five global fields and three per-account fields. Verified by full-text search, the demo contains
**no** occurrence of `borrowIndex`, `reserve`, `availableLiquidity`, `oracle`, `price`, `scaledDebt`,
`utilizationRate`, `lastAccrualTimestamp` or `healthFactor`. Consequently:

1. **Debt is perpetual principal.** `BorrowedBalance` is set at `lending.go:118` and reduced only at
   `lending.go:180`. Nothing ever increases it. A borrower holds a position forever at zero cost, so
   the protocol has **no revenue** and no way to price risk. File 19's entire accrual model —
   `borrowIndex`, RAY scaling, lazy chunked accrual to `AdapterBlockTimestamp` — is absent.
2. **No prices, so no risk measurement.** The solvency check at `lending.go:106-115` compares
   `borrowAmount * ratio` against `collateral * 100` — **both in raw token units, with no valuation**.
   With no oracle and no price field, the check is unit-blind.
3. **No asset dimension, and the token parameter is discarded.** `ProcessDeposit` accepts
   `token *types.Address` at `lending.go:27` and **never reads it** — verified: the identifier does not
   appear again in the function body. Every deposit is credited to the same `CollateralBalance`
   regardless of which token was sent. One wei of a worthless token grants the same borrowing power as
   one wei of the intended asset, and mixed-token deposits are summed as if fungible.
4. **No reserves, so no liquidity constraint.** `ProcessBorrow` (`lending.go:83-155`) never consults a
   liquidity pool. `12:229`'s precondition — that a borrow requires sufficient `availableLiquidity` —
   has no counterpart. The demo authorizes withdrawals against assets it does not hold: **it mints from
   nothing**. `TotalDeposits` and `TotalBorrows` are pure counters, never compared to each other or to
   any reserve.
5. **No liquidation, no bad-debt handling, no fees, no emergency controls.** The five operations are
   `DEPOSIT`, `BORROW`, `REPAY`, `WITHDRAW`, `VIEW_BALANCE` (`lending.go:12-18`). There is no
   `LIQUIDATE`, no `PAUSE`, no fee accrual, and no path for an under-collateralized position to be
   resolved — because without prices nothing can detect one.

**Impact.** The demo cannot express insolvency, so it cannot test or demonstrate any of the risk
mechanisms Files 10, 11, 12, 18, 19 and 20 exist to specify. Points 2 and 3 combine into an
independent theft vector that does not need DEMO-01 at all:

```
1. attacker deposits 1 wei of an arbitrary worthless ERC-20
   lending.go:27  token parameter accepted and IGNORED
   lending.go:58  CollateralBalance = 1
2. attacker borrows: ratio check is  amount*200 <= 1*100
   -> any amount up to collateral/2 passes, denominated in whatever asset custody
      actually pays out, because no price relates the two
   lending.go:146 Withdrawal{ 0x0, attacker, amount }
=> worthless tokens exchanged for real ones at parity.
```

Rated HIGH rather than CRITICAL only because DEMO-01 and DEMO-02 already provide strictly better
attacks. The asset-dimension defect is nonetheless independently exploitable and would survive a fix
to both.

**Fix.** This cannot be patched locally — the demo must adopt the corrected state model. Minimum
viable changes, in dependency order:

1. **Add the asset dimension.** Replace the scalar balances with per-asset maps keyed by a committed
   `AssetID`, mirroring `08:66-81`:
   ```go
   type Account struct {
       Cash          map[AssetID]*types.Uint256 `json:"cash"`
       Collateral    map[AssetID]*types.Uint256 `json:"collateral"`
       Borrowed      map[AssetID]*types.Uint256 `json:"borrowed"`
       ScaledDebt    map[AssetID]*types.Uint256 `json:"scaled_debt"`
       PositionNonce uint64                     `json:"position_nonce"`
   }
   ```
2. **Validate `token` against a committed asset registry** in `ProcessDeposit` and reject unknown
   tokens instead of ignoring the parameter. Derive `AssetID` from `token` and credit `Cash[assetID]`.
3. **Add reserves and a liquidity gate.** Per `11` and `12:229`, add `Reserves map[AssetID]*Reserve`
   with `AvailableLiquidity`, `TotalScaledDebt`, `BorrowIndexRay`, `LastAccrualTimestamp`, and require
   `borrowAmount <= reserve[asset].AvailableLiquidity` before authorizing any withdrawal.
4. **Add oracle state and price every comparison.** Per `18`, add
   `OracleState { Prices map[AssetID]*types.Uint256; AdapterBlockTimestamp uint64; Epoch uint64 }`
   sourced only from an authenticated delivery, and rewrite the solvency check in USD using
   `mulDivDown`/`mulDivUp` under SPEC-02's decimal policy.
5. **Add accrual.** Per `19`, implement `accrue(reserve, toTimestamp)` in bounded chunks, call it at
   the start of every debt-touching transition, and derive debt as
   `mulDivUp(scaledDebt, borrowIndex, RAY)` rather than storing principal.
6. **Until items 3–5 exist, state plainly in `README.md` that the demo has no economic security
   properties** and must not be used to validate Files 10–20. Today the README presents it as a
   working lending application, which is the misleading part.

---

### DEMO-05 — Deposit credits collateral directly: "deposit is not supply" is absent · HIGH

**Affected components.** `app/lending.go:12-18,26-80,209-283`; `app/state.go:19-23`;
`08-NOCTSTATE-V1.md:66-70`; `12-COMPLETE-STATE-MACHINE.md:188-199`; `README.md:17-21`.

**Mechanics.** The corrected set's headline accounting invariant is that a deposit is **not** a
supply: value lands in a private `cash[asset]` bucket, and only an explicit `SUPPLY` transition
reclassifies it into `collateral[asset]`, the sole bucket contributing to borrowing power
(`08:66-70`, `12:188-199`, `README.md:17-21`).

The demo has no `cash` bucket. `Account` holds exactly one balance field, `CollateralBalance`
(`state.go:20`), and `ProcessDeposit` writes the deposit straight into it:

```go
account.CollateralBalance = newCollateral.ToHex()     // lending.go:58
account.Nonce++                                        // lending.go:59
state.TotalDeposits = newTotal.ToHex()                 // lending.go:60
```

There is no `SUPPLY` or `UNSUPPLY` operation — the five constants at `lending.go:12-18` are `DEPOSIT`,
`BORROW`, `REPAY`, `WITHDRAW`, `VIEW_BALANCE`. T01 and T03 are fused into one step, so every deposit
becomes instantly borrowable collateral with no user intent required.

Two consequences follow, both exploitable:

1. **No separation between withdrawable funds and pledged collateral.** `ProcessWithdraw`
   (`lending.go:209-283`) withdraws from `CollateralBalance` — the same field deposits credit. The
   bucket backing the protocol's solvency is therefore also the bucket users withdraw from at will,
   guarded only by the DEMO-01 ratio check. In the corrected model `cash` is freely withdrawable and
   `collateral` is encumbered; here they are one field, so the distinction that makes withdrawal safe
   does not exist.
2. **Deposits are auto-supplied without consent.** A user who deposits for safekeeping is immediately
   collateralized. Combined with DEMO-02 and `lending.go:233`'s `if !currentBorrow.IsZero()` guard, the
   single-bucket design is precisely what lets the DEMO-02 simulation withdraw the original deposit at
   step 4 — under the corrected model that value would still be `cash`, and reversing the
   reclassification would require an explicit `UNSUPPLY` that re-checks the health factor
   (`12:188-199`).

**Interaction with DEMO-04.** Because deposits also ignore `token` (DEMO-04 point 3), the single
`CollateralBalance` field aggregates *different assets* into one undifferentiated number. No state in
the demo could distinguish "1 USDC deposited" from "1 ETH deposited", so adding a `cash` bucket
without the asset dimension would not restore the invariant.

**Fix.**

1. **Split the bucket.** Add `Cash map[AssetID]*types.Uint256` and
   `Collateral map[AssetID]*types.Uint256` to `Account`, and change `lending.go:58` to credit
   `Cash[assetID]`.
2. **Add `SUPPLY` and `UNSUPPLY` operations** to `lending.go:12-18` and to the `operations.go:157`
   switch, implementing `12:188-199`:
   ```go
   // OpSupply: cash -> collateral. No value change, no withdrawal emitted.
   if cash[asset].Cmp(amount) < 0     { return error("insufficient cash") }
   if cash[asset].SubOverflow(*amount) { return error("cash underflow") }
   if collateral[asset].AddOverflow(*amount) { return error("collateral overflow") }

   // OpUnsupply: collateral -> cash. MUST re-check solvency on the post state.
   if collateral[asset].Cmp(amount) < 0 { return error("insufficient collateral") }
   post := stateAfter(collateral[asset] -= amount)
   if !solvent(post) { return error("would under-collateralize position") }
   ```
3. **Make `ProcessWithdraw` withdraw from `Cash`, not `Collateral`.** Rewrite `lending.go:225-246` to
   debit `Cash[asset]` and drop the ratio check for cash withdrawals — cash is unencumbered, so no
   solvency test applies. Encumbered collateral becomes withdrawable only via `UNSUPPLY` then
   `WITHDRAW`.
4. **Make `TotalDeposits` per asset** (or replace it with `reserve[asset].Ledger`) so aggregate
   accounting is not a cross-asset sum of incomparable units.
5. **Add an invariant test** asserting that `sum(cash) + sum(collateral) + sum(borrowed)` is unchanged
   by `SUPPLY` and `UNSUPPLY`, and that a plain `DEPOSIT` never increases `collateral`.

---

### DEMO-06 — `DeserializeState` silently resets the whole ledger on empty state · HIGH

**Affected components.** `app/state.go:41-57`; `app/operations.go:69,121,256`;
`22-FAILURE-RECOVERY.md:11`; `23-REPLAY-PROTECTION.md:233`.

**Mechanics.** Every entry point deserializes state through one function:

```go
func DeserializeState(data string) (*NoctState, error) {
    if data == "" || data == "{}" {
        return NewState(200), nil // Default 200% collateralization     state.go:43-45
    }
    var state NoctState
    if err := json.Unmarshal([]byte(data), &state); err != nil {
        return nil, err
    }
    ...
}
```

An empty or `{}` state string does **not** produce an error. It produces a brand-new, empty ledger
with a hardcoded 200% ratio — indistinguishable, to every caller, from a legitimately deployed fresh
application. All three call sites (`operations.go:69`, `:121`, `:256`) proceed normally with the
result.

Three separate failures follow:

1. **Total ledger loss.** If the host ever passes an empty state string — a fresh or restarted
   deployment, a state-fetch failure that degrades to `""`, a migration mishap, or an attacker who can
   influence the state parameter — every account balance, `TotalDeposits` and `TotalBorrows` is
   replaced with zeros, and the next `ProcessResult.State` commits the empty ledger permanently. The
   prior state is not recoverable from inside the guest.
2. **Silent config override.** `NewState(200)` hardcodes the ratio, discarding whatever `Deploy`
   configured at `operations.go:31-36`. A deployment set to, say, 150% silently reverts to 200% on any
   empty-state event, changing every account's borrowing power with no event and no error.
3. **It is exactly the recovery pattern the specification forbids.** `22:11` states Noct "MUST NOT
   initialize an empty ledger and rebuild balances by replaying public deposits", and `23:233` repeats
   that monitoring "MUST NOT 'repair' the system by replaying deposits into a newly initialized
   ledger". The demo does not merely permit this — it makes it the *default behaviour* of the state
   loader, so the forbidden recovery is what happens automatically.

**Compounding with DEMO-11.** `operations.go:239` commits state as
`newStateBytes, _ := newState.Serialize()`, discarding the error. If `Serialize()` ever fails,
`newStateBytes` is `nil`, the guest returns an empty `State`, and the *next* call hits
`state.go:43-45` — wiping the ledger. A marshalling failure and an empty-state reset therefore chain
into total loss with no error surfaced at either step. The same discarded-error pattern appears at
`operations.go:37,53,85,96,139,161,177,195,213,227,278,279`.

**Simulation.**

```
Steady state: 4217 accounts, TotalDeposits = 8.4M units, CollateralRatio = 150 (set at deploy).

Host restarts and passes state = "" to process_request for any user request.

operations.go:121  DeserializeState("")
state.go:43-45     -> NewState(200)      # empty ledger; ratio silently 150 -> 200
operations.go:157  -> normal dispatch on the empty ledger
operations.go:239  newStateBytes = serialize(empty state)
operations.go:243  State: newStateBytes  # committed

Result: all 4217 balances gone, ratio changed, no error returned, no event emitted,
and the caller sees a successful ProcessResult. Any user can now deposit and borrow
against a ledger that no longer records the original depositors' claims.

**Fix.**

```go
// app/state.go:41-57 replacement
func DeserializeState(data string) (*NoctState, error) {
    // An empty state is NEVER a valid existing deployment. Only deploy/load_module may
    // create initial state, and they call NewState directly.
    if data == "" {
        return nil, fmt.Errorf("empty state: refusing to initialize a ledger outside deploy")
    }
    var state NoctState
    if err := json.Unmarshal([]byte(data), &state); err != nil {
        return nil, fmt.Errorf("state unmarshal: %w", err)
    }
    if err := state.Validate(); err != nil {
        return nil, err
    }
    if state.Accounts == nil {
        state.Accounts = make(map[string]*Account)
    }
    return &state, nil
}

// New: reject structurally invalid or unconfigured state instead of papering over it.
func (s *NoctState) Validate() error {
    if s.ApplicationID == 0 {
        return fmt.Errorf("state is not bound to an application id")        // DEMO-07
    }
    if s.SchemaVersion != CurrentSchemaVersion {
        return fmt.Errorf("unsupported schema version %d", s.SchemaVersion) // DEMO-07
    }
    if s.CollateralRatio < 100 || s.CollateralRatio > 10_000 {
        return fmt.Errorf("collateral ratio %d out of bounds", s.CollateralRatio)
    }
    if _, err := ParseUint256(s.TotalDeposits); err != nil {
        return fmt.Errorf("invalid total_deposits: %w", err)
    }
    if _, err := ParseUint256(s.TotalBorrows); err != nil {
        return fmt.Errorf("invalid total_borrows: %w", err)
    }
    return nil
}
```

Also:

1. **Remove the `"{}"` special case.** `{}` unmarshals successfully into a zero `NoctState`, and
   `Validate()` then rejects it for a missing application ID and an out-of-range ratio — the correct,
   explicit outcome.
2. **Stop discarding `Serialize()` errors.** Replace every `x, _ := state.Serialize()` with handling
   that returns a `ProcessResult` carrying the *original* `stateJSON` and a non-empty `Error`, exactly
   as the deserialization-failure branches already do at `operations.go:72-78`. A guest must never
   commit a `nil` or empty state.
3. **Add `stateVersion uint64`** to `NoctState` (distinct from the display `Version string`) and
   require it to advance by exactly one per committed transition, so a reset to a fresh ledger is
   detectable as a version regression.
4. **Add tests**: empty state errors and changes nothing; `{}` errors; an out-of-range ratio errors; a
   `Serialize()` failure preserves the prior state bytes verbatim.

---

### DEMO-07 — No nonce verification and no application/chain/schema binding: no replay protection · HIGH

**Affected components.** `app/state.go:10-23`; `app/operations.go:12-46,63,110-251,253`;
`app/main.go:14,33,51`; `09-STATE-COMMITMENT-MODEL.md:116-139`;
`23-REPLAY-PROTECTION.md:9-19,40-46`; `21-TRANSACTION-REQUEST-LIFECYCLE.md`.

**Mechanics.** `Account` carries a `Nonce uint64` (`state.go:22`) that is incremented on every
mutation — `lending.go:59` (deposit), `:119` (borrow), `:181` (repay), `:247` (withdraw) — and
**never compared against anything**. Verified by full-text search: `Nonce` is read nowhere except the
`ViewBalance` echo at `lending.go:296` and the `"timestamp"` field in event payloads. The
`OperationRequest` type (`lending.go:21-24`) has only `Operation` and `Amount` — no nonce, no
signature, no request ID, no deadline.

`NoctState` (`state.go:10-16`) has no `ApplicationID`, no `ChainID`, no `SchemaVersion`, no
`StateVersion`, no `ConfigCommitment` and no `OracleCommitment`. Its only version marker is
`Version string = "v0.1.0"` (`state.go:15,32`), which is never validated.

`appId` **is** delivered to all three entry points (`main.go:14,33,51`) and threaded through to
`Deploy` (`operations.go:12`), `DepositFunds` (`operations.go:63`), `ProcessRequest`
(`operations.go:110`) and `handleDeanonymization` (`operations.go:253`) — but in every case it is used
**only in log statements** (`operations.go:13,50,66,113,254`) and, for deanonymization, echoed into
the report (`operations.go:271`). It is never stored in state and never compared.

This violates two frozen controls:

> "Deployment MUST freeze both values [`velaApplicationID`, `chainID`] in initial state and **every
> call MUST match them**."  (`09:139`)
>
> "A request for another deployment, chain, endpoint, protocol version, or schema is rejected."
> (`23:40-46`)

**Impact.**

1. **No application-layer replay protection.** A captured request payload stays valid forever.
   Because `REPAY` is self-declared (DEMO-02), a replayed repay payload keeps erasing debt until
   `lending.go:169` rejects it for exceeding the now-zero balance. `WITHDRAW` is worse: its only bound
   is the collateral balance, so a replay drains collateral up to that balance each time the victim
   tops it up. `23:9-19` enumerates seven replay domains; the demo implements none of them.
2. **Cross-deployment and cross-chain replay.** With no `appId`/`chainID` binding, the same
   `(payload, state)` pair can be replayed against a *different* Noct deployment or a different chain
   and will be accepted, because nothing distinguishes them. `23:40-46` exists precisely to prevent
   this, and SPEC-11 shows File 08's alternative global structure could not support it either.
3. **No schema or protocol version gate.** A state blob from any version is accepted
   (`state.go:47-50`), so a rollback to an older, weaker state — or a hand-crafted blob with a
   favourable `CollateralRatio` — is undetectable. `09:120` and `23:46` both require a `schemaVersion`
   check.
4. **The nonce is cosmetically present but functionally absent.** This is the most dangerous variant
   of the defect: a reviewer sees `Nonce uint64` and `account.Nonce++` and may reasonably conclude
   replay protection exists. It does not.

**Fix.**

1. **Bind deployment identity in state and check it on every call.**
   ```go
   type NoctState struct {
       ApplicationID    int64  `json:"application_id"`
       ChainID          uint64 `json:"chain_id"`
       SchemaVersion    uint64 `json:"schema_version"`
       StateVersion     uint64 `json:"state_version"`
       ConfigCommitment string `json:"config_commitment"`
       Accounts         map[string]*Account `json:"accounts"`
       // ... existing fields ...
   }

   // operations.go Deploy: set once, at initialization
   state := NewState(params.CollateralRatio)
   state.ApplicationID = appId
   state.ChainID       = params.ChainID        // must be supplied and validated at deploy
   state.SchemaVersion = CurrentSchemaVersion

   // operations.go: in ProcessRequest (:110) and DepositFunds (:63), immediately after
   // DeserializeState and before any dispatch:
   if state.ApplicationID != appId {
       return errorResult(stateJSON, fmt.Errorf(
           "application id mismatch: state %d, call %d", state.ApplicationID, appId))
   }
   if state.SchemaVersion != CurrentSchemaVersion {
       return errorResult(stateJSON, fmt.Errorf("unsupported schema version %d", state.SchemaVersion))
   }
   ```
   `Deploy` must reject a zero `params.ChainID` rather than defaulting it, since `09:139` requires the
   real EIP-155 chain ID and not "an assumed Ethereum-mainnet value".
2. **Verify the nonce.** Add `Nonce uint64` and `RequestID string` to `OperationRequest`
   (`lending.go:21-24`) and check before dispatch:
   ```go
   account := state.GetOrCreateAccount(sender)
   if req.Nonce != account.Nonce {
       return errorResult(stateJSON, fmt.Errorf(
           "nonce mismatch: expected %d, got %d", account.Nonce, req.Nonce))
   }
   ```
   Use strict equality, not `>=`, so both replays and skipped nonces are rejected. Remove the
   scattered `account.Nonce++` at `lending.go:59,119,181,247` and increment once, in the dispatcher,
   after a successful transition.
3. **Track consumed request IDs** in an append-only set inside `NoctState`, per `23:9-19` and
   `09:88-99`, so a retry after a partial commit is idempotent rather than double-applied.
4. **Advance `StateVersion` by exactly one per committed transition** and include it in every event
   payload, replacing the misleading `"timestamp": account.Nonce` (DEMO-11).
5. **Add tests**: a replayed payload with a stale nonce is rejected; a payload replayed against a
   different `appId` is rejected; a state blob with a mismatched `SchemaVersion` is rejected; and a
   successful transition increments `Nonce` and `StateVersion` exactly once.

---

### DEMO-08 — Discarded overflow flags and ignored parse errors on aggregate accounting · HIGH

**Affected components.** `app/lending.go:121-124` (borrow), `:183-186` (repay), `:249-252` (withdraw);
`app/helpers.go:18-29`; `vela-common-go v0.2.0/wasm/types/uint256.go:91,111`.

**Mechanics.** `ProcessDeposit` handles aggregate accounting correctly — `lending.go:51-55` captures
and checks the `AddOverflow` result. The other three transitions discard it:

```go
// ProcessBorrow, lending.go:121-124
totalBorrows, _ := ParseUint256(state.TotalBorrows)        // parse error DISCARDED
var newTotalBorrows types.Uint256
newTotalBorrows.AddOverflow(*totalBorrows, *borrowAmount)  // overflow flag DISCARDED
state.TotalBorrows = newTotalBorrows.ToHex()

// ProcessRepay, lending.go:183-186
totalBorrows, _ := ParseUint256(state.TotalBorrows)        // parse error DISCARDED
var newTotalBorrows types.Uint256
newTotalBorrows.SubOverflow(*totalBorrows, *repayAmount)   // underflow flag DISCARDED
state.TotalBorrows = newTotalBorrows.ToHex()

// ProcessWithdraw, lending.go:249-252
totalDeposits, _ := ParseUint256(state.TotalDeposits)      // parse error DISCARDED
var newTotalDeposits types.Uint256
newTotalDeposits.SubOverflow(*totalDeposits, *withdrawAmount)  // underflow DISCARDED
state.TotalDeposits = newTotalDeposits.ToHex()
```

Two distinct defects, each with two consequences.

**(a) Discarded `ParseUint256` errors → nil dereference → WASM trap.** `ParseUint256`
(`helpers.go:8-15`) returns `(nil, err)` on a malformed hex string. All three sites discard the error
with `_` and immediately dereference the result (`*totalBorrows`, `*totalDeposits`). If either counter
is empty or malformed — reachable via a state blob from an older version (DEMO-07 point 3), a
hand-crafted blob, or a partial write — the guest panics on a nil dereference. In TinyGo/WASM that is
a trap, so the whole `process_request` fails and the host receives no `ProcessResult`. Contrast
`lending.go:39-42` and `:89-97`, which *do* check the identical call: the inconsistency shows this is
an oversight, not a design choice.

**(b) Discarded overflow/underflow flags → wrapped aggregate counters.** `SubOverflow` on
`TotalBorrows` when `repayAmount > TotalBorrows` (reachable as soon as per-account and aggregate
values diverge, which DEMO-02 guarantees) wraps to a value near `2^256`. `AddOverflow` wraps when
DEMO-01 borrows are near `2^253`. Because the wrapped result is committed via `ToHex()`, the
aggregates become permanently corrupted — and they are exactly the values `handleDeanonymization`
reports (`operations.go:273-274`), so even the compliance output is wrong.

The dead-code detail is instructive: `helpers.go:18-29` defines `AddUint256` and `SubUint256` that
**do** return the flags correctly. Verified by search, **neither is called anywhere in the
repository.** The correct helpers were written and then not used.

**Impact.** Aggregate accounting is the only protocol-wide solvency view the demo has. Once
`TotalDeposits` or `TotalBorrows` wraps there is no invariant left to check against, no way to detect
the corruption from inside the guest, and no reconciliation step (`10:181-184`) that would catch it.
The nil-dereference path additionally gives anyone who can influence stored state a denial-of-service
primitive: corrupt a counter, and every subsequent borrow/repay/withdraw traps.

**Fix.**

1. **Use the existing helpers and handle the flag**, at all three sites:
   ```go
   // lending.go:121-124 replacement (ProcessBorrow)
   totalBorrows, err := ParseUint256(state.TotalBorrows)
   if err != nil {
       return nil, nil, nil, fmt.Errorf("invalid total borrows: %w", err)
   }
   newTotalBorrows, overflow := AddUint256(totalBorrows, borrowAmount)
   if overflow {
       return nil, nil, nil, fmt.Errorf("total borrows overflow")
   }
   state.TotalBorrows = newTotalBorrows.ToHex()
   ```
   Apply the same shape with `SubUint256` at `lending.go:183-186` and `:249-252`.
2. **Delete `helpers.go:18-29` or use it.** Dead correct code beside live incorrect code is the worst
   of both outcomes; a lint rule flagging unused exported helpers would have caught this.
3. **Validate aggregate state at load time.** The `Validate()` addition from DEMO-06 already parses
   both counters, removing the nil-dereference class at the boundary rather than at each call site.
4. **Add the per-transition conservation assertion** (DEMO-02 fix item 4) so a wrapped aggregate is
   rejected before it is committed rather than silently persisted.
5. **Add a CI grep** for `, _ := ParseUint256(` and for `*Overflow(` calls whose result is not
   assigned, and fail the build on either.

---

### DEMO-09 — `VIEW_BALANCE` mutates and commits state despite claiming not to; unbounded state growth · MEDIUM

**Affected components.** `app/operations.go:208-210,239`; `app/lending.go:285-309`;
`app/state.go:59-74`.

**Mechanics.** The dispatcher treats balance viewing as read-only:

```go
case OpViewBalance:
    events, err = ViewBalance(state, sender)
    newState = state // No state change for view          operations.go:209-210
```

The comment is false. `ViewBalance` calls `GetOrCreateAccount` (`lending.go:289`), which **writes**:

```go
func (s *NoctState) GetOrCreateAccount(address *types.Address) *Account {
    addrHex := address.Hex()
    if acc, exists := s.Accounts[addrHex]; exists { return acc }
    acc := &Account{ CollateralBalance: types.NewUint256(0).ToHex(),
                     BorrowedBalance:   types.NewUint256(0).ToHex(),
                     Nonce:             0 }
    s.Accounts[addrHex] = acc        // state.go:72  <- MUTATION
    return acc
}
```

`state` is a `*NoctState` and `newState = state` copies the **pointer**, so the two are the same
object. The mutation is therefore serialized at `operations.go:239`
(`newStateBytes, _ := newState.Serialize()`) and committed at `operations.go:243`. A request the code
explicitly labels "no state change" **changes the committed state**, and therefore changes Vela's
state root.

Three consequences:

1. **Unbounded state growth — a free denial-of-service.** Any address can insert a permanent entry
   into `state.Accounts` with a single `VIEW_BALANCE` request costing nothing but fuel. There is no cap
   on `len(state.Accounts)`, no pruning of zero-balance accounts, and no cost scaling with map size.
   Because the entire state is serialized and deserialized on **every** transition
   (`operations.go:121`, `:239`), an attacker who inserts, say, 10 million zero entries makes every
   subsequent operation for every user progressively slower and larger, eventually exceeding WASM
   memory or the host's state-size limit and bricking the application. The attacker pays once; all
   users pay forever.
2. **Root churn on read-only calls.** A view request produces a different state root than the prior
   one. Any observer, monitor or proof system that expects read-only calls to be root-stable — a
   natural expectation, and one `09`'s commitment model relies on — sees unexplained divergence. It
   also makes state-root auditing useless for distinguishing economic activity from mere queries.
3. **Privacy leak via enumeration.** Because a view request creates an entry, an observer who can
   compare state sizes (or read the DEMO-03 report) before and after can infer whether an address had
   previously interacted with the protocol.

**Fix.**

1. **Make the view path genuinely read-only.** Add a non-mutating lookup and use it in `ViewBalance`:
   ```go
   // app/state.go: new, non-mutating
   func (s *NoctState) GetAccount(address *types.Address) (*Account, bool) {
       acc, exists := s.Accounts[address.Hex()]
       return acc, exists
   }

   // app/lending.go:289 replacement
   account, exists := state.GetAccount(sender)
   if !exists {
       account = &Account{ CollateralBalance: types.NewUint256(0).ToHex(),
                           BorrowedBalance:   types.NewUint256(0).ToHex() }
       // local only: NOT inserted into state.Accounts
   }
   ```
2. **Return the input state bytes verbatim for read-only operations** instead of re-serializing:
   ```go
   case OpViewBalance:
       events, err = ViewBalance(state, sender)
       if err != nil { /* error result */ }
       return types.ProcessResult{
           State: []byte(stateJSON),      // unchanged bytes, unchanged root
           Events: events, AppEvents: []types.AppEvent{},
           Withdrawals: []types.Withdrawal{}, Report: nil,
           Fuel: types.NewUint256(1000), Error: "",
       }
   ```
   This also removes the `operations.go:239` discarded-error exposure on the view path.
3. **Reserve `GetOrCreateAccount` for mutating transitions only.** Better, rename it
   `CreateAccountIfAbsent` so the write is visible at every call site.
4. **Bound the map.** Enforce a committed `maxAccounts`, reject creation beyond it, and charge fuel
   proportional to `len(state.Accounts)` so growth is not free. Optionally prune accounts with
   all-zero balances and no pending operations.
5. **Add tests**: a `VIEW_BALANCE` from a fresh address returns byte-identical `State` and does not
   increase `len(state.Accounts)`; a mutating operation from a fresh address creates exactly one entry.

---

### DEMO-10 — Borrow emits a native withdrawal, merging T05 and T06; zero token address; no withdrawal ID · MEDIUM

**Affected components.** `app/lending.go:144-154,272-282`;
`12-COMPLETE-STATE-MACHINE.md:246,248-265,173,181-183,469`; `23-REPLAY-PROTECTION.md:16`;
`vela-common-go v0.2.0/wasm/types/common.go:22-26`.

**Mechanics.** `ProcessBorrow` ends by emitting a custody withdrawal directly to the borrower:

```go
// Create withdrawal for borrowed amount                        lending.go:144
zeroAddress := types.Address{}                                 // lending.go:145
withdrawals := []types.Withdrawal{{
    TokenAddress:       zeroAddress,                            // lending.go:148
    DestinationAddress: *sender,
    Amount:             borrowAmount,                           // lending.go:150
}}
return state, events, withdrawals, nil                          // lending.go:154
```

The corrected state machine separates these steps deliberately:

> "T05 credits a private borrowed balance in Vela custody. It **does not have to emit a native
> withdrawal**. A client that wants wallet delivery submits T06 separately after T05 commits."
> (`12:246`)
>
> "Debt and reserve available liquidity do not change [in T06]."  (`12:265`)

The demo fuses T05 and T06, so borrowing *is* withdrawal. Three problems follow:

1. **No separation between borrowed-and-held and borrowed-and-delivered.** `Account` has no `borrowed`
   bucket distinct from what has left custody (DEMO-04/05), so once the withdrawal is emitted there is
   no record of whether the borrower still holds the funds inside the protocol. The spec's model exists
   precisely so a borrower can hold borrowed assets privately and withdraw later; the demo cannot
   represent that state.
2. **`TokenAddress` is the zero address.** `types.Address{}` is all-zero bytes. Because
   `ProcessDeposit` ignores its `token` parameter (DEMO-04 point 3), the demo has no asset registry and
   therefore no correct address to use — but the effect is that every withdrawal names the zero
   address as its token. Whether the host reads that as native currency, as a specific ERC-20, or
   rejects it is **undocumented in this repository**, and `ProcessWithdraw` (`lending.go:276`) does the
   same for collateral withdrawals. A guest must not emit an ambiguous token identifier for a value
   transfer.
3. **No withdrawal ID, so no idempotency or replay binding.** `23:16` and `12:173,181-183,469` require
   a deterministic withdrawal ID so a retried transition cannot double-pay. `types.Withdrawal` has no
   ID field (SPEC-10), and the demo does not compensate with a guest-side settlement record — so a
   retried `process_request` that re-executes `ProcessBorrow` emits a second withdrawal, with nothing
   stopping it beyond the collateral check (which DEMO-01 already defeats).

**Fix.**

1. **Split the operations**, matching `12:246,248-265`:
   ```go
   // OpBorrow (T05): credit borrowed[a], increase debt, emit NO withdrawal.
   account.Borrowed[asset] = AddUint256(account.Borrowed[asset], borrowAmount)
   return state, events, nil /* no withdrawals */, nil

   // OpWithdrawBorrowed (T06): move borrowed[a] out to the wallet.
   // Debt and reserve liquidity MUST NOT change here (12:265).
   if account.Borrowed[asset].Cmp(amount) < 0 { return error("insufficient borrowed balance") }
   account.Borrowed[asset] = SubUint256(account.Borrowed[asset], amount)
   withdrawals = []types.Withdrawal{{ TokenAddress: assetTokenAddress(asset),
                                      DestinationAddress: *sender, Amount: amount }}
   ```
2. **Resolve the token address from a committed asset registry** and reject unknown assets. Never emit
   `types.Address{}`. If native currency is intended, define an explicit sentinel constant and
   document how the host interprets it — confirming that interpretation against the Vela documentation
   rather than assuming it.
3. **Record a guest-side settlement ID** for every emitted withdrawal and refuse duplicates:
   ```go
   settlementID := sha256(operationID || assetID || destination || amount)
   if _, seen := state.ConsumedSettlements[settlementID]; seen { return originalResult() } // idempotent
   state.ConsumedSettlements[settlementID] = state.StateVersion
   ```
   This satisfies `23:16` without a host-side type change, and it belongs in `consumedReceiptRoot` per
   `09:88-99` once commitments exist (SPEC-03).
4. **Add tests**: `BORROW` emits no withdrawal and increases `borrowed[a]`; `WITHDRAW_BORROWED` emits
   exactly one withdrawal and does not change debt; a retried `WITHDRAW_BORROWED` with the same
   settlement ID emits nothing.

---

### DEMO-11 — Discarded `json.Marshal` errors; nonce emitted as a timestamp; all events share one subtype · MEDIUM

**Affected components.** `app/lending.go:64-69,74,129-139,191-196,257-267,291-303`;
`app/operations.go:278`; `18-ORACLE-ARCHITECTURE.md:163-167`; `09-STATE-COMMITMENT-MODEL.md:112`.

**Mechanics.** Three separate defects in the only audit surface the demo has.

1. **Every `json.Marshal` error is discarded.** `lending.go:65,129,191,257,292` and
   `operations.go:278` all use `eventData, _ := json.Marshal(...)`. If marshalling fails, the event is
   emitted with `Data: nil`, so the transition still commits and still moves value while producing **no
   record of what happened**. At `operations.go:278` this means a failed deanonymization report is
   returned as `Report: nil` with `Error: ""` — a silent success. Since the demo has no `appRoot`, no
   `historyRoot` and no `AppEvents`, events are the *entire* audit trail; losing one loses the record
   of that transition.
2. **The nonce is published as a timestamp.** Every event payload contains `"timestamp": account.Nonce`
   (`lending.go:68,133,196,261`). A nonce is a per-account sequence counter; a timestamp is a
   wall-clock reading. Labelling one as the other means any consumer — indexer, monitor, UI, or future
   compliance tooling — reads a small integer as a Unix epoch, i.e. a date in January 1970. It also
   contradicts the corrected clock model, in which the only legitimate financial timestamp is
   `OracleState.AdapterBlockTimestamp` (`18:163-167`) and the guest has no authenticated clock at all.
   The demo emits a field *named* `timestamp` that is neither the host clock nor an authenticated one.
3. **All events share the zero subtype.** Every `PlainEvent` uses `EventSubType: [32]byte{}`
   (`lending.go:74,139,267,303`), so `DEPOSIT`, `BORROW`, `REPAY`, `WITHDRAW` and `VIEW_BALANCE` are
   indistinguishable at the event-type level; a consumer must JSON-parse `Data` and read an
   `"operation"` string to tell them apart. That defeats event filtering, makes indexing fragile, and
   means a malformed or absent `Data` field is silently unclassifiable.

The comments also claim encryption that is not present: `lending.go:64` says "Emit encrypted event to
user" and `lending.go:291` says "Create encrypted event with full balance info", but both build
plaintext JSON into a `types.PlainEvent`. Whether the host encrypts `PlainEvent` per `UserID` is a Vela
property this repository never documents — the same unstated-host-guarantee problem as DEMO-03.

**Fix.**

1. **Handle every marshal error.** Fail the transition rather than emitting an empty event:
   ```go
   eventData, err := json.Marshal(map[string]interface{}{ /* ... */ })
   if err != nil {
       return nil, nil, fmt.Errorf("event marshal: %w", err)
   }
   ```
   Apply at `lending.go:65,129,191,257,292`. At `operations.go:278`, return a `ProcessResult` with a
   non-empty `Error` and `Report: nil` rather than a silent success.
2. **Rename the field and add a real clock.** Emit `"nonce": account.Nonce`, and once oracle state
   exists (DEMO-04 fix item 4) add
   `"adapterBlockTimestamp": state.Oracle.AdapterBlockTimestamp`. Never label a nonce as a timestamp.
3. **Assign a distinct `EventSubType` per operation**, derived deterministically from a committed
   domain separator so it stays stable across versions:
   ```go
   var eventSubTypes = map[string][32]byte{
       OpDeposit:     subType("NOCT_EVENT_DEPOSIT_V1"),
       OpBorrow:      subType("NOCT_EVENT_BORROW_V1"),
       OpRepay:       subType("NOCT_EVENT_REPAY_V1"),
       OpWithdraw:    subType("NOCT_EVENT_WITHDRAW_V1"),
       OpViewBalance: subType("NOCT_EVENT_VIEW_V1"),
   }
   func subType(domain string) [32]byte { return sha256.Sum256([]byte(domain)) }
   ```
4. **Correct the misleading comments** at `lending.go:64,291`, or actually encrypt the payload. State
   explicitly in `README.md` whether `PlainEvent.Data` is confidential and cite the Vela documentation
   that establishes it — do not leave the guarantee unstated.

---

### DEMO-12 — Hardcoded well-known Anvil private key in three committed scripts · LOW

**Affected components.** `test-client.ts:15`; `deploy.js:6`; `demo-tx.js:6`.

**Mechanics.** All three scripts instantiate a wallet from the same literal:

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

This is Anvil/Hardhat **account #0**, derived from the well-known test mnemonic — publicly documented,
and the default funded account on any local node. It appears three times with no environment-variable
fallback and no comment marking it test-only.

**Impact.** Low in isolation: the key controls only a local development account and the scripts target
a local RPC. It is worth recording for two reasons. First, these are the scripts a deployer will
actually run, and `deploy.js` performs the **application deployment** — so a developer who points it at
a real RPC endpoint deploys Noct from a key anyone can impersonate, making the deployment trivially
hijackable; and per DEMO-07 the deployment is not bound to an `appId` in state either, so there is no
second line of defense. Second, committed private keys normalize a pattern that tends to survive into
staging and production.

**Fix.**

1. **Read the key from the environment and fail loudly if absent:**
   ```ts
   const key = process.env.NOCT_DEPLOYER_KEY;
   if (!key) throw new Error("NOCT_DEPLOYER_KEY is not set");
   const wallet = new ethers.Wallet(key, provider);
   ```
   Apply identically at `test-client.ts:15`, `deploy.js:6` and `demo-tx.js:6`.
2. **Assert the RPC target is local** unless explicitly overridden, so a real endpoint cannot be used
   by accident:
   ```ts
   const url = process.env.RPC_URL ?? "http://127.0.0.1:8545";
   if (!/^http:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/.test(url) &&
       process.env.ALLOW_REMOTE_RPC !== "1") {
       throw new Error(`refusing to sign against non-local RPC ${url}; set ALLOW_REMOTE_RPC=1`);
   }
   ```
3. **Add `.env` to `.gitignore`**, ship a `.env.example` containing no secrets, and add a CI secret
   scan (gitleaks or trufflehog) so a committed key fails the build.
4. **Document the deployer identity in `README.md`**, since under the corrected model the deployer
   freezes `velaApplicationID`, `chainID` and `configCommitment` (`09:139`, SPEC-09 fix item 3) and is
   therefore a security-relevant principal rather than a throwaway test account.

---

## 4. Architectural enhancements

The findings above are defects against the design's own stated intent. This section concerns the
design itself — changes that would make V1 structurally harder to get wrong, independent of any single
bug.

### A1. Adopt a single normative arithmetic kernel, and prove it once

The root cause behind DEMO-01, SPEC-02 and SPEC-10 is the same: economic arithmetic is expressed as
prose formulas in Markdown and re-derived at each call site. Files 08, 10, 11, 12 and 19 each restate
`mulDivDown`/`mulDivUp` combinations, and each restatement is an opportunity for a unit or rounding
error.

Create one `noct-arithmetic` package as the single source of truth:
- **typed quantities** (`NativeAmount[asset]`, `UsdWad`, `IndexRay`, `WadFactor`) that cannot be mixed
  without an explicit conversion function, so SPEC-02's class of bug becomes a compile error rather
  than a runtime theft;
- `mulDivDown`/`mulDivUp`/`Mul512` implemented once, property-tested against `math/big`, and never
  reimplemented;
- a **generated** `FORMULAS.md` produced from the code, so documents and implementation cannot drift.
  The corrected set's formulas would then be *output*, not specification.

This is the highest-leverage change in this section: it converts three CRITICAL findings from
"reviewers must remember to check units" into "the type system rejects the mistake".

### A2. Replace prose invariants with executable invariant checks

`11:34-38`, `10:181-184` and `08:199` state invariants in English. Nothing executes them. Every
CRITICAL demo finding survived because no invariant was evaluated at the moment of the state change.

Add an `invariants(state) error` function called at the end of **every** transition, before the
`ProcessResult` is built, covering at minimum:

```
per-asset custody conservation                          (11:34-38)
non-negativity of every balance
sum(account scaledDebt) == reserve.totalScaledDebt, per asset
borrow gate satisfied  =>  liquidation gate NOT satisfied   <- catches SPEC-01
configCommitment matches the in-state configuration          <- catches SPEC-08
applicationID and chainID match this call                    <- catches DEMO-07
stateVersion advanced by exactly one
every emitted withdrawal has a unique, recorded settlementID
```

On failure the transition must return the **input** state bytes unchanged plus a non-empty `Error`, so
a violated invariant can never be committed. This is cheap, deterministic, and would have caught
DEMO-01, DEMO-02, DEMO-06, DEMO-07 and DEMO-08 at the first test run.

### A3. Make the guest state machine total and fail-closed

The demo's error handling is inconsistent: `ProcessDeposit` checks overflow, `ProcessBorrow` does not;
deserialization errors are handled, serialization errors are not; a parse failure returns an error in
one place and dereferences nil in another. The corrected set already states the right posture for
oracles — "all feeds atomically or none" (`18:36-60`) — but never generalizes it to the guest.

Adopt it as a general rule: **every guest transition either fully succeeds or returns the input state
unchanged with an error.** Concretely:
- operate on a deep copy and swap only on success, so no partial mutation can ever be committed;
- forbid `_` on any error return in the `app` package, via lint;
- forbid `panic` and any nil-dereference path; convert malformed state into a returned error
  (DEMO-08a);
- never commit a `nil` or empty `State` (DEMO-06).

This single discipline removes DEMO-06, DEMO-08a and DEMO-09's root-churn as a class, rather than
fixing three instances.

### A4. Separate the trusted delivery surface from the user request surface

`process_request` currently multiplexes three very different trust levels onto one export,
distinguished only by an integer: user operations (`requestType == 1`) and full-ledger deanonymization
(`requestType == 2`), with the authenticated risk/settlement path (`TRUSTPROCESS`) specified in the
documents but not represented in the code at all. DEMO-03 is the predictable result.

Restructure so the trust level is encoded in the entry point, not in a parameter:
- **`process_request`** — user operations only. Can never produce a `Report`.
- **`trusted_process`** — the authenticated risk/settlement delivery path from `18:127-161` and
  `12:324,423`. The only route that may commit repayments or liquidations.
- **`authority_request`** — deanonymization and other compliance operations, gated on a committed
  authority key set, a verified signature, an explicit scope and a single-use nonce (DEMO-03 fix).

A caller that reaches the wrong export then fails at the boundary rather than partway through a
handler. This also makes `24-PRIVACY-LEAKAGE-ANALYSIS.md` writable: the leakage surface becomes a
small, enumerable set of exports rather than a switch statement inside one function.

### A5. Make commitments the primary state representation

The demo stores balances as JSON hex strings in a map and re-parses them on every access
(`state.go:12-13,20-21`; `ParseUint256` at eight call sites). That is why discarded parse errors are so
easy to introduce (DEMO-08a), and why `appRoot` does not exist.

Store economic values as `types.Uint256` in memory, serialize once at the boundary, and compute the
five subroots defined in `09` on every commit. Then:
- parse errors become impossible after deserialization, because validation happens once at load
  (DEMO-06's `Validate()`);
- `appRoot` becomes a natural by-product of committing rather than a separate task someone must
  remember;
- the ZK layer has something real to prove against, and SPEC-03's coverage gaps surface as "field not
  present in leaf" test failures instead of silent unprovability.

### A6. Specify the operator trust boundary explicitly

`12:324,423` restrict COMMIT to "authenticated TRUSTPROCESS processing", which means an
operator-controlled path can mutate user debt and emit withdrawals. No document states what that path
may and may not do, and `25-THREAT-MODEL.md` is 1,128 bytes. For a protocol whose central claim is
that a TEE replaces contract trust, this is the most important unstated assumption in the repository.

Write down normatively: the exhaustive list of transitions reachable from `TRUSTPROCESS`; the
invariant that no `TRUSTPROCESS` transition may create value or reduce debt without consuming a
receipt; the requirement that every such transition emits an auditable event bound into `historyRoot`;
and the operator key-management model. Then encode those as A2 invariants, so the boundary is enforced
rather than merely documented.

### A7. Add a negative test suite that encodes this audit

Each finding above has a concrete, cheap regression test. Encoding them prevents recurrence better
than any document change.

| Test | Catches |
|---|---|
| Borrow `2^253` with zero collateral → must fail | DEMO-01 |
| `REPAY` with no receipt → must fail, state unchanged | DEMO-02 |
| `requestType == 2` from a non-authority → nil report | DEMO-03 |
| Deposit of an unregistered token → must fail | DEMO-04 |
| Plain `DEPOSIT` never increases `collateral` | DEMO-05 |
| Empty state string → error, nothing committed | DEMO-06 |
| Replay with a stale nonce → rejected | DEMO-07 |
| Malformed `TotalBorrows` → returned error, not a WASM trap | DEMO-08 |
| `VIEW_BALANCE` returns byte-identical state | DEMO-09 |
| `BORROW` emits no withdrawal | DEMO-10 |
| Max-LTV borrow, advance one accrual chunk, prices flat → **not** liquidatable | SPEC-01 |
| Cross-asset liquidation of `X` USD debt seizes `[X, X(1+bonus)]` USD, all six pairs | SPEC-02 |
| Every `AccountState`/`ReserveState` field appears in a leaf | SPEC-03 |
| Dust position (`currentDebt == 1`) has a defined resolution | SPEC-04 |
| Underwater position: `PREPARE_LIQUIDATION` rejects or uses `maxRepayableAtCollateral` | SPEC-05 |
| Rolling `PREPARED` repay lock does not block `PREPARE_LIQUIDATION` | SPEC-06 |
| Commit after index drift beyond the bound re-derives conservatively | SPEC-07 |
| `maxRiskDelaySeconds` boundary: exact accept, +1 s reject | SPEC-08 |

`29-TESTING-STRATEGY.md` and `28-BENCHMARKING-PLAN.md` already list several of these as pending. They
should be promoted from "planned coverage" to merge-blocking CI gates.

### A8. Fix the document set's structural problems, not just its content

SPEC-01, SPEC-02, SPEC-03, SPEC-08, SPEC-11 and SPEC-12 are all the *same* failure mode: a value or
structure defined in one document and contradicted, restated differently, or omitted in another. The
corrected set is 34 files with heavy cross-referencing and no mechanical consistency check.

Three low-cost structural changes would prevent recurrence:

1. **Single-definition rule.** Every parameter, struct and hash preimage is defined normatively in
   exactly one file; all other mentions are links. `10` owns configuration, `08` owns account and
   reserve state, `09` owns commitments, `12` owns transitions.
2. **A CI consistency check** that extracts every `H(NOCT_*_V1 || ...)` preimage, every struct
   definition and every named parameter across all 34 files, and fails on duplicate or conflicting
   definitions, on dangling file references (which would have caught the missing
   `31-GOVERNANCE-MODEL.md` and `32-COMPLIANCE-ARCHITECTURE.md`), and on parameters used but never
   defined (which would have caught `maxRiskDelaySeconds`).
3. **A traceability matrix** from each frozen invariant to the transition(s) that enforce it and the
   test(s) that verify it. `34-IMPLEMENTATION-ROADMAP.md` is already 25 KB of checkboxes; adding
   "enforced by" and "tested by" columns turns it into the audit artifact the project needs, and makes
   gaps like `liquidationThresholdWad` — committed but never used — immediately visible.

### A9. Sequence the work

The corrected set is spec-heavy and the demo is not a credible starting point: fixing DEMO-01 through
DEMO-12 would still leave a protocol with no reserves, no interest, no oracle and no commitments. A
rewrite against the corrected spec is less work than retrofitting it, and the rewrite is currently
blocked by SPEC-10 regardless.

Suggested order, each stage gated on the previous:

1. **Unblock the toolchain** (SPEC-10): complete `TOOLCHAIN-LOCK.md`, resolve the `mulDiv` gap, vendor
   and property-test the arithmetic kernel (A1). Nothing else can be validated until this is done.
2. **Correct the specification** (SPEC-01, 02, 03, 04, 05, 08, 11, 12), then apply A8's consistency
   tooling so the corrections cannot silently regress.
3. **Write the governance and compliance documents** (SPEC-09), since A4's export separation and
   DEMO-03's authority model both depend on them.
4. **Reimplement the guest** against the corrected spec with A2 invariants, A3 fail-closed structure
   and A5 commitments present from the first commit — not retrofitted.
5. **Land the A7 negative test suite as merge-blocking CI** before any deployment, and treat the demo
   as archived with an explicit `README.md` warning that it has no security properties.

---

## 5. Findings summary

| ID | Severity | Component | Statement |
|---|---|---|---|
| SPEC-01 | CRITICAL | `10:48-67,103-118`; `12:204-222,336-350` | `liquidationThresholdWad` is never used; borrow gate and liquidation gate are the same boundary → **zero liquidation buffer** |
| SPEC-02 | CRITICAL | `12:396-409`; `08:128,130`; `33:70` | Undefined decimal domain in cross-asset liquidation → 1e12 unit error → **unbounded collateral theft** |
| SPEC-03 | CRITICAL | `09:45-70` | Account leaf omits nine multi-asset fields; `reserveRoot` has no USDC leaf → ETH/ZEN collateral and all USDC debt are uncommitted and unprovable |
| SPEC-04 | CRITICAL | `12:385-394`; `10:57,66,75`; `32:28-29` | 50% close factor plus mandatory dust rejection, routed to a bad-debt mechanism V1 does not have → permanently unliquidatable positions |
| SPEC-05 | HIGH | `12:402-408,417-419` | `min()` clamp with no profitability guard → underwater positions are unliquidatable; rational liquidators abstain |
| SPEC-06 | HIGH | `12:305,307,309` | Unfunded `PREPARE_REPAY` lock blocks liquidation and is renewable forever → free, permissionless liquidation block |
| SPEC-07 | HIGH | `12:301,338`; `19:88-90` | Stale quote applied at COMMIT with no index-drift bound → free debt cancellation proportional to delay |
| SPEC-08 | HIGH | `18:126,178`; `30:101`; `10:186-220` | `maxRiskDelaySeconds` has no frozen value and is absent from `configCommitment` → the only freshness bound is unparameterized and unmonitored |
| SPEC-09 | HIGH | `IMPLEMENTATION_GUIDE.md:69-70`; `24`–`26`, `31` | No governance, pause or upgrade model; two cited architecture files do not exist; four security documents are ~1 KB stubs |
| SPEC-10 | MEDIUM *(blocking)* | `TOOLCHAIN-LOCK.md`; `vela-common-go v0.2.0` | Pinned SDK has no U256×U256 multiply, no public division, no `mulDiv*`, and `Withdrawal` has no ID → V1's mandated arithmetic is unimplementable; all 17 toolchain rows are `TODO` |
| SPEC-11 | MEDIUM | `08:158-168` vs `09:114-139` | Two incompatible global-state structures; File 08's lacks `velaApplicationID`/`chainID`, making `09:139`'s replay defense impossible |
| SPEC-12 | MEDIUM | `09:76-84`; `08:126-127` | Operation leaf has one `assetID` and cannot bind the `(debtAsset, collateralAsset)` pair → cross-asset seizures are unbound |
| SPEC-13 | LOW | `NOCTFINANCE_V1_ENGINEERING_REVIEW.md` | 1,947-byte review truncated mid-finding; two of three announced CRITICAL items are lost |
| SPEC-14 | LOW | `novaw-linux.zip` | 9-byte placeholder containing "Not Found"; the matching toolchain row is `TODO` |
| DEMO-01 | CRITICAL | `app/lending.go:106-115,232-243` | `Mul64` discards overflow → the solvency check is modular → **unlimited borrowing against zero collateral** |
| DEMO-02 | CRITICAL | `app/lending.go:157-207`; `app/operations.go:174-190` | `REPAY` cancels debt from an unauthenticated JSON field and credits nothing → **free debt erasure** plus value destruction |
| DEMO-03 | CRITICAL | `app/operations.go:116-118,253-292` | `requestType == 2` dumps the entire address→balance ledger to any caller, emitting no event |
| DEMO-04 | HIGH | all of `app/` | No interest, reserves, oracle, prices or asset dimension; `token` ignored; borrows unconstrained by liquidity |
| DEMO-05 | HIGH | `app/lending.go:26-80,209-283` | Deposits credit `collateral` directly; no `cash` bucket and no `SUPPLY`/`UNSUPPLY` → "deposit is not supply" is absent |
| DEMO-06 | HIGH | `app/state.go:41-57` | Empty or `{}` state silently yields a fresh ledger with a hardcoded 200% ratio → total loss; chains with discarded `Serialize()` errors |
| DEMO-07 | HIGH | `app/state.go:10-23`; `app/operations.go` | Nonce incremented but never verified; no `appId`/`chainID`/`schemaVersion` binding → no replay protection at any of `23`'s seven domains |
| DEMO-08 | HIGH | `app/lending.go:121-124,183-186,249-252` | Discarded parse errors → nil dereference → WASM trap; discarded overflow flags → wrapped aggregate counters |
| DEMO-09 | MEDIUM | `app/operations.go:208-210`; `app/state.go:59-74` | "No state change for view" is false: `GetOrCreateAccount` writes and the pointer is committed → root churn plus unbounded free state growth |
| DEMO-10 | MEDIUM | `app/lending.go:144-154,272-282` | Borrow emits a native withdrawal (T05/T06 merged) with a zero `TokenAddress` and no settlement ID |
| DEMO-11 | MEDIUM | `app/lending.go:64-303`; `app/operations.go:278` | All marshal errors discarded; nonce emitted as `"timestamp"`; every event shares the zero subtype; comments claim absent encryption |
| DEMO-12 | LOW | `test-client.ts:15`; `deploy.js:6`; `demo-tx.js:6` | Well-known Anvil account #0 private key hardcoded in three committed scripts, including the deployer |

**Counts.** 4 CRITICAL spec + 3 CRITICAL demo = **7 CRITICAL**; 5 HIGH spec + 5 HIGH demo =
**10 HIGH**; 3 MEDIUM spec (one of them blocking) + 3 MEDIUM demo = **6 MEDIUM**; 2 LOW spec + 1 LOW
demo = **3 LOW**. **26 findings total** (14 spec, 12 demo).

The three demo CRITICALs are each independently sufficient to drain the application, and each is
reachable by an unprivileged caller in a single request. The four spec CRITICALs are not exploitable
today only because no implementation exists — and SPEC-10 is the reason none can yet exist.

---

## 6. Scope limitations and what could not be verified

Stated plainly, so no reader over-trusts the conclusions above.

1. **Vela runtime behaviour is assumed, not verified.** The host's handling of `ProcessResult.State`,
   `Withdrawals`, `PlainEvent` confidentiality, `Report` access control, fuel accounting, and the
   semantics of a zero `TokenAddress` are not documented in this repository and could not be tested.
   DEMO-03's severity, DEMO-10 point 2 and DEMO-11's encryption question all depend on these
   properties. They are assessed here under the conservative assumption that the host provides no
   guarantee the guest has not explicitly established — which is the assumption a TEE guest should
   make in any case.
2. **Custody and settlement contracts do not exist here.** `OracleAdapter`, `NoctTrigger`, the
   escrow/trigger path, `ProcessorEndpoint` integration and all EVM contracts are specification only.
   `EVM_SMART_CONTRACT_AUDIT.md` in this directory reviewed a prior design, not shipped code. No
   Solidity, Rust, Noir or Circom source exists anywhere in the repository (verified by recursive
   enumeration).
3. **The ZK layer is entirely unimplemented.** Files 13, 14 and 15 specify UltraHonk circuits,
   Barretenberg and zkVerify integration. No circuit, witness generator, verifier contract or proof
   exists, and `TOOLCHAIN-LOCK.md` pins none of the required versions. SPEC-03's impact is therefore
   assessed against the *specified* proof obligations, not against a working circuit.
4. **No dynamic testing was performed.** The demo was not built or executed: it requires a TinyGo WASM
   toolchain and a running Vela host, neither of which `TOOLCHAIN-LOCK.md` pins. All demo findings come
   from static source analysis with exact line citations. Every simulation in this report is a
   hand-executed trace against the source, and the arithmetic in DEMO-01 and SPEC-02 is exact modular
   arithmetic that can be checked independently.
5. **Economic parameter adequacy was not assessed.** Whether `liquidationBonusWad` at 5%/8%/10%, the
   utilization curve or the base rates are *correctly sized* is a quantitative question requiring
   market modelling outside this scope; `PROTOCOL_ECONOMICS_AUDIT.md` covers the earlier design.
   SPEC-01 and SPEC-04 concern the parameters' *structural* role, not their values.
6. **The truncated prior review could not be recovered.** `NOCTFINANCE_V1_ENGINEERING_REVIEW.md`
   announces three CRITICAL findings and delivers one partial (SPEC-13). The two lost findings may
   overlap with, or contradict, the findings above; that is unknowable from the repository.

**Overall conclusion.** The corrected architecture set is a substantial improvement over its
predecessor, and several of its choices — receipt-driven debt, an authenticated non-host clock,
fail-closed oracles, layered replay domains, and an honest refusal to claim atomicity — are genuinely
good design. But it is not implementable or deployable as frozen. It contains four CRITICAL defects
that are individually fund-losing, the most severe of which (SPEC-02) permits unbounded collateral
theft through the headline multi-asset feature; its mandated arithmetic is not expressible in its own
pinned dependency (SPEC-10); and its commitment scheme does not cover two of its three assets
(SPEC-03). The sole executable artifact implements essentially none of the corrected design and is
independently exploitable in three CRITICAL ways.

The path forward is A9's sequence: unblock the toolchain, correct the specification and put mechanical
consistency checks around it, write the missing governance and compliance documents, then reimplement
the guest with invariants, fail-closed structure and commitments present from the first commit — and
treat the current demo as archived rather than as a foundation.
