# NoctFinance: Confidential Lending Protocol on Horizen Vela
## Integration Architecture & Privacy Model

---

## Overview

NoctFinance is a confidential DeFi lending protocol built on Horizen Vela that enables privacy-preserving borrowing and lending. Users can deposit collateral, borrow funds, and manage loans without revealing their account balances, positions, or transaction amounts to other users or blockchain observers.

---

## Integration Architecture

### System Components

```
┌─────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Web App   │────────▶│   Ethereum   │────────▶│  Vela Manager   │
│  (React +   │         │ Smart Contract│         │  (Orchestrator) │
│  MetaMask)  │         │(ProcessorEndpoint)      └────────┬────────┘
└─────────────┘         └──────────────┘                  │
                                                           │
                                                           ▼
                                               ┌───────────────────┐
                                               │  Vela Executor    │
                                               │  (TEE - AWS Nitro)│
                                               │                   │
                                               │  ┌─────────────┐  │
                                               │  │   NoctFin   │  │
                                               │  │    WASM     │  │
                                               │  │   Module    │  │
                                               │  └─────────────┘  │
                                               │                   │
                                               │  Encrypted State  │
                                               └───────────────────┘
```

### Data Flow - Borrow Transaction Example

1. **User Action**: User connects MetaMask and initiates a borrow request in the web app
2. **Encryption**: Web app encrypts request payload with TEE's public P-521 key
3. **On-Chain Submission**: Encrypted payload submitted to ProcessorEndpoint contract with fee
4. **Event Monitoring**: Vela Manager monitors blockchain for ProcessRequest events
5. **TEE Processing**:
   - Manager fetches encrypted application state from storage
   - Sends encrypted state + request to Executor (TEE)
   - TEE decrypts state with its private P-521 key (never leaves TEE)
   - WASM module loads and validates:
     - User's current collateral balance
     - User's current borrowed amount
     - Requested borrow amount
     - **Health factor calculation**: ensures collateral > 200% of total debt
   - If valid: updates balances, re-encrypts state
   - If invalid: rejects with "insufficient collateral"
   - TEE signs state update with Secp256k1 key
6. **State Commitment**: Manager publishes encrypted state root + TEE signature on-chain
7. **Response**: User receives encrypted response, decrypts with their private key

---

## What Stays Private

The following data remains **confidential** and is **never revealed** on-chain or to observers:

### User-Level Privacy
- **Account balances** - collateral and borrowed amounts stored as encrypted hex strings
- **Transaction amounts** - deposit, borrow, repay, withdraw values
- **Health factors** - borrowing capacity and liquidation risk metrics
- **User identities** - addresses are encrypted in the TEE state
- **Transaction history** - complete lending activity of each user

### System-Level Privacy
- **Total Value Locked (TVL)** - aggregate protocol statistics
- **Utilization rates** - how much of total deposits are borrowed
- **Individual positions** - no one can see who has what debt

### Technical Privacy Guarantees

**Encryption**: All state encrypted with AES-256 using TEE's P-521 key
- Key generated inside TEE and never exported
- State stored as encrypted blobs in Manager's database
- Only TEE can decrypt historical state

**Computation**: All business logic runs inside AWS Nitro Enclave
- Host system cannot inspect memory
- No debug/console access to running enclave
- Attestation proves genuine TEE environment

**Communication**: User ↔ TEE encrypted with ECDH P-521
- Users derive shared secret with TEE's public key
- Requests and responses encrypted end-to-end
- Blockchain sees only encrypted payloads

---

## What Settles On-Chain

The following data is **public** and **verifiable** on the blockchain:

### Transparency Without Privacy Loss

**Request metadata**:
- Request IDs
- Request types (deploy, process, deanonymize)
- Timestamp and block number
- Fee payments

**State commitments**:
- Encrypted state root (32-byte hash)
- TEE signature (proves authenticity)
- Version number (state update counter)

**TEE authentication**:
- TEE signing key address (verified by TeeAuthenticator contract)
- Signature verification ensures only genuine TEE can update state
- Smart contract enforces: unsigned updates = rejected

**Application metadata**:
- Application ID
- WASM artifact SHA256 hash
- Deployer address
- Current state (Active, Paused, etc.)

### What You CANNOT See On-Chain
- Who borrowed how much
- Account balances
- Transaction amounts
- Health factors or liquidation status
- Protocol TVL or utilization

**Public verifiability** (state roots + signatures) **without data exposure** (encrypted state).

---

## User-Facing Features Enabled

### 1. Private Borrowing
**What users can do:**
- Deposit collateral privately (amount hidden)
- Borrow against collateral without revealing position size
- Check borrowing capacity without exposing balance
- Repay loans privately

**Why it matters:**
- Prevents front-running based on position size
- Protects users from targeted attacks
- No MEV extraction based on liquidation visibility
- Financial privacy for institutions and whales

---

### 2. Confidential Account Management
**What users can do:**
- View their own encrypted balances (decrypt locally)
- Track their health factor privately
- Manage multiple positions without linking them publicly
- Withdraw collateral after repayment

**Why it matters:**
- Competitors cannot track your trading strategy
- Privacy for personal financial management
- Separation of business and personal accounts
- Protection from social engineering attacks

---

### 3. Privacy-Preserving Liquidations (Future Feature)
**What users can do:**
- Receive private warnings when approaching liquidation threshold
- Top up collateral without revealing vulnerability
- Liquidators work on encrypted data (cannot target specific users)

**Why it matters:**
- Fair liquidation process
- No predatory targeting of small positions
- Reduces cascading liquidation risks

---

### 4. Compliant Privacy (Optional Feature)
**What users can do:**
- Opt-in to regulatory deanonymization for specific jurisdictions
- Prove solvency to auditors without public disclosure
- Generate encrypted compliance reports

**Why it matters:**
- Enables institutional adoption
- Meets regulatory requirements while preserving user privacy
- Selective disclosure (show regulator, not everyone)

---

## Technical Implementation

### Smart Contracts
- **ProcessorEndpoint**: Request submission and state verification
- **TeeAuthenticator**: TEE signature validation
- **TokenAllowlist**: Supported collateral tokens

### WASM Module (Go → TinyGo → WASM)
- **Exports**: `deploy`, `deposit`, `process_request`
- **Business Logic**:
  - Collateralization validation (200% ratio)
  - Health factor calculation
  - Balance updates with encrypted state
- **Size**: 966KB optimized WASM

### State Management
```json
{
  "appId": 2397975349340933566,
  "accounts": {
    "0xuser1": {
      "collateral": "0x...",  // encrypted
      "borrowed": "0x..."     // encrypted
    }
  },
  "collateralRatio": 200,
  "nonce": 42
}
```
Entire structure encrypted before storage.

---

## Key Differentiators

| Feature | Traditional DeFi | NoctFinance (Vela) |
|---------|------------------|---------------------|
| **Balance visibility** | Public | Private (encrypted) |
| **Position tracking** | Anyone can see | Only user knows |
| **MEV exposure** | High (visible liquidations) | Low (encrypted state) |
| **Front-running risk** | High | Low |
| **Regulatory compliance** | Public or nothing | Selective disclosure |
| **Institutional adoption** | Limited (privacy concerns) | Enabled (confidential) |

---

## Use Cases

1. **Institutional Borrowers**: Manage large positions without revealing strategy
2. **Privacy-Conscious Users**: Personal financial privacy
3. **Cross-Border Finance**: Borrow without geographic exposure
4. **Regulated Markets**: Compliant confidential lending
5. **DeFi Composability**: Private collateral for other protocols (future)

---

**NoctFinance: Private lending. Public trust. Powered by Horizen Vela.**
