# 00. Audit Remediation Traceability Matrix (SSOT Change Control)

**Status:** Normative change-control record for the V1 architecture set.
**Source of findings:** `NOCT-FINANCE-AUDIT-V1/V1-CORRECTED-SPEC-AND-DEMO-AUDIT.md`
(26 findings: 7 CRITICAL, 10 HIGH, 6 MEDIUM, 3 LOW).

This file is the impact map required before any specification edit. Every row states the finding,
the exact target file and section, and the technical amendment applied. A row closes only when the
amendment is present in the target file **and** every cross-reference in its "Also synchronized"
column has been updated.

Two audit findings were **re-scoped during remediation** after re-reading the frozen text. Both
re-scopes are recorded here rather than silently absorbed, because they change the required fix.

---

## Corrections to the audit findings themselves

### C-1. SPEC-02 — remediation confirms the audit's Reading B; no correction to the finding

An earlier draft of this matrix claimed the audit had mis-diagnosed SPEC-02 as a "`1e12` unit error"
in File 12's conversion formula. **That claim was wrong and is withdrawn.** The audit
(`V1-CORRECTED-SPEC-AND-DEMO-AUDIT.md:372-417`) explicitly analysed *both* possible readings and
reached the correct conclusion on its own:

- **Reading A** (internal accounting in native units) — the `min()` at `12:408` compares across a
  `1e12` scale gap.
- **Reading B** (internal accounting in `AmountWad`, as `08:128,130` states) — the conversion is
  internally consistent, but the `1e12` error **moves to the custody boundary**, because
  `12:437` emits a WAD quantity as `Withdrawal.Amount` while Vela custody moves native ERC-20 units
  (`types.Withdrawal.Amount` is `*Uint256`, `vela-common-go v0.2.0/wasm/types/common.go:22-26`), and
  symmetrically `12:389` compares a WAD `maxPayment` against the native `paymentAmount` the escrow
  actually collected.

The remediation adopts **Reading B** and closes the boundary the audit identified: File 08 now defines
`quantum`, `nativeToWad`, `wadToNative` and `quantizeDown` normatively, File 10 freezes
`nativeDecimals`, File 11 states the custody equation's unit domain, and File 12 quantizes
`collateralToWithdraw` at preparation. `33:68-70` no longer defers non-18-decimal assets to the
future while V1 ships USDC.

**Lesson recorded for process, not for the spec:** this matrix was drafted against a stale cached copy
of the audit (955 lines) rather than the current file (2,822 lines). Every claim in this matrix must be
re-verified against the file on disk before it is relied upon.


### C-2. SPEC-10 row count

The audit states "all 17 rows `TODO`" at `:1141`, "all 17 rows set to `TODO`" at `:1194`, and "all 17
toolchain rows are `TODO`" in the summary table at `:2748`. The file's table body
(`TOOLCHAIN-LOCK.md:7-22`, header at `:5`, separator at `:6`) contains **16** data rows. The count is
off by one in all three places. Corrected to 16 in this matrix and in `TOOLCHAIN-LOCK.md`; the finding
itself is unaffected.

---

## Defect status re-verified against the audit on disk

Three defects were re-examined during remediation. **Only N-2 is genuinely new**; N-1 and N-3 were
already reported by the audit under SPEC-03 (`:100-101`, `:509`, `:518`, `:2741`) and are recorded
here as confirmations, not discoveries. An earlier draft of this matrix mislabelled all three as new.

### N-1. `reserveRoot` does not commit the USDC reserve — CRITICAL — *already in audit (SPEC-03)*

`09:62` reads "Each **ZEN or ETH** reserve leaf is:" and `09:70` reads "The root includes **both**
supported assets in canonical asset-ID order." V1 has three reserves (`08:95`, `11:41-44`,
`10:34`). With `AssetID{USDC=0, ETH=1, ZEN=2}` (`08:41-45`) the committed set is `{1,2}`; **USDC
reserve state — `availableLiquidity`, `totalScaledDebt`, `borrowIndex`, `lastAccrualTimestamp` — is
unreachable from `reserveRoot` and therefore from `appRoot`**, violating `09:141`. Every USDC
invariant in `11:150-159` and `12:482-486` is unprovable.

Same class as SPEC-03 but in a different leaf, and independently fund-losing: uncommitted
`totalScaledDebt[USDC]` cannot be constrained by `08:191` (invariant 1).

### N-2. Files 19 and 31 still describe a two-asset protocol — HIGH — *genuinely new*

- `19:9` — "one lazy borrow index per **ZEN and ETH** reserve"
- `19:158` — "For a risk check involving both **ZEN and ETH** debt, accrue both reserves"
- `31:30` — "controlled Noct **ZEN/ETH** reserves"

Residue from the pre-correction single-collateral design. `19:158` is load-bearing: read literally
it instructs implementers **not** to accrue the USDC reserve before a USDC risk check, breaking
`12:228` and `12:363`.

### N-3. `09:52-55` account leaf is the pre-correction single-collateral leaf — *already in audit (SPEC-03)*

The leaf commits `cashUSDC` and `collateralUSDC` only, `borrowedZEN/ETH` and `scaledDebtZEN/ETH`
only, `debtLockZEN/ETH` and `collateralLockUSDC` only. Against `08:52-63` (all four maps keyed by
`AssetID` over three assets) exactly **nine** fields are missing, matching the audit's count:

| Field family | Committed | Missing |
|---|---|---|
| `cash` | USDC | ETH, ZEN |
| `collateral` | USDC | ETH, ZEN |
| `borrowed` | ZEN, ETH | USDC |
| `scaledDebt` | ZEN, ETH | USDC |
| `debtLock` | ZEN, ETH | USDC |
| `collateralLock` | USDC | ETH, ZEN |

Consequence: **all USDC debt is uncommitted**, so `08:191` is unverifiable for USDC and a proof
cannot distinguish a zero-USDC-debt account from a large one.

### N-4. `IMPLEMENTATION_GUIDE.md` cites six non-existent files, not two — HIGH — *extends SPEC-09*

The audit's SPEC-09 (`:1045-1061`) correctly identifies that `IMPLEMENTATION_GUIDE.md:69-70` points at
`31-GOVERNANCE-MODEL.md` and `32-COMPLIANCE-ARCHITECTURE.md`, neither of which exists — the substantive
point being that V1 has **no governance, pause or upgrade model at all**.

Verification against the directory found **four further** broken citations in the same list, which the
audit did not enumerate:

| Cited in `IMPLEMENTATION_GUIDE.md` | Does not exist | Actual file |
|---|---|---|
| `01-SYSTEM-OVERVIEW.md` | ✓ | `01-EXECUTIVE-SUMMARY.md` |
| `04-PRIVACY-MODEL.md` | ✓ | `05-PRIVACY-MODEL.md` (`04` is `HORIZON-ARCHITECTURE`) |
| `05-SECURITY-MODEL.md` | ✓ | `26-SECURITY-MODEL.md` (`05` is `PRIVACY-MODEL`) |
| `26-SECURITY-REVIEW-CHECKLIST.md` | ✓ | `26-SECURITY-MODEL.md` — no separate checklist exists |

`IMPLEMENTATION_GUIDE.md:26` also names a `maxLTV` parameter that does not exist in File 10; the real
parameter is `collateralFactorWad`. Notably, that same line describes the **correct two-gate model**
("risk thresholds using `maxLTV` for borrow/release and liquidation threshold only for liquidation"),
which is evidence that SPEC-01's collapsed boundary was a **regression from the intended design**, not
a deliberate simplification.

All six citations, the `maxLTV` name and the two-asset residue at `IMPLEMENTATION_GUIDE.md:80`
(`scaledDebtZEN`/`scaledDebtETH`) are corrected in that file. The absent governance and compliance
documents remain **OPEN**: this remediation records where governance semantics are currently
distributed (Files 09, 10, 12, 33) rather than inventing a governance model.

---

## Traceability matrix

| ID | Sev | Target file | Target section | Amendment | Also synchronized |
|---|---|---|---|---|---|
| SPEC-01 | CRIT | `10`, `12`, `11`, `32` | `10:103-120`; `12:102-139`, `12:210`, `12:231`, `12:364`, `12:491-494`; `11:62` | Split the single boundary into two gates: an LTV gate on `collateralFactorWad` for borrow/release, and a liquidation gate on `liquidationThresholdWad`. Define `thresholdCollateralUsd`; make `healthFactor` threshold-based. | `08:199`, `29`, `34` |
| SPEC-02 | CRIT | `08`, `11`, `12`, `33` | `08:21-36` (new normative conversion), `11:96-105`, `12:396-409`, `33:68-70` | Define `nativeToWad`/`wadToNative` with per-asset `decimals`, both rounding directions and dust ownership. Remove USDC from the "future precision" extension. | `17`, `18:54`, `21` |
| SPEC-03 | CRIT | `09` | `09:45-58`, `09:60-70` | Rewrite the account leaf over all three assets for all six field families; rewrite the reserve leaf to cover all three reserves. | `08:52-63`, `08:86-92` |
| SPEC-04 | CRIT | `12`, `32`, `10` | `12:383-394`, `32:28-29`, `10:84` | Add `minLiquidationDebtUsdWad`; route dust below it to a specified V1 bad-debt path (protocol absorption into `writtenOffDebtUsd` / `protocolBadDebtUsd`) instead of unspecified "explicit bad-debt handling". | `11:148-163`, `20` |
| SPEC-05 | HIGH | `12` | `12:402-411` | Add a profitability guard so an underwater position is either seized within bounds or routed to bad debt; never emit a value-destroying seizure. | `20`, `32` |
| SPEC-06 | HIGH | `12` | `12:279-309` | Bound the `PREPARE_REPAY` lock: cap concurrent locks per account, make the lock yield to liquidation once the account is liquidatable, and forbid immediate re-prepare after expiry. | `21`, `22`, `23` |
| SPEC-07 | HIGH | `12`, `19` | `12:322-340`, `19:158` | Bound index drift at COMMIT: reject and force re-prepare when `borrowIndex` has advanced beyond `maxQuoteIndexDriftRay`; re-derive the scaled reduction from the captured payment. | `10:186-220`, `22` |
| SPEC-08 | HIGH | `10`, `18` | `10:156-165`, `10:186-220`, `18:178` | Freeze `maxRiskDelaySeconds = 120`; add it to the `configCommitment` field order; state its enforcement point. | `30:101`, `31` |
| SPEC-09 | HIGH | `24`, `25`, `26`, `31`, `IMPLEMENTATION_GUIDE.md` | whole files | Expand the four ~1 KB stubs to implementation-ready specifications; correct the two non-existent file citations. | `README.md` |
| SPEC-10 | MED (blocking) | `TOOLCHAIN-LOCK.md`, `08`, `19` | whole file | Replace all 16 `TODO` rows with values verified in-repo; add a normative arithmetic-kernel section stating the exact required U256 surface and the vendoring requirement. | `11:27`, `12:73` |
| SPEC-11 | MED | `08`, `09` | `08:158-171`, `09:114-141` | Designate `GlobalRootStateV1` the single normative global structure; redefine `GlobalState` as a derived view with identical field names, adding `velaApplicationID` and `chainID`. | `09:147-164`, `23` |
| SPEC-12 | MED | `09` | `09:72-86` | Replace the single `assetID` in the operation leaf with `debtAssetID` and `collateralAssetID`. | `08:121-136` |
| SPEC-13 | LOW | `NOCTFINANCE_V1_ENGINEERING_REVIEW.md` | whole file | Mark the truncation explicitly and enumerate the two lost findings as OPEN, so no reader assumes they were resolved. | — |
| SPEC-14 | LOW | `TOOLCHAIN-LOCK.md` | Vela Nova row | Record `novaw-linux.zip` as a 9-byte placeholder and make the row a hard CI gate. | `31:33-44` |
| N-1 | CRIT | `09` | `09:60-70` | Reserve leaf covers all three reserves. *Already in audit under SPEC-03.* | `08:95`, `11:41-44` |
| N-2 | HIGH | `19`, `31` | `19:9`, `19:158`, `31:30` | Generalize every two-asset statement to all three assets. *Genuinely new.* | `08:95`, `12:460-462` |
| N-3 | — | `09` | `09:45-58` | Covered by the SPEC-03 row; confirms the audit's nine-field count exactly. *Already in audit.* | — |
| N-4 | HIGH | `IMPLEMENTATION_GUIDE.md` | `:26`, `:27`, `:58-72`, `:80` | Correct all six broken citations, the non-existent `maxLTV` name, and the `scaledDebtZEN/ETH` residue; record that no governance/compliance document exists rather than inventing one. *Extends SPEC-09.* | `README.md`, `00` this file |

Demo findings `DEMO-01`…`DEMO-12` target `noct-demo-wasm/` Go and TypeScript sources, not this
Markdown set. They are tracked in the audit report and are out of scope for this documentation
convergence, except that `DEMO-01` is the reason the SPEC-10 arithmetic-kernel section is normative.

---

## Verification gates

A remediation is complete only when all of the following hold mechanically:

1. `liquidationThresholdWad` appears in at least one executable formula in File 12 (SPEC-01).
2. No file states or implies a two-asset reserve set (N-1, N-2).
3. Every field of `PrivateAccount` and `ReserveState` is reachable from `appRoot` (SPEC-03, N-1).
4. Every asset amount crossing a custody boundary names its decimal domain (SPEC-02).
5. `maxRiskDelaySeconds` has a frozen value and appears in `configCommitment` (SPEC-08).
6. `TOOLCHAIN-LOCK.md` contains zero `TODO` cells (SPEC-10, SPEC-14).
7. The borrow gate and the liquidation gate are provably distinct inequalities (SPEC-01).

