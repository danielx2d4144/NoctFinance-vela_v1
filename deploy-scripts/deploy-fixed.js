import { ethers } from 'ethers';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, '..', 'noct-demo-wasm', 'noct-demo.wasm');

function fatal(...lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

const RPC_URL = process.env.VELA_RPC_URL || 'http://localhost:8545';

// Blocker B1: the ProcessorEndpoint address is not known. This file previously
// hardcoded 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 -- the second address a
// fresh Hardhat/Anvil chain assigns -- and described it as coming "from deployed
// contracts". It did not. Supply it from a real deployer log or do not deploy.
const PROCESSOR_ENDPOINT = process.env.VELA_PROCESSOR_ENDPOINT;
if (!PROCESSOR_ENDPOINT || !/^0x[0-9a-fA-F]{40}$/.test(PROCESSOR_ENDPOINT)) {
  fatal(
    'FATAL: VELA_PROCESSOR_ENDPOINT is not set to a valid address.',
    '  Blocker B1 is unresolved -- see VELA-DEV-TEAM-REQUEST.md.'
  );
}

// A signing key must come from the environment, never from version control.
const DEPLOYER_PRIVATE_KEY = process.env.VELA_DEPLOYER_PRIVATE_KEY;
if (!DEPLOYER_PRIVATE_KEY) {
  fatal(
    'FATAL: VELA_DEPLOYER_PRIVATE_KEY is not set.',
    '  A deployer key must not be committed to this repository.'
  );
}

// Computed from the artifact actually being deployed. The literal this replaced
// ('d0df4bae...', commented "from successful upload") matched no artifact here.
let wasmBytes;
try {
  wasmBytes = readFileSync(wasmPath);
} catch {
  fatal(
    `FATAL: ${wasmPath} not found. Build it first:`,
    '  powershell -ExecutionPolicy Bypass -File tools/build-guest.ps1'
  );
}
const WASM_HASH = createHash('sha256').update(wasmBytes).digest('hex');

// Refuse to ship a verification build unless explicitly overridden.
let provStatus = '';
try {
  const prov = readFileSync(wasmPath + '.provenance.txt', 'utf8');
  provStatus = (prov.match(/^\s*status\s*:\s*(.+)$/m) || [, ''])[1].trim();
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  fatal(
    'FATAL: no provenance sidecar next to the artifact.',
    '  Cannot confirm what this module was built with, so it must not ship.',
    '  Re-run tools/build-guest.ps1, which writes the sidecar.'
  );
}
if (/VERIFICATION-ONLY/i.test(provStatus)) {
  console.error('FATAL: refusing to deploy a VERIFICATION-ONLY artifact.');
  console.error(`  provenance status: ${provStatus}`);
  console.error('  Rebuild with: tools/build-guest.ps1 -Release');
  if (!process.argv.includes('--allow-verification-build')) process.exit(1);
  console.error('  --allow-verification-build given: LOCAL TESTING ONLY.');
}

// Correct ProcessorEndpoint ABI based on docs
const PROCESSOR_ABI = [
  "function submitDeployRequest(uint8 protocolVersion, bytes memory payload) external payable returns (uint256)",
  "event DeployRequest(uint256 indexed requestId, address indexed sender, uint8 protocolVersion)"
];

async function main() {
  console.log('🚀 NoctFinance WASM Deployment - Correct Signature\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log('📍 Deployer address:', wallet.address);
  console.log('📍 WASM SHA256:', WASM_HASH);
  console.log('');

  const processor = new ethers.Contract(PROCESSOR_ENDPOINT, PROCESSOR_ABI, wallet);

  // Create the deploy descriptor as per docs
  const deployDescriptor = {
    mode: "artifact_ref",
    artifactId: `sha256:${WASM_HASH}`,
    wasmSha256: WASM_HASH,
    constructorParams: {
      collateral_ratio: 200,
      protocol_version: "v1.0.0"
    }
  };

  const payloadBytes = ethers.toUtf8Bytes(JSON.stringify(deployDescriptor));
  const protocolVersion = 0; // Version 0 for Vela 0.2.0

  console.log('📝 Deploy Descriptor:');
  console.log(JSON.stringify(deployDescriptor, null, 2));
  console.log('');
  console.log('Protocol Version:', protocolVersion);
  console.log('');

  try {
    console.log('📤 Submitting deploy request...');

    const deployTx = await processor.submitDeployRequest(
      protocolVersion,
      payloadBytes,
      { value: ethers.parseEther('0.01') }
    );

    console.log('✅ Transaction sent:', deployTx.hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await deployTx.wait();
    console.log('✅ Confirmed in block:', receipt.blockNumber);
    console.log('');

    // Parse events to get request ID
    let requestId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = processor.interface.parseLog(log);
        if (parsed.name === 'DeployRequest') {
          requestId = parsed.args.requestId.toString();
          console.log('🎉 Deploy Request ID:', requestId);
          console.log('   Application ID will be:', requestId);
        }
      } catch (e) {
        // Not our event
      }
    }

    if (requestId) {
      console.log('');
      console.log('📊 Next: Watch the Manager process your deploy:');
      console.log('   docker logs vela-skit-manager -f');
      console.log('');
      console.log('You should see:');
      console.log('  1. Manager picks up DeployRequest event');
      console.log('  2. Fetches WASM from Authority Service');
      console.log('  3. Sends to Executor TEE');
      console.log('  4. TEE loads and verifies your WASM');
      console.log('  5. Your lending logic is now ready!');
      console.log('');
      console.log('Then submit a transaction:');
      console.log(`  node submit-transaction.js deposit 1000000000000000000`);
      console.log('');
      console.log(`Use Application ID: ${requestId}`);
    }

  } catch (error) {
    console.error('❌ Deploy failed:', error.message);
    if (error.data) {
      console.error('   Error data:', error.data);
    }
    process.exit(1);
  }
}

main().catch(console.error);
