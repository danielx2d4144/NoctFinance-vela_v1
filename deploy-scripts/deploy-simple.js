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

// Blocker B1: not a discovered address. See the note in deploy-fixed.js.
const PROCESSOR_ENDPOINT = process.env.VELA_PROCESSOR_ENDPOINT;
if (!PROCESSOR_ENDPOINT || !/^0x[0-9a-fA-F]{40}$/.test(PROCESSOR_ENDPOINT)) {
  fatal(
    'FATAL: VELA_PROCESSOR_ENDPOINT is not set to a valid address.',
    '  Blocker B1 is unresolved -- see VELA-DEV-TEAM-REQUEST.md.'
  );
}

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
const ARTIFACT_ID = '0x' + WASM_HASH;

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

// ProcessorEndpoint ABI
const PROCESSOR_ABI = [
  "function submitDeployRequest(bytes32 artifactId, bytes memory descriptor) external payable returns (uint256)",
  "event DeployRequest(uint256 indexed requestId, address indexed sender, bytes32 artifactId)"
];

async function main() {
  console.log('🚀 Simple WASM Deployment - Direct On-Chain\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log('📍 Deployer address:', wallet.address);
  console.log('📍 Artifact ID:', ARTIFACT_ID);
  console.log('');

  const processor = new ethers.Contract(PROCESSOR_ENDPOINT, PROCESSOR_ABI, wallet);

  // Try with empty descriptor first
  console.log('📝 Submitting deploy request with empty descriptor...');

  const emptyDescriptor = '0x';

  try {
    const deployTx = await processor.submitDeployRequest(
      ARTIFACT_ID,
      emptyDescriptor,
      { value: ethers.parseEther('0.01') }
    );

    console.log('✅ Deploy transaction sent:', deployTx.hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await deployTx.wait();
    console.log('✅ Confirmed in block:', receipt.blockNumber);

    // Parse events
    for (const log of receipt.logs) {
      try {
        const parsed = processor.interface.parseLog(log);
        if (parsed.name === 'DeployRequest') {
          const requestId = parsed.args.requestId.toString();
          console.log('🎉 Deploy Request ID:', requestId);
          console.log('');
          console.log('📊 Now watch the Manager process it:');
          console.log('   docker logs vela-skit-manager -f');
          console.log('');
          console.log('The Manager will:');
          console.log('  1. See the DeployRequest event');
          console.log('  2. Fetch your WASM from Authority Service');
          console.log('  3. Send it to the Executor TEE');
          console.log('  4. TEE loads and verifies the WASM');
          console.log('  5. Application ready for transactions!');
          console.log('');
          console.log('Application ID will be:', requestId, '(derived from request ID)');
        }
      } catch (e) {
        // Not our event
      }
    }

  } catch (error) {
    console.error('❌ Deploy failed:', error.message);

    // Try to get more info
    if (error.code === 'CALL_EXCEPTION') {
      console.error('');
      console.error('Possible reasons:');
      console.error('  1. Deployer address lacks DEPLOYER_ROLE');
      console.error('  2. Artifact not found in Authority Service');
      console.error('  3. Insufficient fee sent');
      console.error('  4. Contract expects specific descriptor format');
      console.error('');
      console.error('Your deployer address:', wallet.address);
      console.error('Expected to have DEPLOYER_ROLE (check .env.dev)');
    }

    process.exit(1);
  }
}

main().catch(console.error);
