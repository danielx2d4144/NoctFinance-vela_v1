import { VelaClient } from '@horizenofficial/vela-common-ts';
import { ethers } from 'ethers';

// Configuration — from the environment, fail closed. See .env.example.
// This file previously hardcoded PROCESSOR_ENDPOINT = '0x...' (not an address at all),
// APP_ID = 1 (assumed), and inlined the well-known Anvil dev private key further down.
// None of that could ever have worked against a real instance.
//
// NOTE: this file imports @horizenofficial/vela-common-ts, which is NOT in
// noct-demo-wasm/package.json and has no node_modules here, so it does not currently
// compile or run. It is kept as the intended client integration shape, not as working
// code — do not cite it as evidence of a tested client path.
function fatal(...lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(1);
}

const RPC_URL = process.env.VELA_RPC_URL || 'http://localhost:8545';

// Blocker B1 is RESOLVED: the verified Base Sepolia ProcessorEndpoint is
// 0xd5E405a84753635608E7a28A59D7349BB2DAaEeF.
const PROCESSOR_ENDPOINT = process.env.VELA_PROCESSOR_ENDPOINT;
if (!PROCESSOR_ENDPOINT || !/^0x[0-9a-fA-F]{40}$/.test(PROCESSOR_ENDPOINT)) {
  fatal(
    'FATAL: VELA_PROCESSOR_ENDPOINT is not set to a valid address.',
    '  Blocker B1 IS resolved -- the verified value is in .env.example.'
  );
}

const DEPLOYER_PRIVATE_KEY = process.env.VELA_DEPLOYER_PRIVATE_KEY;
if (!DEPLOYER_PRIVATE_KEY) {
  fatal(
    'FATAL: VELA_DEPLOYER_PRIVATE_KEY is not set.',
    '  A signing key must not be committed to this repository.'
  );
}

// Blocker B11: we have no application of our own — deployment is permissioned. The old
// APP_ID = 1 was a guess. applicationId is a uint64, so it must be a BigInt: vela-nova's
// real id (11579806367557720661) already exceeds Number.MAX_SAFE_INTEGER. Do NOT
// substitute that one either — it is somebody else's application.
const APP_ID_RAW = process.env.VELA_APPLICATION_ID;
if (!APP_ID_RAW || !/^\d+$/.test(APP_ID_RAW)) {
  fatal(
    'FATAL: VELA_APPLICATION_ID is not set to a decimal integer.',
    '  BLOCKED by B11: Vela deployment is permissioned and we have no application yet.',
    '  See VELA-TESTNET-CONSTANTS.md sections 5 and 8.3.'
  );
}
const APP_ID = BigInt(APP_ID_RAW);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

  console.log('Using address:', wallet.address);

  // Initialize Vela client
  const velaClient = new VelaClient(provider, PROCESSOR_ENDPOINT);
  await velaClient.init();

  switch (command) {
    case 'deploy':
      await deployApp(velaClient, wallet, args[1]);
      break;

    case 'deposit':
      await deposit(velaClient, wallet, args[1]);
      break;

    case 'borrow':
      await borrow(velaClient, wallet, args[1]);
      break;

    case 'repay':
      await repay(velaClient, wallet, args[1]);
      break;

    case 'withdraw':
      await withdraw(velaClient, wallet, args[1]);
      break;

    case 'view-balance':
      await viewBalance(velaClient, wallet);
      break;

    default:
      console.log('Usage: node test-client.js <command> [args]');
      console.log('Commands:');
      console.log('  deploy <wasm-sha256>    - Deploy the WASM app');
      console.log('  deposit <amount>        - Deposit collateral');
      console.log('  borrow <amount>         - Borrow against collateral');
      console.log('  repay <amount>          - Repay borrowed amount');
      console.log('  withdraw <amount>       - Withdraw collateral');
      console.log('  view-balance            - View private balance');
  }
}

async function deployApp(client: VelaClient, wallet: ethers.Wallet, wasmSha256: string) {
  console.log('\n📦 Deploying NoctFinance Demo App...\n');

  const deployDescriptor = {
    mode: 'artifact_ref',
    artifactId: `sha256:${wasmSha256}`,
    wasmSha256: wasmSha256,
    constructorParams: {
      collateral_ratio: 200,
      protocol_version: 'v0.1.0'
    }
  };

  const tx = await client.submitDeployRequest(wallet, deployDescriptor, {
    value: ethers.parseEther('0.01')
  });

  console.log('Deploy transaction:', tx.hash);
  const receipt = await tx.wait();
  console.log('✓ Deployed successfully');
  console.log('Application ID:', receipt.logs[0].data); // Extract from logs
}

async function deposit(client: VelaClient, wallet: ethers.Wallet, amount: string) {
  console.log(`\n💰 Depositing ${amount} as collateral...\n`);

  const payload = {
    operation: 'DEPOSIT',
    amount: '0x' + BigInt(amount).toString(16)
  };

  const encryptedPayload = await client.encryptPayload(JSON.stringify(payload));

  const tx = await client.submitRequest(wallet, APP_ID, 1, encryptedPayload, {
    tokenAddress: ethers.ZeroAddress,
    assetAmount: BigInt(amount),
    value: ethers.parseEther('0.001')
  });

  console.log('Transaction:', tx.hash);
  const receipt = await tx.wait();
  console.log('✓ Deposit successful');

  // Listen for encrypted event
  await listenForUserEvent(client, wallet);
}

async function borrow(client: VelaClient, wallet: ethers.Wallet, amount: string) {
  console.log(`\n🏦 Borrowing ${amount}...\n`);

  const payload = {
    operation: 'BORROW',
    amount: '0x' + BigInt(amount).toString(16)
  };

  const encryptedPayload = await client.encryptPayload(JSON.stringify(payload));

  const tx = await client.submitRequest(wallet, APP_ID, 1, encryptedPayload, {
    tokenAddress: ethers.ZeroAddress,
    assetAmount: 0,
    value: ethers.parseEther('0.001')
  });

  console.log('Transaction:', tx.hash);
  const receipt = await tx.wait();
  console.log('✓ Borrow successful');

  await listenForUserEvent(client, wallet);
}

async function repay(client: VelaClient, wallet: ethers.Wallet, amount: string) {
  console.log(`\n💵 Repaying ${amount}...\n`);

  const payload = {
    operation: 'REPAY',
    amount: '0x' + BigInt(amount).toString(16)
  };

  const encryptedPayload = await client.encryptPayload(JSON.stringify(payload));

  const tx = await client.submitRequest(wallet, APP_ID, 1, encryptedPayload, {
    tokenAddress: ethers.ZeroAddress,
    assetAmount: BigInt(amount),
    value: ethers.parseEther('0.001')
  });

  console.log('Transaction:', tx.hash);
  const receipt = await tx.wait();
  console.log('✓ Repayment successful');

  await listenForUserEvent(client, wallet);
}

async function withdraw(client: VelaClient, wallet: ethers.Wallet, amount: string) {
  console.log(`\n📤 Withdrawing ${amount} collateral...\n`);

  const payload = {
    operation: 'WITHDRAW',
    amount: '0x' + BigInt(amount).toString(16)
  };

  const encryptedPayload = await client.encryptPayload(JSON.stringify(payload));

  const tx = await client.submitRequest(wallet, APP_ID, 1, encryptedPayload, {
    tokenAddress: ethers.ZeroAddress,
    assetAmount: 0,
    value: ethers.parseEther('0.001')
  });

  console.log('Transaction:', tx.hash);
  const receipt = await tx.wait();
  console.log('✓ Withdrawal successful');

  await listenForUserEvent(client, wallet);
}

async function viewBalance(client: VelaClient, wallet: ethers.Wallet) {
  console.log('\n👁️  Requesting balance view...\n');

  const payload = {
    operation: 'VIEW_BALANCE'
  };

  const encryptedPayload = await client.encryptPayload(JSON.stringify(payload));

  const tx = await client.submitRequest(wallet, APP_ID, 1, encryptedPayload, {
    tokenAddress: ethers.ZeroAddress,
    assetAmount: 0,
    value: ethers.parseEther('0.001')
  });

  console.log('Transaction:', tx.hash);
  await tx.wait();

  await listenForUserEvent(client, wallet);
}

async function listenForUserEvent(client: VelaClient, wallet: ethers.Wallet) {
  console.log('\n📨 Waiting for encrypted response...\n');

  // In a real implementation, you would:
  // 1. Listen for UserEvent from the contract
  // 2. Decrypt it using your P-521 private key
  // 3. Display the decrypted balance information

  console.log('(Event listening logic would go here)');
  console.log('Check the subgraph or contract logs for events');
}

main().catch(console.error);
