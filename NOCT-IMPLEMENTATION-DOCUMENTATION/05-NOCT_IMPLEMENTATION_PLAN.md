# Noct Finance — Implementation Plan

> **SUPERSEDED — DO NOT IMPLEMENT.** Use corrected File 34 and the referenced specifications in `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/`. This historical plan contains outdated build order, settlement terminology, and acceptance assumptions.

**Version:** 1.0-architecture-freeze  
**Status:** Build plan for the implementation coding agent.

---

# 1. Principle

Build in vertical slices.

Do not implement the entire protocol first and test it later.

Every slice must include:

```text
state
→ transition
→ proof/authorization
→ Vela execution
→ settlement
→ failure path
→ tests
→ performance measurement
```

---

# 2. Phase 0 — Repository and baseline

### Tasks

- establish repository structure;
- pin toolchain versions;
- import/adapt Vela Starter Kit patterns;
- establish Noct WASM application;
- establish local Vela environment;
- establish Horizon testnet configuration;
- establish CI;
- establish test framework.

### Acceptance

A minimal Noct WASM app can execute a deterministic request locally.

---

# 3. Phase 1 — Private account state

Implement:

```text
AccountState
identityCommitment
accountNonce
cashUSDC
collateralUSDC
borrowedZEN
borrowedETH
debtZEN
debtETH
stateVersion
stateCommitment
pendingSettlement
```

### Tests

- serialization;
- commitment stability;
- state-version increments;
- invalid state rejection;
- no negative balances.

---

# 4. Phase 2 — Deposit USDC

Implement:

```text
DEPOSIT_USDC
```

Acceptance:

```text
deposit 10
→ cashUSDC = 10

deposit 5
→ cashUSDC = 15
```

No supply should occur automatically.

Also test:

```text
deposit
→ withdraw cash
```

without supplying.

---

# 5. Phase 3 — Supply USDC

Implement:

```text
SUPPLY_USDC
```

Acceptance:

```text
cashUSDC = 15
supply 13
→ cashUSDC = 2
→ collateralUSDC = 13
```

Test that the user cannot supply more than cash.

---

# 6. Phase 4 — Borrow

Implement:

```text
BORROW_ZEN
BORROW_ETH
```

Borrowing must:

1. validate collateral;
2. validate risk parameters;
3. validate liquidity;
4. create debt;
5. credit private borrowed balance;
6. update state commitment;
7. preserve privacy.

Do not automatically withdraw the borrowed asset.

---

# 7. Phase 5 — Borrowed-asset withdrawal

Implement:

```text
WITHDRAW_BORROWED_ASSET
```

Use the lock/settle/unlock model.

Test:

- success;
- failure;
- retry;
- duplicate request;
- stale request;
- insufficient borrowed balance.

---

# 8. Phase 6 — Repay

Implement:

```text
REPAY_ZEN
REPAY_ETH
```

Before coding overpayment behavior, freeze the exact policy.

Test:

- full repayment;
- partial repayment;
- zero repayment rejection;
- invalid asset;
- stale state;
- replay.

---

# 9. Phase 7 — Collateral release

Implement:

```text
RELEASE_COLLATERAL
```

Required behavior:

```text
collateralUSDC -= amount
cashUSDC += amount
```

It must not directly send the released amount to the external wallet.

Test that risk constraints are respected after release.

---

# 10. Phase 8 — Cash withdrawal

Implement:

```text
WITHDRAW_CASH_USDC
```

Required:

```text
amount <= cashUSDC
```

Use lock/settle/unlock.

---

# 11. Phase 9 — Liquidation

Liquidation requires a dedicated implementation pass.

Before implementation freeze:

- oracle source;
- price freshness;
- liquidation threshold;
- liquidation bonus;
- close factor;
- liquidator settlement;
- private proof;
- partial liquidation;
- bad-debt handling.

Do not invent these parameters.

---

# 12. Phase 10 — ZK benchmark harness

This phase must occur before full ZK integration.

Benchmark:

```text
witness generation
UltraHonk proving
zkVerify verification
aggregation
receipt availability
Vela transition
Horizon settlement
```

Record:

```text
p50
p95
p99
max
CPU
RAM
proof size
circuit size
failure rate
```

---

# 13. Phase 11 — ZK circuits

Implement focused circuits:

```text
Supply
Borrow
Repay
ReleaseCollateral
Withdraw
Liquidation
```

Each circuit gets:

- fixed version;
- fixed VK;
- fixed public-input schema;
- tests;
- negative tests;
- performance benchmark.

---

# 14. Phase 12 — zkVerify

Integrate:

```text
UltraHonk
→ zkVerify
→ verification result
```

Then benchmark:

```text
verification-only
vs
verification + aggregation receipt
```

Do not assume aggregation is faster or slower without measurements.

---

# 15. Phase 13 — Vela integration

Connect:

```text
Noct client
→ request
→ Vela Manager
→ Executor
→ Noct WASM
→ state update
→ settlement
```

Test all failure/retry paths.

---

# 16. Phase 14 — Horizon integration

Implement and test:

- asset custody;
- application registration;
- Noct state commitments;
- proof/receipt references;
- external settlement;
- event reconciliation;
- deployment security.

Do not expose private position data in public contract storage/events.

---

# 17. Phase 15 — End-to-end test suite

Minimum scenarios:

### Deposit

```text
10 USDC → cash = 10
5 USDC → cash = 15
```

### Deposit then withdraw without supply

```text
15 cash
withdraw 2
→ cash = 13
```

### Deposit → supply

```text
15 cash
supply 13
→ cash = 2
→ collateral = 13
```

### Borrow

```text
collateral = 100
borrow ZEN
→ debt increases
→ borrowedZEN increases
```

### Borrow then withdraw

```text
borrowedZEN = 20
withdraw 20
→ borrowedZEN = 0
→ debt unchanged
```

### Release collateral

```text
cash = 5
collateral = 100
release 20
→ cash = 25
→ collateral = 80
```

### Failed settlement

Private balance must recover.

### Replay

Same transition cannot execute twice.

### Stale state

Old state root cannot authorize a new transition.

---

# 18. Phase 16 — Security testing

Required categories:

- authorization bypass;
- replay;
- double spend;
- stale state;
- malformed proof;
- wrong VK;
- wrong application ID;
- wrong asset;
- wrong chain;
- invalid state root;
- overflow/underflow;
- precision/rounding;
- oracle manipulation;
- liquidation edge cases;
- settlement failure;
- facilitator abuse;
- denial of service.

---

# 19. Phase 17 — Performance testing

Run realistic workloads.

At minimum:

```text
1 user
10 users
100 users
1,000 synthetic transitions
```

Measure:

- throughput;
- proof generation;
- verification;
- Vela processing;
- Horizon confirmation;
- end-to-end latency;
- concurrent prover capacity.

The protocol must not be declared production-ready solely because unit tests pass.

---

# 20. Phase 18 — Testnet readiness

Checklist:

- all frozen transitions implemented;
- no OPEN decision accidentally encoded;
- ZK toolchain pinned;
- VK hashes pinned;
- Vela app identity pinned;
- contracts audited internally;
- state migration strategy defined;
- failure/recovery tested;
- benchmark report attached;
- privacy review complete;
- monitoring enabled.

---

# 21. Implementation agent stop conditions

The coding agent MUST stop and flag an architecture issue if:

1. a required protocol rule is missing;
2. two architecture documents conflict;
3. a state transition requires an undefined field;
4. a public input would reveal a private position;
5. Vela cannot support the assumed operation;
6. zkVerify cannot support the assumed proof;
7. a circuit exceeds supported limits;
8. an operation cannot satisfy the security invariant;
9. external settlement can double-spend private state;
10. a performance bottleneck invalidates the approved critical path.

The agent MUST NOT solve these by silently inventing protocol rules.

---

# 22. Final build order

```text
STATE
  ↓
DEPOSIT
  ↓
SUPPLY
  ↓
BORROW
  ↓
BORROWED-ASSET WITHDRAWAL
  ↓
REPAY
  ↓
COLLATERAL RELEASE
  ↓
CASH WITHDRAWAL
  ↓
LIQUIDATION
  ↓
ZK BENCHMARK
  ↓
ZK CIRCUITS
  ↓
zkVerify
  ↓
Vela integration
  ↓
Horizon settlement
  ↓
Security
  ↓
Performance
  ↓
Testnet
```

Do not reorder the critical security dependencies merely to make UI development faster.
