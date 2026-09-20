# 2. Design Objectives

**Status:** Implementation architecture baseline  
**Audience:** Noct engineering team, junior developer, coding agent  
**Normative terms:** MUST = mandatory; MUST NOT = prohibited; SHOULD = recommended; OPEN = unresolved and must not be invented.


## Primary objectives

### Privacy
Prevent an observer from reliably linking a wallet to its private Noct position and learning:
- collateral;
- debt;
- LTV;
- health factor;
- cash balance;
- borrowed balance;
- private transaction history.

### Security
Every state-changing transition MUST be:
- authenticated;
- deterministic;
- versioned;
- replay-protected;
- atomic;
- invariant-preserving.

### Speed
No ZK component may enter a user-facing critical path without measurement. Proof generation is treated as a likely bottleneck and MUST be benchmarked independently from verification.

### Simplicity
V1 excludes:
- multi-collateral;
- permissionless lender liquidity;
- E-mode;
- flash loans;
- credit delegation;
- sophisticated rate curves;
- recursive proofs.

## Engineering priority

```text
correctness → security → privacy → recovery → performance → UX optimization
```

Speed must not be achieved by weakening an invariant.
