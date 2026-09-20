import { ethers } from 'ethers';

// Configuration from deployed contracts
const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';

// Deployer account (has DEPLOYER_ROLE from .env.dev)
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Your WASM hash (from successful upload)
const WASM_HASH = 'd0df4baedfc0ee1572d1d6910eae4ec4093e06a267ee9e642d54077eafdd8243';
const ARTIFACT_ID = '0x' + WASM_HASH;

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
