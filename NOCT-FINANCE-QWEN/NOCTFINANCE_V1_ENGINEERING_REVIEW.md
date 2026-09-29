# NoctFinance V1 — Engineering Review & System Soundness Analysis

**Date:** 2026-09-23  
**Reviewer:** Claude Code Engineering Review  
**Scope:** Architecture soundness, multi-asset extension analysis, critical bug identification

---

## Executive Summary

NoctFinance V1 demonstrates **rigorous architectural thinking** with strong separation of concerns (state machine, TEE, ZK, settlement). The dual-phase commit model (prepare → capture → commit) is correct and the numeric model (scaled debt, U256, rounding) is conservative.

**However, 3 CRITICAL issues block mainnet deployment:**
1. Oracle freshness DoS attack (5-minute staleness blocks all operations)
2. Liquidation close factor dust trap (positions become unliquidatable)
3. Payment capture trap (no refund escape hatch after capture)

**Verdict:** Sound for testnet with documented risks. Requires fixes before mainnet.

---

## CRITICAL ISSUES

### CRITICAL-1: Oracle Freshness DoS Attack

**Files:** 10-PROTOCOL-CONFIGURATION.md:127-134, 12-COMPLETE-STATE-MACHINE.md:170

**Issue:** `maxOracleStalenessSeconds: 300` (5 minutes) blocks ALL risk-sensitive operations (borrow, collateral release, liquidation prep) when oracle is stale.

**Attack Scenario:**
```text
1. Oracle provider goes down for 6 minutes (network issue, AWS outage, etc.)
2. ALL users cannot: borrow, release collateral, or prepare liquidations
3. Users CAN still: deposit, supply, repay, commit prepared liquidations
4. Market crashes 20% during oracle outage → positions become underwater
5. When oracle returns, mass liquidation cascade with no ability for users to add collateral
```

**Root Cause:** Single point of failure in price feed + no emergency collateral operations.

**Impact:**
- Complete protocol freeze during oracle downtime
- Users cannot protect positions during volatility
- Liquidators cannot prepare new liquidations (but can commit already-prepared ones)

**Recommendation:**

> ## ⚠ THIS FILE IS TRUNCATED — DO NOT TREAT IT AS COMPLETE (SPEC-13)
>
> This document ends mid-sentence, immediately after the `**Recommendation:**` heading of
> `CRITICAL-1`. The recommendation text was never written to disk. The file is 46 lines long and
> stops here.
>
> The Executive Summary at lines 13-16 announces **three** blocking CRITICAL issues. Only the first
> is present, and it is incomplete. The detailed analysis for the other two was **lost** and is not
> recoverable from this repository:
>
> | Announced finding | Detail present? | Status |
> |---|---|---|
> | `CRITICAL-1` Oracle freshness DoS attack | Partial — issue and impact only; the recommendation is missing | **OPEN — recommendation lost** |
> | `CRITICAL-2` Liquidation close factor dust trap (positions become unliquidatable) | **None** | **OPEN — entire finding lost** |
> | `CRITICAL-3` Payment capture trap (no refund escape hatch after capture) | **None** | **OPEN — entire finding lost** |
>
> Nothing beyond `CRITICAL-1`'s issue statement may be cited from this file. In particular, this file
> MUST NOT be used as evidence that any issue was reviewed and resolved, and its verdict
> ("Sound for testnet with documented risks") MUST NOT be quoted without this notice, because the
> risks it refers to are not documented here.
>
> ### Where these concerns are addressed instead
>
> The independent audit in `NOCT-FINANCE-AUDIT-V1/V1-CORRECTED-SPEC-AND-DEMO-AUDIT.md` re-derived
> overlapping findings from the specification text itself. The mapping below is a **reconstruction by
> subject matter**, not a recovery of the lost original text, and the two must not be conflated:
>
> - `CRITICAL-1` (oracle staleness blocking operations) relates to `SPEC-08`. `maxRiskDelaySeconds` is
>   now frozen at 120s and committed (`10`, `18:178`), and `18:183` already permits captured-payment
>   commits to proceed without a fresh oracle, so a stale feed blocks new risk decisions but does not
>   strand captured funds. The DoS concern about users being unable to *add collateral* during an
>   outage remains **OPEN** and is not resolved by the current specification.
> - `CRITICAL-2` (close-factor dust trap) is `SPEC-04`, now remediated by `minLiquidationDebtUsdWad`,
>   close-factor escalation, and the new `T13 ABSORB_BAD_DEBT` transition (`12`, `32`).
> - `CRITICAL-3` (payment capture trap) relates to `SPEC-06` and `SPEC-07`. Captured payments are still
>   never timeout-refunded, but the index-drift revert path in `T08`/`T10` now releases locks while
>   **preserving the captured receipt unconsumed** for re-quoting, and File 22 governs its recovery.
>
> Action required: obtain or regenerate the full original review, or formally supersede this file with
> the audit report. Until then this document is a partial artifact.

