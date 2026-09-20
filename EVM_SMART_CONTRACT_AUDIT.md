# Senior EVM & Smart Contract Security Auditor — Decision Package

> **HISTORICAL AUDIT SNAPSHOT.** Preserve the findings, but do not treat proposed contract snippets as the current Vela integration. Corrected custody, `ProcessResult.Withdrawals`, AbstractTrigger, receipt, and replay semantics are normative in `NOCT-FINANCE-V1-ARCHITECTURE-DOCUMENTS-CORRECTED/` Files 09, 11, 12, 17, 21–23, and 30.

**Auditor:** Senior EVM & Smart Contract Security Specialist  
**Protocol:** NoctFinance V1 Confidential Lending  
**Date:** 2026-09-19  
**Scope:** Solidity settlement contracts, custody architecture, attestation enforcement, ERC-20 edge cases, meta-transaction security

---

## Executive Summary

The architecture documents demonstrate strong security awareness with explicit focus on defense-in-depth, but **5 CRITICAL gaps block implementation**:

1. **Custody architecture completely undefined** — no specification of vault contracts, withdrawal authorization, or reserve custody
2. **Attestation enforcement beyond base Vela unspecified** — no custom verification logic defined
3. **ERC-20 edge case handling absent** — fee-on-transfer, rebasing, ERC777 hooks not addressed
4. **Meta-transaction replay protection incomplete** — EIP-712/EIP-2612 security rules stated but not implemented
5. **TRUSTPROCESS trigger flow security undefined** — no specification of proof-to-state binding in smart contracts

**Severity:** 5 CRITICAL, 8 HIGH, 4 MEDIUM priority findings.

---

## Section 1: Custody Architecture

### Current State (File 17-SETTLEMENT-ARCHITECTURE.md)

The architecture describes withdrawal flow:
```text
cashUSDC → lock → Vela withdrawal → wallet
borrowedZEN → lock → Vela withdrawal → wallet
```

**Critical gap identified:** The architecture describes *intent* (lock → settle → consume/unlock) but provides **zero specification** of:
- Smart contract custody vault design (single vault vs per-user escrows)
- Who holds withdrawal authorization (enclave signature? multisig? timelock?)
- Reserve asset custody for ZEN/ETH (File 11 states "Noct-funded reserves" but no custody mechanism)

### File 11-ASSET-RESERVE-MODEL.md Findings

```text
ZENReserve {
  availableLiquidity
  totalDebtPrincipal
  borrowIndex
  lastAccrualTimestamp
}
```

**Problem:** This is an *accounting struct*, not a custody specification. Where are the actual ZEN/ETH tokens held?

Three architecture options exist (none specified):

**Option A: Protocol-Owned Vault**
```solidity
contract NoctReserveVault {
    mapping(address token => uint256 balance) public reserves;
    
    function fundReserve(address token, uint256 amount) external onlyOwner {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        reserves[token] += amount;
    }
    
    function withdrawToUser(address token, address user, uint256 amount, bytes calldata enclaveSignature) 
        external onlyProcessor {
        // Verify enclave authorized this withdrawal
        require(verifyEnclaveSignature(user, token, amount, enclaveSignature));
        reserves[token] -= amount;
        IERC20(token).transfer(user, amount);
    }
}
```

**Option B: Vela Native Settlement** (leverages existing `pendingClaims`)
- Use Vela's built-in settlement mechanism
- File 17 suggests custom lock/unlock may be over-engineering

**Option C: Hybrid** (user deposits via vault, reserves via separate custody)

**CRITICAL DECISION REQUIRED:** Choose custody model before any Solidity implementation.

### Withdrawal Authorization Security

File 26-SECURITY-MODEL.md states:
> "Settlement requires an authorized internal balance."

**Gap:** No specification of *how* smart contracts verify enclave authorization. Three mechanisms possible:

1. **Enclave ECDSA signature** over withdrawal intent
   - Requires on-chain verification of enclave's public key (PCR-pinned)
   - Signature format undefined
   
2. **ZK proof of authorized withdrawal**
   - Proof includes public inputs: `[user, token, amount, withdrawalNonce]`
   - On-chain verifier checks proof before releasing funds
   
3. **TRUSTPROCESS trigger contract**
   - Enclave calls trigger contract via Vela's `trusted_request`
   - Trigger contract executes withdrawal atomically

**Recommendation:** Option 3 (TRUSTPROCESS) is most secure—withdrawal execution is *atomic* with enclave state transition, eliminating window for state/settlement desync.

**CRITICAL:** Current architecture does not specify which mechanism to use.

---

## Section 2: Attestation Enforcement

### Base Vela Security (Files 03, 16)

Vela's `ProcessorEndpoint` enforces:
- Enclave PCR verification (platform + image hash)
- Request signature validation
- Nonce replay protection

**Gap:** No specification of *additional* attestation logic for NoctFinance.

### Application-Level Attestation Requirements

File 26 identifies 7 high-priority audit areas but does not specify on-chain enforcement:

1. **Fixed-point arithmetic** — no on-chain validation that enclave uses correct precision
2. **Commitments** — no on-chain commitment verification (see Section 4)
3. **Replay/version logic** — covered by Vela nonces, but application-level version monotonicity unverified
4. **Withdrawal locks** — no on-chain tracking of locked balances
5. **Oracle** — no on-chain verification of oracle snapshot authenticity (see Section 5)
6. **Liquidation** — no on-chain verification of health factor calculation
7. **Proof-to-state binding** — **CRITICAL GAP** (see Section 4)

**Recommendation:** Define application-level verifier contract:

```solidity
contract NoctStateVerifier {
    // Verify enclave state commitment matches on-chain expectation
    function verifyStateCommitment(bytes32 enclaveCommitment, bytes32 expectedRoot) external view returns (bool);
    
    // Verify oracle snapshot signature
    function verifyOracleSnapshot(OracleSnapshot calldata snapshot, bytes calldata signature) external view returns (bool);
    
    // Verify liquidation is valid (health factor < 1.0)
    function verifyLiquidation(address user, uint256 collateral, uint256 debt, uint256 price) external view returns (bool);
}
```

**CRITICAL:** This verifier interface is completely absent from architecture documents.

---

## Section 3: Classic Vulnerability Audit

### 3.1 Reentrancy

**Risk Level:** HIGH (if using ERC777 or custom tokens with hooks)

File 11 specifies:
- USDC (collateral)
- ZEN (borrow asset)
- ETH (borrow asset, presumably WETH)

**USDC:** No reentrancy risk (standard ERC-20, no hooks)  
**WETH:** Reentrancy risk on `withdraw()` (sends ETH before state update)  
**ZEN:** Unknown token implementation—must audit for hooks

**Mitigation:** Use OpenZeppelin `ReentrancyGuard` on all external functions that transfer tokens:

```solidity
function withdraw(address token, uint256 amount) external nonReentrant {
    // Update state BEFORE transfer
    balances[msg.sender][token] -= amount;
    IERC20(token).transfer(msg.sender, amount);
}
```

**Status:** No reentrancy protection specified in architecture.

### 3.2 Access Control

File 26 states security rules but does not specify roles:

**Required roles:**
- `OWNER` — protocol parameter updates, emergency pause
- `ENCLAVE_PROCESSOR` — execute user transactions
- `RESERVE_MANAGER` — fund/withdraw protocol reserves
- `LIQUIDATOR` — execute liquidations (or permissionless with proof verification?)
- `ORACLE_UPDATER` — submit price snapshots
- `PAUSER` — emergency circuit breaker

**Recommendation:** Use OpenZeppelin `AccessControl` with explicit role definitions.

**CRITICAL GAP:** No role specification in architecture documents.

### 3.3 ERC-20 Edge Cases

**Issue 1: Fee-on-transfer tokens** (e.g., USDT with fees enabled)

```solidity
// VULNERABLE CODE
function deposit(address token, uint256 amount) external {
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    balances[msg.sender][token] += amount; // WRONG if token charges fee
}

// SAFE CODE
function deposit(address token, uint256 amount) external {
    uint256 balanceBefore = IERC20(token).balanceOf(address(this));
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    uint256 balanceAfter = IERC20(token).balanceOf(address(this));
    uint256 actualReceived = balanceAfter - balanceBefore;
    balances[msg.sender][token] += actualReceived;
}
```

**File 11 specifies USDC only** — USDC does not currently charge fees, but contract SHOULD defend against activation.

**Issue 2: Missing return values** (USDT)

Some tokens (notably USDT) do not return `bool` from `transfer()`. Use OpenZeppelin `SafeERC20`:

```solidity
using SafeERC20 for IERC20;

IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
```

**Issue 3: ERC777 hooks**

If any token implements ERC777, the `tokensReceived` hook creates reentrancy risk.

**Recommendation:** Whitelist tokens explicitly, verify no ERC777 interface.

**Issue 4: Rebasing tokens** (e.g., stETH, aTokens)

Rebasing tokens change balance without transfers. **File 11 does not specify rebase handling.**

**Recommendation:** Exclude rebasing tokens from V1 or implement snapshot-based accounting.

**STATUS:** None of these edge cases addressed in architecture documents.

---

## Section 4: Meta-Transaction Security (EIP-712 / EIP-2612)

### Gasless Deposit Flow (from UX audit)

User signs permit → facilitator submits deposit with permit → enclave processes.

**EIP-2612 Permit Security:**

```solidity
function depositWithPermit(
    address token,
    uint256 amount,
    uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) external {
    // Permit signature allows this contract to spend user's tokens
    IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);
    
    // Execute deposit
    IERC20(token).transferFrom(msg.sender, address(this), amount);
    // ... enclave processing
}
```

**Vulnerability: Front-running**

Attacker can observe permit signature in mempool and call `permit()` directly, causing user's intended transaction to revert.

**Mitigation:** Use `try/catch` to handle already-used permits:

```solidity
try IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {
    // Permit succeeded
} catch {
    // Permit already used or invalid—check allowance
    require(IERC20(token).allowance(msg.sender, address(this)) >= amount, "Insufficient allowance");
}
```

**Vulnerability: Signature Malleability**

EIP-2612 does not enforce `s` value range. Attacker can create second valid signature by flipping `s`:

```solidity
s_malleated = secp256k1_n - s
```

**Mitigation:** Use OpenZeppelin `ECDSA.recover()` which enforces low-s values.

**Vulnerability: Replay Attacks**

EIP-712 domain separator must include:
- `chainId` — prevents cross-chain replay
- `verifyingContract` — prevents cross-contract replay
- `version` — prevents replay after contract upgrade

**Status:** File 26 mentions "replay/version logic" as audit priority but provides no implementation guidance.

**Recommendation:** Define explicit EIP-712 domain:

```solidity
bytes32 public constant DOMAIN_TYPEHASH = keccak256(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
);

function _domainSeparator() internal view returns (bytes32) {
    return keccak256(abi.encode(
        DOMAIN_TYPEHASH,
        keccak256(bytes("NoctFinance")),
        keccak256(bytes("1")),
        block.chainid,
        address(this)
    ));
}
```

**CRITICAL:** No EIP-712 specification in architecture documents.

---

## Section 5: TRUSTPROCESS Trigger Flow Security

### File 15-ZKVERIFY-INTEGRATION.md Findings

> "Proof context should bind: app ID, chain ID, circuit version, VK hash, config commitment, state commitment, transition nonce/type."

**Gap:** File 15 specifies *what* to bind but not *how* smart contracts enforce this binding.

### Vela Trigger Contract Pattern (from vela-masterclass)

```go
// WASM exports trusted_request for trigger flow
//export trusted_request
func trusted_request(reqPtr, reqLen uint32) uint64 {
    // Enclave processes state transition
    // Calls external trigger contract
    
    triggerData := EncodeTriggerCall(newStateRoot, proof)
    vela.CallTriggerContract(triggerAddress, triggerData)
}
```

On-chain trigger contract:

```solidity
contract NoctTriggerVerifier {
    function executeTrigger(
        bytes32 newStateRoot,
        bytes calldata zkProof,
        bytes calldata publicInputs
    ) external onlyVelaProcessor {
        // Verify proof
        require(verifier.verify(zkProof, publicInputs), "Invalid proof");
        
        // Extract state binding from public inputs
        (address user, uint256 nonce, bytes32 oldStateRoot) = abi.decode(publicInputs, (address, uint256, bytes32));
        
        // Verify state progression
        require(currentStateRoot == oldStateRoot, "State mismatch");
        require(nonce == userNonces[user] + 1, "Invalid nonce");
        
        // Update state
        currentStateRoot = newStateRoot;
        userNonces[user] = nonce;
    }
}
```

**Critical Security Rule:** Trigger contract MUST verify:
1. Caller is authorized Vela processor (PCR-verified enclave)
2. Proof is valid (UltraHonk/zkVerify verification)
3. Public inputs bind to current state (prevent replay of old proofs)
4. State transition is monotonic (nonce increments)

**Gap:** File 15 describes zkVerify integration but does not specify trigger contract implementation.

**Recommendation:** Define `NoctTriggerVerifier` interface in architecture with explicit security invariants.

---

## Section 6: Contract Invariants

### Proposed On-Chain Invariants

File 26 identifies audit priorities but does not define testable invariants. Recommend:

**Invariant 1: Reserve Solvency**
```solidity
function checkReserveSolvency(address token) public view returns (bool) {
    return IERC20(token).balanceOf(address(reserveVault)) >= getTotalDeposits(token);
}
```

**Invariant 2: Locked Balance Conservation**
```solidity
function checkLockedBalanceInvariant() public view returns (bool) {
    return totalDeposited >= totalWithdrawn + totalLocked;
}
```

**Invariant 3: State Version Monotonicity**
```solidity
function checkStateMonotonicity(address user) public view returns (bool) {
    return userNonces[user] >= previousCheckpoint[user].nonce;
}
```

**Invariant 4: Liquidation Profitability** (economic invariant)
```solidity
function checkLiquidationProfitability(uint256 collateralValue, uint256 debtValue, uint256 bonus) 
    public pure returns (bool) {
    // Liquidator must receive more value than debt paid
    uint256 liquidatorReceives = debtValue + (debtValue * bonus / 10000);
    return liquidatorReceives <= collateralValue;
}
```

**Status:** No on-chain invariant testing specified in architecture.

**Recommendation:** Implement invariant testing in Foundry:

```solidity
// test/invariants/ReserveInvariants.t.sol
contract ReserveInvariantTest is Test {
    function invariant_reserveSolvency() public {
        assertTrue(vault.checkReserveSolvency(USDC));
        assertTrue(vault.checkReserveSolvency(ZEN));
        assertTrue(vault.checkReserveSolvency(WETH));
    }
}
```

---

## Section 7: Oracle Integration Security

### File 18-ORACLE-ARCHITECTURE.md Findings

```text
OracleSnapshot {
  epoch
  timestamp
  usdcPrice
  zenPrice
  ethPrice
  commitment
}
```

**Rules stated:**
- "A borrower/liquidator MUST NOT supply an arbitrary price."
- "Risk-sensitive transitions MUST reject stale oracle data."
- "The exact freshness threshold is configuration."

**Gap:** No specification of *how* contracts verify oracle snapshot authenticity.

### On-Chain Oracle Verification

**Option 1: Signed Snapshots** (Chainlink-style)

```solidity
struct OracleSnapshot {
    uint256 epoch;
    uint256 timestamp;
    uint256 usdcPrice;
    uint256 zenPrice;
    uint256 ethPrice;
    bytes32 commitment;
}

function verifyOracleSnapshot(
    OracleSnapshot calldata snapshot,
    bytes calldata signature
) external view returns (bool) {
    bytes32 messageHash = keccak256(abi.encode(
        snapshot.epoch,
        snapshot.timestamp,
        snapshot.usdcPrice,
        snapshot.zenPrice,
        snapshot.ethPrice
    ));
    
    address signer = ECDSA.recover(messageHash, signature);
    require(signer == trustedOracle, "Invalid oracle signature");
    require(block.timestamp - snapshot.timestamp <= maxStaleness, "Stale price");
    
    return true;
}
```

**Option 2: Chainlink Price Feeds** (direct on-chain)

```solidity
function getLatestPrice(address token) public view returns (uint256) {
    AggregatorV3Interface priceFeed = priceFeeds[token];
    (
        uint80 roundId,
        int256 price,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) = priceFeed.latestRoundData();
    
    require(price > 0, "Invalid price");
    require(updatedAt >= block.timestamp - maxStaleness, "Stale price");
    require(answeredInRound >= roundId, "Stale round");
    
    return uint256(price);
}
```

**Option 3: TWAP Fallback** (manipulation resistance)

```solidity
function getTWAPPrice(address token, uint256 window) public view returns (uint256) {
    uint256 cumulativePrice = 0;
    uint256 samples = 0;
    
    for (uint256 i = 0; i < window; i++) {
        uint256 historicalPrice = getHistoricalPrice(token, block.timestamp - i * 1 hours);
        cumulativePrice += historicalPrice;
        samples++;
    }
    
    return cumulativePrice / samples;
}
```

**CRITICAL:** Architecture does not specify which oracle mechanism to use.

**Recommendation:** Use Option 1 (signed snapshots) for V1 simplicity, with TWAP as future extension (File 33).

---

## Section 8: Critical File Contradictions

### 8.1 Settlement Architecture Overcomplicated

**File 17-SETTLEMENT-ARCHITECTURE.md** proposes custom lock/unlock flow:
```text
available balance → lock amount → pending settlement → success/failure → consume/unlock
```

**File 03-VELA-INTEGRATION-ARCHITECTURE.md** references Vela's native `pendingClaims` mechanism.

**Contradiction:** Why build custom settlement when Vela provides built-in withdrawal handling?

**Recommendation:** Use Vela's native settlement for non-trigger withdrawals, custom flow only for complex liquidations.

### 8.2 Reserve Funding Mechanism Undefined

**File 11-ASSET-RESERVE-MODEL.md** states:
> "The test application is funded by Noct for ZEN and ETH liquidity."

**File 17-SETTLEMENT-ARCHITECTURE.md** describes withdrawal flow but not deposit flow for reserves.

**Critical questions unanswered:**
- How does Noct fund reserves? (Manual transfer? Dedicated funding function?)
- What happens when reserves are exhausted? (Fail-closed? Waiting queue?)
- Can reserves be withdrawn? (Emergency recovery?)

**Recommendation:** Define explicit reserve management interface:

```solidity
contract ReserveManager {
    function fundReserve(address token, uint256 amount) external onlyOwner;
    function withdrawReserve(address token, uint256 amount) external onlyOwner;
    function getReserveBalance(address token) external view returns (uint256);
    function checkExhaustion(address token) external view returns (bool);
}
```

### 8.3 Liquidation Parameters Undefined

**File 20-LIQUIDATION-DISCOVERY.md** describes discovery mechanism but not execution parameters.

**Missing specifications:**
- Liquidation threshold (PROTOCOL_ECONOMICS_AUDIT.md proposes 75%)
- Liquidation bonus (proposes 10%)
- Close factor (proposes 50%)
- Bad-debt waterfall (mentioned but not specified)

**Cross-reference:** PROTOCOL_ECONOMICS_AUDIT.md proposes testnet defaults, but File 20 does not reference them.

**Recommendation:** Freeze liquidation parameters in File 10-PROTOCOL-CONFIGURATION.md before implementing liquidation contracts.

### 8.4 Proof-to-State Binding Unspecified

**File 15-ZKVERIFY-INTEGRATION.md** lists what to bind:
> "app ID, chain ID, circuit version, VK hash, config commitment, state commitment, transition nonce/type."

**File 26-SECURITY-MODEL.md** identifies this as high-priority audit area.

**Gap:** No specification of *how* smart contracts enforce this binding.

**Example implementation needed:**

```solidity
struct ProofContext {
    bytes32 appId;
    uint256 chainId;
    bytes32 circuitVersion;
    bytes32 vkHash;
    bytes32 configCommitment;
    bytes32 stateCommitment;
    uint256 nonce;
    bytes32 transitionType;
}

function verifyProofContext(ProofContext calldata context, bytes calldata proof) 
    external view returns (bool) {
    require(context.chainId == block.chainid, "Wrong chain");
    require(context.vkHash == currentVKHash, "Wrong circuit version");
    require(context.stateCommitment == currentStateRoot, "State mismatch");
    require(context.nonce == expectedNonce, "Invalid nonce");
    
    return ultraHonkVerifier.verify(proof, abi.encode(context));
}
```

**STATUS:** This critical contract interface is completely absent.

---

## Section 9: Recommendations Summary

### CRITICAL (Must Fix Before Implementation)

| ID | Finding | Impact | Recommendation |
|----|---------|--------|----------------|
| C1 | Custody architecture undefined | Blocks all Solidity work | Choose custody model (protocol vault vs Vela native) |
| C2 | Withdrawal authorization unspecified | Insecure withdrawals | Define enclave signature verification or trigger flow |
| C3 | Reserve funding mechanism undefined | Cannot implement borrows | Specify reserve custody contracts |
| C4 | Proof-to-state binding unspecified | ZK proofs not enforceable | Define `ProofContext` struct and on-chain verification |
| C5 | TRUSTPROCESS trigger security undefined | Potential state manipulation | Specify trigger verifier contract with security invariants |

### HIGH Priority (Security Hardening)

| ID | Finding | Impact | Recommendation |
|----|---------|--------|----------------|
| H1 | ERC-20 edge cases unhandled | Fee-on-transfer vulnerability | Use SafeERC20, check actual received amounts |
| H2 | Reentrancy protection absent | Potential theft via ERC777/WETH | Add `nonReentrant` modifier |
| H3 | Access control roles undefined | Unauthorized parameter changes | Define explicit roles with OpenZeppelin AccessControl |
| H4 | Oracle verification unspecified | Malicious price manipulation | Implement signed snapshot verification |
| H5 | EIP-712 domain separator undefined | Cross-chain/contract replay | Define explicit EIP-712 domain with version |
| H6 | Permit front-running unmitigated | DoS gasless deposits | Use try/catch for permit calls |
| H7 | On-chain invariants untested | State corruption undetected | Implement Foundry invariant tests |
| H8 | Liquidation profitability unchecked | Underwater liquidations possible | Add on-chain profitability checks |

### MEDIUM Priority (Defense in Depth)

| ID | Finding | Impact | Recommendation |
|----|---------|--------|----------------|
| M1 | Emergency pause undefined | Cannot stop attacks | Add circuit breaker pattern |
| M2 | State migration undefined | Enclave upgrade breaks state | Define migration interface |
| M3 | Reserve exhaustion unhandled | Borrow requests fail silently | Add explicit exhaustion checks |
| M4 | TWAP fallback absent | Flash loan price manipulation | Implement TWAP as secondary oracle |

---

## Section 10: Implementation Checklist

### Phase 1: Architecture Freeze (BLOCKS ALL CODING)

- [ ] **CRITICAL:** Choose custody architecture (vault vs native)
- [ ] **CRITICAL:** Define withdrawal authorization mechanism (signature vs trigger)
- [ ] **CRITICAL:** Specify reserve funding contracts
- [ ] **CRITICAL:** Define `ProofContext` struct and binding verification
- [ ] **CRITICAL:** Specify trigger verifier contract interface

### Phase 2: Security Primitives

- [ ] Define access control roles
- [ ] Implement EIP-712 domain separator
- [ ] Implement oracle snapshot verification
- [ ] Add reentrancy guards
- [ ] Implement SafeERC20 wrappers

### Phase 3: Core Contracts

- [ ] Implement custody vault (if not using Vela native)
- [ ] Implement reserve manager
- [ ] Implement withdrawal verifier
- [ ] Implement state commitment tracker
- [ ] Implement trigger verifier (if using TRUSTPROCESS)

### Phase 4: Invariant Testing

- [ ] Reserve solvency tests
- [ ] Locked balance conservation tests
- [ ] State monotonicity tests
- [ ] Liquidation profitability tests

### Phase 5: Security Audit

- [ ] External audit of all custody flows
- [ ] Formal verification of critical invariants
- [ ] Penetration testing of meta-transaction flows
- [ ] Oracle manipulation attack simulation

---

## Conclusion

The architecture documents demonstrate strong security principles (defense-in-depth, fail-closed oracle, idempotent settlement), but **5 critical specifications are missing** that completely block Solidity implementation:

1. Custody architecture
2. Withdrawal authorization
3. Reserve funding
4. Proof-to-state binding
5. Trigger verifier security

Once these are frozen, the implementation path is clear. The recommended stack:

- **Custody:** Protocol-owned vault with enclave signature verification
- **Withdrawal:** TRUSTPROCESS trigger flow for atomic state/settlement
- **Oracle:** Signed snapshots with freshness checks (Chainlink as future upgrade)
- **Meta-transactions:** EIP-2612 permit with front-running mitigation
- **Testing:** Foundry invariant tests + Echidna fuzzing

**Estimated implementation time after architecture freeze:** 6-8 weeks for core contracts + 4 weeks audit remediation.

**Next step:** Freeze the 5 critical decisions, then proceed with Solidity implementation in parallel with TinyGo WASM development.
