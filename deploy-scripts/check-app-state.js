import { ethers } from 'ethers';

const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const APP_ID = 2397975349340933566n;

const PROCESSOR_ABI = [
  "function getApplicationState(uint64 applicationId) view returns (uint8 state)",
  "function getApplicationData(uint64 applicationId) view returns (tuple(address deployer, bytes32 currentStateRoot, uint256 currentVersion, uint8 state))"
];

async function main() {
  console.log('🔍 Checking Application State\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const processor = new ethers.Contract(PROCESSOR_ENDPOINT, PROCESSOR_ABI, provider);

  console.log('📍 Application ID:', APP_ID.toString());
  console.log('');

  try {
    const state = await processor.getApplicationState(APP_ID);
    console.log('Application State:', state);
    console.log('  0 = NotDeployed');
    console.log('  1 = Deploying');
    console.log('  2 = Active');
    console.log('  3 = Paused');
    console.log('');

    if (state === 2) {
      console.log('✅ Application is ACTIVE and ready for transactions!');
    } else if (state === 1) {
      console.log('⏳ Application is still DEPLOYING. Wait a moment and try again.');
    } else if (state === 0) {
      console.log('❌ Application not found.');
    }

    // Get more details
    const appData = await processor.getApplicationData(APP_ID);
    console.log('');
    console.log('Application Details:');
    console.log('  Deployer:', appData.deployer);
    console.log('  State Root:', appData.currentStateRoot);
    console.log('  Version:', appData.currentVersion.toString());

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main().catch(console.error);
