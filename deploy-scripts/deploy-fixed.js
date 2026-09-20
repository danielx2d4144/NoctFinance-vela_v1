import { ethers } from 'ethers';

// Configuration from deployed contracts
const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';

// Deployer account (has DEPLOYER_ROLE from .env.dev)
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Your WASM hash (from successful upload)
const WASM_HASH = 'd0df4baedfc0ee1572d1d6910eae4ec4093e06a267ee9e642d54077eafdd8243';

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
