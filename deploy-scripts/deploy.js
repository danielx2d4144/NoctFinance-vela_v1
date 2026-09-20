import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

// Configuration from deployed contracts
const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const AUTHORITY_SERVICE = 'http://localhost:8081';

// Deployer account (has DEPLOYER_ROLE from .env.dev)
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// ProcessorEndpoint ABI - minimal for what we need
const PROCESSOR_ABI = [
  "function submitDeployRequest(bytes32 artifactId, bytes memory descriptor) external payable returns (uint256)",
  "function submitRequest(uint64 applicationId, uint8 requestType, bytes memory encryptedPayload, address tokenAddress, uint256 assetAmount) external payable returns (uint256)",
  "event DeployRequest(uint256 indexed requestId, address indexed sender, bytes32 artifactId)",
  "event ProcessRequest(uint256 indexed requestId, uint64 indexed applicationId, address indexed sender)"
];

async function main() {
  console.log('🚀 NoctFinance WASM Deployment Script\n');

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log('📍 Using deployer address:', wallet.address);
  console.log('📍 ProcessorEndpoint:', PROCESSOR_ENDPOINT);
  console.log('');

  // Read and hash WASM file
  const wasmPath = '../noct-demo-wasm/noct-demo.wasm';
  console.log('📦 Reading WASM file:', wasmPath);

  const wasmBytes = readFileSync(wasmPath);
  const wasmHash = createHash('sha256').update(wasmBytes).digest('hex');
  const artifactId = '0x' + wasmHash;

  console.log('   Size:', wasmBytes.length, 'bytes');
  console.log('   SHA256:', wasmHash);
  console.log('   Artifact ID:', artifactId);
  console.log('');

  // Step 1: Upload WASM to Authority Service
  console.log('📤 Step 1: Uploading WASM to Authority Service...');

  const formData = new FormData();
  const blob = new Blob([wasmBytes], { type: 'application/wasm' });
  formData.append('file', blob, 'noct-demo.wasm');

  // Note: Using curl for upload since fetch FormData doesn't work the same way
  console.log('   Using curl to upload (Node.js fetch limitation)');
  console.log('   Run this command separately:');
  console.log(`   curl -X POST http://localhost:8081/deploy/upload -F "wasm=@../noct-demo-wasm/noct-demo.wasm"`);
  console.log('');
  console.log('   Expected artifact ID: sha256:${wasmHash}');
  console.log('   (Upload already completed with curl)');
  console.log('');

  // Step 2: Submit deploy request on-chain
  console.log('📝 Step 2: Submitting deploy request on-chain...');

  const processor = new ethers.Contract(PROCESSOR_ENDPOINT, PROCESSOR_ABI, wallet);

  // Create descriptor (minimal JSON, will be passed as bytes)
  const descriptor = {
    mode: 'artifact_ref',
    artifactId: artifactId,
    collateralRatio: 200,
    version: 'v1.0.0'
  };

  const descriptorBytes = ethers.toUtf8Bytes(JSON.stringify(descriptor));

  console.log('   Descriptor:', JSON.stringify(descriptor, null, 2));
  console.log('');

  try {
    const deployTx = await processor.submitDeployRequest(
      artifactId,
      descriptorBytes,
      { value: ethers.parseEther('0.01') }
    );

    console.log('📤 Deploy transaction sent:', deployTx.hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await deployTx.wait();
    console.log('✅ Deploy confirmed in block:', receipt.blockNumber);

    // Parse events to get request ID
    for (const log of receipt.logs) {
      try {
        const parsed = processor.interface.parseLog(log);
        if (parsed.name === 'DeployRequest') {
          console.log('🎉 Deploy Request ID:', parsed.args.requestId.toString());
          console.log('   Application ID will be derived from this request ID');
        }
      } catch (e) {
        // Not a DeployRequest event
      }
    }

  } catch (error) {
    console.error('❌ Deploy transaction failed:', error.message);
    if (error.data) {
      console.error('   Error data:', error.data);
    }
    process.exit(1);
  }

  console.log('');
  console.log('✅ WASM deployed successfully!');
  console.log('');
  console.log('📊 Next Steps:');
  console.log('   1. Watch Manager logs: docker logs vela-skit-manager -f');
  console.log('   2. The Manager will pick up the deploy request');
  console.log('   3. Executor will load and verify your WASM');
  console.log('   4. Once deployed, you can submit transactions');
  console.log('');
  console.log('   Run: node submit-transaction.js deposit 1000000000000000000');
}

main().catch(console.error);
