# Quick Demo Commands - Once Docker is Ready

## Step 1: Verify Docker is Running
```powershell
docker ps
```
You should see 8-9 containers running (chain, executor, manager, postgres, etc.)

---

## Step 2: Upload Your WASM
```powershell
cd C:\Users\Hi\Desktop\noctfinance-vela\noct-demo-wasm
curl -X POST http://localhost:8081/upload -F "file=@noct-demo.wasm" -o upload-response.json
type upload-response.json
```

Save the `artifact_id` from the response!

---

## Step 3: Watch Docker Logs (For Video!)
```powershell
docker logs vela-skit-manager -f --tail 100
```

This shows your WASM executing in the TEE! Keep this running during your demo.

---

## Step 4: Check Logs Show Execution
Look for:
- "Processing request"
- "Encrypted state"
- "TEE signature"
- "State root published"

---

## 🎬 For Your Video

**What to show:**
1. Your WASM file + code (1.5 min)
2. Docker containers running (`docker ps`) (30 sec)
3. Upload WASM with curl (30 sec)
4. Docker logs showing TEE execution (1.5 min) - **THIS IS THE KEY PART!**

**The logs prove your WASM is executing end-to-end in Vela!** ✅

---

## ⏳ Current Status

Waiting for Docker images to finish downloading...
Check progress: Look at the Docker Desktop UI or run `docker ps` until you see containers.

Once you see containers running, follow Steps 2-4 above!
