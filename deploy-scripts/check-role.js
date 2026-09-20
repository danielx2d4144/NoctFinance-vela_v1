import { ethers } from 'ethers';

const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const PROCESSOR_ABI = [
  "function DEPLOYER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)"
];

async function main() {
  console.log('🔍 Checking Deployer Permissions\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const processor = new ethers.Contract(PROCESSOR_ENDPOINT, PROCESSOR_ABI, provider);

  console.log('📍 Processor:', PROCESSOR_ENDPOINT);
  console.log('📍 Deployer:', DEPLOYER_ADDRESS);
  console.log('');

  try {
    const deployerRole = await processor.DEPLOYER_ROLE();
    console.log('DEPLOYER_ROLE hash:', deployerRole);

    const hasRole = await processor.hasRole(deployerRole, DEPLOYER_ADDRESS);
    console.log('Has DEPLOYER_ROLE:', hasRole);

    const adminRole = await processor.DEFAULT_ADMIN_ROLE();
    console.log('ADMIN_ROLE hash:', adminRole);

    const hasAdmin = await processor.hasRole(adminRole, DEPLOYER_ADDRESS);
    console.log('Has ADMIN_ROLE:', hasAdmin);

    if (!hasRole) {
      console.log('');
      console.log('❌ Deployer does NOT have DEPLOYER_ROLE!');
      console.log('   This explains why deploy transactions are reverting.');
      console.log('');
      console.log('   According to the docs, DEPLOYER_ROLE should be granted during setup.');
      console.log('   Check if the deployer container properly set this up.');
    } else {
      console.log('');
      console.log('✅ Deployer has correct role. Issue must be elsewhere.');
    }

  } catch (error) {
    console.error('❌ Error checking roles:', error.message);
  }
}

main().catch(console.error);
