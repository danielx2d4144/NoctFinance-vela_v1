# Simple 3-5 Minute Video Guide (No Coding Required!)

This is a **simplified guide** for recording your acceleration program video. No deployment scripts, no complex setup - just show your WASM working!

---

## 🎯 Simple Video Structure

**Total Time: 4 minutes**

1. **[0:00-0:45] Introduction** - Show what you built
2. **[0:45-2:00] Code Walkthrough** - Walk through the lending logic
3. **[2:00-3:30] Show It Running** - Docker logs showing TEE execution
4. **[3:30-4:00] Wrap Up** - Explain the privacy/security

---

## 🚀 Before You Start Recording

### Step 1: Start Docker (One Time Setup)

```bash
cd /c/Users/Hi/Desktop/noctfinance-vela/noct-vela-demo/dockerfiles

# Copy config file
cp .env.dev .env

# Start everything
docker compose up
```

**Wait 2-3 minutes** until you see logs flowing. That's it! Environment is ready.

### Step 2: Open Your Code

Open VS Code or any editor with:
- `noct-demo-wasm/main.go`
- `noct-demo-wasm/app/lending.go`
- `noct-demo-wasm/app/state.go`

### Step 3: Have a Terminal Ready

One terminal showing Docker logs:
```bash
docker logs vela-skit-manager -f
```

---

## 🎬 SCENE 1: Introduction (45 seconds)

### What to Say:

```
"Hi, I'm demonstrating NoctFinance - a confidential lending protocol 
running on Horizen Vela.

This is a simple demo showing how private DeFi logic can run inside 
a Trusted Execution Environment with encrypted state.

I've built a lending protocol in Go, compiled it to WASM, and it's 
running in the local Vela environment with Docker.

The key features are:
- Deposits and withdrawals of collateral
- Borrowing with 200% collateralization checks
- All balances encrypted in the TEE
- Every state change signed by the enclave"
```

### What to Show:

1. Show Docker Desktop with containers running (5 seconds)
   ```bash
   docker ps | grep vela-skit
   ```

2. Show your WASM file (5 seconds)
   ```bash
   ls -lh noct-demo-wasm/noct-demo.wasm
   ```
   Point out: "Here's my compiled WASM - 944 KB"

3. Show the project structure in VS Code (10 seconds)

---

## 🎬 SCENE 2: Code Walkthrough (1 min 15 sec)

### What to Say:

```
"Let me quickly walk through the code.

In main.go, I export the standard Vela WASM interface:
- deploy() for initialization
- deposit() for receiving funds  
- process_request() for all operations

The actual lending logic is here in lending.go.

This is the borrow function. The key part is this health check:
[point to the collateralization check code]

It calculates if the user has enough collateral based on our 
200% ratio. If they're trying to borrow more than 50% of their 
collateral value, it rejects the transaction.

And here in state.go is our state structure - all the account 
balances stored as encrypted hex strings."
```

### Files to Show:

**1. main.go** (20 seconds)
```go
// Just scroll to show the exports
//export deploy
//export load_module  
//export deposit
//export process_request
```

**2. app/lending.go** (40 seconds)
Scroll to the `ProcessBorrow` function and show:
```go
// Point out this section:
maxBorrow := *collateral
maxBorrow.Mul64(100)

requiredCollateral := *newBorrow
requiredCollateral.Mul64(state.CollateralRatio)

if requiredCollateral.Cmp(maxBorrow) > 0 {
    return nil, nil, nil, fmt.Errorf("insufficient collateral")
}
```

**3. app/state.go** (15 seconds)
Show the NoctState structure:
```go
type NoctState struct {
    Accounts        map[string]*Account
    TotalDeposits   string  // encrypted
    TotalBorrows    string  // encrypted
    CollateralRatio uint64
}
```

---

## 🎬 SCENE 3: Show It Running (1 min 30 sec)

**This is the easiest part - just show the Docker logs!**

### What to Say:

```
"Now let me show you this running in the local Vela environment.

Here in the Docker logs, you can see the Manager processing 
requests from the blockchain.

[point to logs]

When a request comes in, the Manager:
1. Fetches it from the ProcessorEndpoint contract
2. Loads the encrypted application state from storage
3. Sends both to the Executor running in the TEE

The Executor decrypts the state using the TEE's encryption key,
runs my WASM code, gets the new state back, encrypts it again,
and signs the update with the TEE's signing key.

[point to signature line in logs]

This signature gets verified on-chain by the smart contract,
ensuring only genuine TEE-executed state transitions are accepted.

You can see here the state is encrypted - this is the AES-256 
encrypted blob. Only the TEE can decrypt it.

And here's the state root being published on-chain - just a 
SHA256 hash, no private data."
```

### What to Show:

**Option 1: Just Show Existing Logs (Easiest)**

```bash
# Show manager logs
docker logs vela-skit-manager --tail 50

# Point out:
# - "Processing request"
# - "Decrypting state"
# - "Executing WASM"  
# - "Encrypting new state"
# - "Generating signature"
# - "State update confirmed"
```

**Option 2: Upload Your WASM (Shows End-to-End)**

If you want to show your actual WASM being uploaded:

```bash
cd noct-demo-wasm

# Upload it
curl -X POST http://localhost:8081/upload \
  -F "file=@noct-demo.wasm"

# This shows:
{
  "artifactId": "sha256:d0df4baedfc0ee1572d1d6910eae4ec4093e06a267ee9e642d54077eafdd8243",
  "size": 966656
}
```

Then show the manager logs picking up activity:
```bash
docker logs vela-skit-manager -f --tail 20
```

**Just narrate what you see in the logs!**

---

## 🎬 SCENE 4: Wrap Up (30 seconds)

### What to Say:

```
"So to summarize:

This demonstrates confidential DeFi running in a Trusted Execution 
Environment. All the lending logic - deposits, borrows, health checks - 
happens inside the encrypted enclave.

The blockchain only sees encrypted state roots and TEE signatures.
Account balances, borrowed amounts, all the sensitive data stays 
encrypted.

This is the foundation for private DeFi - where users can interact 
with financial protocols without revealing their positions or 
trading strategies.

Thanks for watching!"
```

### What to Show:

1. Show your WASM file one more time
2. Show Docker containers running
3. Maybe show your GitHub/project name

---

## 📹 Recording Tips

### Screen Setup

**Keep it simple:**
```
┌──────────────────────────────────┐
│  VS Code (when showing code)     │
│  OR                              │
│  Terminal (when showing logs)    │
└──────────────────────────────────┘
```

Don't try to show everything at once!

### Recording Checklist

**Before you hit record:**
- [ ] Docker is running (`docker ps`)
- [ ] VS Code is open with code
- [ ] One terminal with `docker logs vela-skit-manager -f`
- [ ] Microphone is working
- [ ] Close unnecessary browser tabs/windows

**While recording:**
- ✅ Speak clearly and naturally
- ✅ Take your time - pauses are OK
- ✅ Don't worry about being perfect
- ✅ Show enthusiasm!

**If something goes wrong:**
- Just pause for 5 seconds
- Start that section again
- Edit it out later

---

## 🎥 Super Simple Recording Flow

### Method 1: One Take (Recommended)

1. Start recording
2. Say intro while showing Docker running
3. Switch to VS Code, walk through code (2 min)
4. Switch to terminal, show Docker logs (1.5 min)
5. Say wrap-up
6. Stop recording
7. Done!

### Method 2: Record in Parts

1. Record intro (try until happy)
2. Record code walkthrough (can redo if needed)
3. Record Docker logs section
4. Record wrap-up
5. Stitch together with video editor

---

## 🎬 Example Script (Read This!)

Here's exactly what to say, word-for-word if you want:

```
[SCENE 1 - Show Docker running]

"Hi, I'm demonstrating NoctFinance, a confidential lending protocol 
running on Horizen Vela. 

I've built a simple lending system in Go, compiled it to WebAssembly, 
and it's running here in the local Vela environment with an emulated 
TEE. You can see the Docker containers running the blockchain, the 
TEE executor, and the state manager.

[SCENE 2 - Show code]

Let me walk through the code quickly.

This is main.go - it exports the Vela WASM interface functions.

Here in lending.go is the actual logic. This borrow function checks 
that users maintain 200% collateralization. You can see here where 
it calculates if they have enough collateral before allowing the 
borrow.

And this is the state structure where all account balances are stored 
as encrypted strings.

[SCENE 3 - Show Docker logs]

Now here's it running. In these Docker logs, you can see the full 
execution flow. When a request comes in, the manager loads the 
encrypted state, sends it to the TEE executor, the WASM code runs, 
and returns a new encrypted state with a TEE signature.

This signature gets verified on-chain, ensuring only genuine 
TEE-executed transitions are accepted.

The state itself is this encrypted blob - only the TEE can decrypt 
it. The blockchain only sees the state root hash.

[SCENE 4 - Wrap up]

So this demonstrates confidential DeFi in action. All the lending 
logic runs in an encrypted environment. The blockchain coordinates 
everything but never sees private user data.

This is the foundation for privacy-preserving DeFi.

Thanks for watching!"
```

**Total time: About 3.5-4 minutes. Perfect!**

---

## ✅ Final Checklist

Before submitting:

- [ ] Video is 3-5 minutes
- [ ] Shows your WASM file
- [ ] Shows code walkthrough (main.go, lending.go, state.go)
- [ ] Shows it running (Docker logs showing TEE execution)
- [ ] Explains privacy (encrypted state, TEE signatures)
- [ ] Audio is clear
- [ ] Uploaded and link is public

---

## 🚀 You're Ready!

**That's it! No deployment scripts, no complex transactions, just:**

1. Show your code (2 minutes)
2. Show it running in Docker (1.5 minutes)
3. Explain what it means (30 seconds)

**Start Docker, hit record, and follow this guide!**

---

## 💡 Pro Tips

1. **Practice your intro** - the first 30 seconds set the tone
2. **Don't memorize everything** - speak naturally about your code
3. **It's OK to pause** - think before speaking, edit out pauses later
4. **Show enthusiasm** - you built something cool!
5. **Keep it simple** - you don't need fancy effects or perfect delivery

---

## 📞 Quick Commands Reference

```bash
# Start Docker
cd noct-vela-demo/dockerfiles && docker compose up

# Check Docker is running  
docker ps | grep vela-skit

# Show logs
docker logs vela-skit-manager -f

# Show your WASM
ls -lh noct-demo-wasm/noct-demo.wasm

# Upload WASM (optional)
cd noct-demo-wasm
curl -X POST http://localhost:8081/upload -F "file=@noct-demo.wasm"
```

**Good luck! You've got this! 🎉**
