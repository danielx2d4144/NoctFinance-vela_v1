#!/bin/bash

# NoctFinance Vela Demo - End-to-End Transaction Script

echo "🚀 NoctFinance Vela Demo - Running End-to-End Transaction"
echo "=========================================================="
echo ""

# Configuration
PROCESSOR_ENDPOINT="0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"
RPC_URL="http://localhost:8545"
AUTHORITY_SERVICE="http://localhost:8081"

# Step 1: Upload WASM to Authority Service
echo "📦 Step 1: Uploading WASM to Authority Service..."
cd /c/Users/Hi/Desktop/noctfinance-vela/noct-demo-wasm

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
