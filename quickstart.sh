#!/bin/bash
# Quick Start Script for NoctFinance Vela Demo
# Run this to set up and verify everything before recording your video

set -e

echo "======================================"
echo "NoctFinance Vela Demo - Quick Start"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verify WASM exists
echo -e "${YELLOW}[1/5] Verifying WASM build...${NC}"
if [ -f "noct-demo-wasm/noct-demo.wasm" ]; then
    SIZE=$(ls -lh noct-demo-wasm/noct-demo.wasm | awk '{print $5}')
    SHA=$(sha256sum noct-demo-wasm/noct-demo.wasm | cut -d' ' -f1)
    echo -e "${GREEN}✓ WASM found: $SIZE${NC}"
    echo "  SHA256: $SHA"
else
    echo "✗ WASM not found. Building..."
    cd noct-demo-wasm
    export PATH="$HOME/binaryen-version_119/bin:$PATH"
    tinygo build -o noct-demo.wasm -target=wasi -no-debug main.go
    cd ..
    echo -e "${GREEN}✓ WASM built successfully${NC}"
fi
echo ""

# Step 2: Check Docker
echo -e "${YELLOW}[2/5] Checking Docker...${NC}"
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker is installed${NC}"
    if docker ps &> /dev/null; then
        echo -e "${GREEN}✓ Docker daemon is running${NC}"
    else
        echo "✗ Docker daemon not running. Please start Docker Desktop."
        exit 1
    fi
else
    echo "✗ Docker not found. Please install Docker Desktop."
    exit 1
fi
echo ""

# Step 3: Check Vela environment
echo -e "${YELLOW}[3/5] Checking Vela starter kit...${NC}"
if [ -d "noct-vela-demo/dockerfiles" ]; then
    echo -e "${GREEN}✓ Vela starter kit found${NC}"

    # Check if .env exists
    if [ ! -f "noct-vela-demo/dockerfiles/.env" ]; then
        echo "  Creating .env from .env.dev..."
        cp noct-vela-demo/dockerfiles/.env.dev noct-vela-demo/dockerfiles/.env
        echo -e "${GREEN}  ✓ .env created${NC}"
    else
        echo -e "${GREEN}  ✓ .env already exists${NC}"
    fi
else
    echo "✗ Vela starter kit not found at noct-vela-demo/dockerfiles"
    exit 1
fi
echo ""

# Step 4: Display WASM upload command
echo -e "${YELLOW}[4/5] WASM Upload Command${NC}"
echo "Once Docker is running, use this command to upload your WASM:"
echo ""
echo "  cd noct-demo-wasm"
echo "  curl -X POST http://localhost:8081/upload \\"
echo "    -F 'file=@noct-demo.wasm' \\"
echo "    -o upload-response.json"
echo ""
echo "  cat upload-response.json"
echo ""

# Step 5: Display Docker start command
echo -e "${YELLOW}[5/5] Starting Vela Environment${NC}"
echo ""
echo "To start the Vela environment, run:"
echo ""
echo "  cd noct-vela-demo/dockerfiles"
echo "  docker compose up"
echo ""
echo "Wait for all services to be healthy (takes 2-3 minutes):"
echo "  - vela-skit-chain"
echo "  - vela-skit-executor"
echo "  - vela-skit-manager"
echo "  - vela-skit-authorityservice"
echo "  - vela-skit-deployer"
echo ""

# Summary
echo "======================================"
echo -e "${GREEN}✓ Pre-flight check complete!${NC}"
echo "======================================"
echo ""
echo "Your NoctFinance demo is ready. Next steps:"
echo ""
echo "1. Start Docker services:"
echo "   cd noct-vela-demo/dockerfiles && docker compose up"
echo ""
echo "2. Wait for services to be healthy (~2-3 min)"
echo ""
echo "3. Upload WASM artifact"
echo ""
echo "4. Deploy and test transactions"
echo ""
echo "5. Record your video! 🎥"
echo ""
echo "See BUILD_COMPLETE.md for detailed instructions."
echo ""
echo "WASM Info:"
echo "  File: noct-demo-wasm/noct-demo.wasm"
echo "  Size: $SIZE"
echo "  SHA256: $SHA"
echo ""
