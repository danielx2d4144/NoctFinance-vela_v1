#!/bin/bash

# NoctFinance Vela Demo - End-to-End Transaction Script

echo "🚀 NoctFinance Vela Demo - Running End-to-End Transaction"
echo "=========================================================="
echo ""

# Configuration — read from the environment, fail closed. See .env.example.
# The ProcessorEndpoint previously hardcoded here
# (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9) was an Anvil mock address, not a real
# Vela contract. Blocker B1 is now RESOLVED: the verified Base Sepolia value is
# 0xd5E405a84753635608E7a28A59D7349BB2DAaEeF.
RPC_URL="${VELA_RPC_URL:-http://localhost:8545}"
PROCESSOR_ENDPOINT="${VELA_PROCESSOR_ENDPOINT:-}"
AUTHORITY_SERVICE="${VELA_AUTHORITY_SERVICE_URL:-http://localhost:8081}"

if [ -z "$PROCESSOR_ENDPOINT" ]; then
  echo "FATAL: VELA_PROCESSOR_ENDPOINT is not set." >&2
  echo "  Blocker B1 IS resolved -- the verified value is in .env.example." >&2
  exit 1
fi

# Blocker B11: Vela deployment is permissioned. Only Horizen can deploy new apps, and the
# deploy sender must hold DEPLOYER_ROLE on the ProcessorEndpoint. Uploading a WASM from
# this machine will not register an application until that grant exists.
echo "⚠️  NOTE: deployment is permissioned (blocker B11). Unless this wallet holds"
echo "   DEPLOYER_ROLE on the ProcessorEndpoint, app registration WILL fail."
echo "   See VELA-TESTNET-CONSTANTS.md section 5."
echo ""

# Step 1: Upload WASM to Authority Service
echo "📦 Step 1: Uploading WASM to Authority Service..."
# Resolve paths relative to this script, not to one developer's machine. This was
# previously a hardcoded `cd /c/Users/Hi/Desktop/noctfinance-vela/noct-demo-wasm`,
# which only ever worked on the original author's Windows/Git-Bash setup.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/noct-demo-wasm" || { echo "FATAL: cannot cd to noct-demo-wasm" >&2; exit 1; }

WASM_SHA256=$(sha256sum noct-demo.wasm | awk '{print $1}')
echo "WASM SHA256: $WASM_SHA256"
echo ""

# Step 2: Check if we can get the TEE public key
echo "🔑 Step 2: Getting TEE Public Key..."
docker exec vela-skit-manager cat /data/keyset_recovery.json | head -5
echo ""

# Step 3: Monitor Docker logs for processing
echo "📊 Step 3: Monitoring TEE execution..."
echo "The Manager is now watching for on-chain requests."
echo "When a transaction comes in, you'll see:"
echo "  - Manager fetches encrypted state"
echo "  - Executor decrypts and runs WASM"
echo "  - New state encrypted and signed"
echo "  - Result published on-chain"
echo ""

echo "✅ System is ready! Here's what to show in your video:"
echo ""
echo "1. Show this WASM file:"
ls -lh noct-demo.wasm
echo ""
echo "2. Show Docker containers:"
docker ps --format "table {{.Names}}\t{{.Status}}"
echo ""
echo "3. Show TEE logs processing requests:"
echo "   Run: docker logs vela-skit-manager -f"
echo ""
echo "For a full end-to-end demo, you would:"
echo "  - Submit a deposit transaction"
echo "  - TEE processes it (visible in logs)"
echo "  - Submit a borrow transaction"
echo "  - TEE validates collateralization (your logic!)"
echo "  - Result encrypted and returned"
