# NoctFinance Vela Demo - Simple Lending Protocol

This is a simplified NoctFinance lending protocol implementation designed to run as a WASM job in the Vela confidential execution environment.

## What This Demonstrates

A basic private lending protocol with:
- **Deposits**: Users deposit USDC as collateral
- **Borrows**: Users borrow against their collateral (simple 2:1 collateralization ratio)
- **Repayments**: Users repay borrowed amounts
- **Withdrawals**: Users withdraw collateral after repaying debts
- **Private state**: All balances and positions remain encrypted in TEE

## Architecture

```
User Request (encrypted) → Vela ProcessorEndpoint 
  → Manager → Executor (Nitro Enclave) 
  → NoctFinance WASM → Updated State (encrypted)
  → Signed Result → On-chain Settlement
```

## State Model

```json
{
  "accounts": {
    "0x...": {
      "collateral_balance": "1000000000",  // USDC (6 decimals)
      "borrowed_balance": "500000000",     // USDC borrowed
      "nonce": 1
    }
  },
  "total_deposits": "5000000000",
  "total_borrows": "2000000000"
}
```

## Operations

1. **DEPOSIT** - Deposit USDC as collateral
2. **BORROW** - Borrow USDC (max 50% of collateral value)
3. **REPAY** - Repay borrowed USDC
4. **WITHDRAW** - Withdraw collateral (only if no outstanding debt)
5. **VIEW_BALANCE** - Query private balance (emits encrypted event)

## Building

Prerequisites:
- Go 1.21+
- TinyGo 0.30+

```bash
# Install dependencies
go mod download

# Build WASM
tinygo build -o noct-demo.wasm -target=wasi main.go

# Verify WASM
wasm-validate noct-demo.wasm
```

## Deployment to Vela

1. Start local Vela environment:
```bash
cd noct-vela-demo/dockerfiles
cp .env.dev .env
docker compose up
```

2. Upload WASM artifact:
```bash
curl -X POST http://localhost:8081/upload \
  -F "file=@noct-demo.wasm" \
  -o artifact-response.json
```

3. Deploy to Vela:
```typescript
// Using vela-common-ts client
const deployDescriptor = {
  mode: "artifact_ref",
  artifactId: "sha256:<hash-from-upload>",
  wasmSha256: "<hash>",
  constructorParams: {
    collateral_ratio: 200,  // 2:1 ratio (200%)
    protocol_version: "v0.1.0"
  }
};

await velaClient.submitDeployRequest(deployDescriptor);
```

## Testing Locally

```bash
# Submit deposit request
node test-client.js deposit --amount 1000000000

# Submit borrow request  
node test-client.js borrow --amount 400000000

# Check balance (receives encrypted event)
node test-client.js view-balance

# Repay loan
node test-client.js repay --amount 400000000

# Withdraw collateral
node test-client.js withdraw --amount 1000000000
```

## Video Demo Script

For your acceleration program video submission:

1. **Show Architecture** (30s)
   - Explain Vela confidential execution
   - Show Docker environment running

2. **Show Code** (1 min)
   - Walk through main.go WASM exports
   - Explain state encryption
   - Show lending logic in app/lending.go

3. **Deploy WASM** (1 min)
   - Upload WASM to authority service
   - Submit deploy request
   - Show deployment confirmation

4. **Execute Transactions** (2 min)
   - Deposit collateral (show encrypted state update)
   - Borrow funds (show health check logic)
   - View balance (show encrypted event)
   - Repay and withdraw

5. **Show Results** (30s)
   - Show on-chain events
   - Show TEE signature verification
   - Explain privacy guarantees

## Key Features for Video

✅ **Private State**: All balances encrypted in TEE  
✅ **Confidential Logic**: Lending rules run in Nitro Enclave  
✅ **Verified Execution**: TEE signs every state update  
✅ **On-chain Settlement**: Withdrawals settled on EVM chain  
✅ **Real Vela Integration**: Uses official v0.2.0 platform

## Files Structure

```
noct-demo-wasm/
├── main.go              # WASM exports (deploy, process_request, etc.)
├── app/
│   ├── state.go         # State types and serialization
│   ├── lending.go       # Core lending logic
│   └── operations.go    # Request handlers
├── utils/
│   └── memory.go        # WASM memory allocation
├── go.mod
├── go.sum
└── README.md
```
