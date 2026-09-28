import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Configuration — from the environment, fail closed. See .env.example.
// This file previously hardcoded an Anvil mock ProcessorEndpoint
// (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9) plus the well-known Anvil dev private key,
// under the comment "has DEPLOYER_ROLE from .env.dev". No .env.dev exists in this
// repository, and that key holds no role on any real instance — confirmed with
// check-role.js against the live Base Sepolia contract. Both are now required from env.
function fatal(...lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

const RPC_URL = process.env.VELA_RPC_URL || 'http://localhost:8545';

// Blocker B1 is RESOLVED: the verified Base Sepolia ProcessorEndpoint is
// 0xd5E405a84753635608E7a28A59D7349BB2DAaEeF. Still required from the environment so this
// script cannot silently target the wrong chain.
const PROCESSOR_ENDPOINT = process.env.VELA_PROCESSOR_ENDPOINT;
if (!PROCESSOR_ENDPOINT || !/^0x[0-9a-fA-F]{40}$/.test(PROCESSOR_ENDPOINT)) {
  fatal(
    'FATAL: VELA_PROCESSOR_ENDPOINT is not set to a valid address.',
    '  Blocker B1 IS resolved -- the verified value is in .env.example.'
  );
}

const AUTHORITY_SERVICE = process.env.VELA_AUTHORITY_SERVICE_URL || 'http://localhost:8081';

const DEPLOYER_PRIVATE_KEY = process.env.VELA_DEPLOYER_PRIVATE_KEY;
if (!DEPLOYER_PRIVATE_KEY) {
  fatal(
    'FATAL: VELA_DEPLOYER_PRIVATE_KEY is not set.',
    '  A deployer key must not be committed to this repository.'
  );
}

// Blocker B11 (CRITICAL): Vela deployment is PERMISSIONED. The sender must hold
// DEPLOYER_ROLE on the ProcessorEndpoint, and only Horizen's unidentified admin can grant
// it. This transaction will revert until that happens.
console.error('NOTE: deployment is permissioned (blocker B11). Unless this wallet holds');
console.error('      DEPLOYER_ROLE, submitDeployRequest WILL revert. Check with:');
console.error('      node check-role.js <your-address>');

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
  // Resolve relative to this file, not to whatever CWD the caller happens to be in.
  const wasmPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'noct-demo-wasm', 'noct-demo.wasm');
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

  // The three lines that used to sit here built a FormData/Blob that was never sent —
  // dead code that implied an upload this script does not perform.
  //
  // It also printed "(Upload already completed with curl)". That was an unsupported
  // claim: nothing in the repository evidenced any upload, and the message printed even
  // on a machine that had never run curl. Say plainly what the operator must do.
  console.log('   This script does NOT upload the artifact. Run this yourself first:');
  console.log(`   curl -X POST ${AUTHORITY_SERVICE}/deploy/upload -F "wasm=@${wasmPath}"`);
  console.log('');
  console.log(`   Expected artifact ID: sha256:${wasmHash}`);
  console.log('   AuthorityServiceURL is plaintext HTTP to a bare IP, so the upload has no');
  console.log('   transport integrity -- confirm the returned artifact ID matches the above.');
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
