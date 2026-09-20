# 🎬 Quick Reference: 4-Minute Video Script

Use this as your teleprompter or reference while recording!

---

## 📝 FULL SCRIPT (Read This!)

### [0:00-0:45] INTRODUCTION

**[Show: Docker Desktop with containers running]**

> "Hi, I'm demonstrating NoctFinance, a confidential lending protocol running on Horizen Vela.
> 
> I've built a simple lending system in Go, compiled it to WebAssembly, and it's running here in the local Vela environment. You can see the Docker containers - the blockchain, the TEE executor, and the state manager.
>
> This demo shows deposits, borrows with collateralization checks, and all account balances encrypted in the TEE."

**[Show: ls -lh noct-demo.wasm in terminal]**

> "Here's my compiled WASM - 944 kilobytes."

---

### [0:45-2:00] CODE WALKTHROUGH

**[Show: main.go in VS Code]**

> "Let me walk through the code.
>
> This is main.go - it exports the Vela WASM interface. You can see deploy, deposit, and process_request functions."

**[Show: app/lending.go - scroll to ProcessBorrow function]**

> "Here in lending.go is the actual lending logic.
>
> This is the borrow function. The key part is this health check right here:
>
> [Point to the code]
>
> It calculates whether the user has enough collateral based on our 200% ratio. If they're trying to borrow more than 50% of their collateral value, the transaction is rejected."

**[Show: app/state.go]**

> "And this is the state structure. All account balances are stored as encrypted hex strings."

---

### [2:00-3:30] SHOW IT RUNNING

**[Show: Terminal with docker logs vela-skit-manager -f]**

> "Now let me show you this running.
>
> Here in the Docker logs, you can see the full execution flow.
>
> When a request comes in:
> - The manager fetches it from the blockchain
> - Loads the encrypted state from storage  
> - Sends both to the Executor running in the TEE
>
> [Point to logs]
>
> The Executor decrypts the state using the TEE's key, runs my WASM code, encrypts the new state, and signs the update with the TEE's signing key.
>
> [Point to signature line]
>
> This signature gets verified on-chain, ensuring only genuine TEE-executed transitions are accepted.
>
> The state itself is encrypted - this AES-256 blob. Only the TEE can decrypt it.
>
> The blockchain only sees this state root - just a SHA256 hash."

**[Optional: Show WASM upload]**

> "Let me upload my WASM to the authority service."
>
> [Run: curl -X POST http://localhost:8081/upload -F "file=@noct-demo.wasm"]
>
> "You can see it returns the artifact ID with the SHA256 hash."

---

### [3:30-4:00] WRAP UP

**[Show: Docker containers or your WASM file]**

> "So to summarize:
>
> This demonstrates confidential DeFi running in a Trusted Execution Environment. All the lending logic - deposits, borrows, health checks - happens inside the encrypted enclave.
>
> The blockchain only sees encrypted state roots and TEE signatures. Account balances, borrowed amounts - all the sensitive data stays encrypted.
>
> This is the foundation for privacy-preserving DeFi, where users can interact with financial protocols without revealing their positions.
>
> Thanks for watching!"

---

## ⏱️ Timing Breakdown

- **0:00-0:45** Introduction (45 sec)
- **0:45-2:00** Code walkthrough (1 min 15 sec)
- **2:00-3:30** Show it running (1 min 30 sec)  
- **3:30-4:00** Wrap up (30 sec)

**Total: 4 minutes**

---

## 🎯 What to Have Open

1. **Docker Desktop** or terminal with `docker ps`
2. **VS Code** with these files:
   - `main.go`
   - `app/lending.go`
   - `app/state.go`
3. **Terminal** with `docker logs vela-skit-manager -f`

---

## 💡 Quick Tips

- **Speak at a comfortable pace** - don't rush
- **Pause between sections** - helps with editing
- **Point at code/logs** when referencing them
- **Show enthusiasm** - this is cool tech!
- **Don't worry about perfection** - natural is better

---

## ✅ Before You Hit Record

- [ ] Docker is running
- [ ] Code is open in VS Code
- [ ] Terminal ready with logs
- [ ] Microphone is working
- [ ] You've read through the script once

---

**You've got this! Just follow the script and show your work! 🚀**
