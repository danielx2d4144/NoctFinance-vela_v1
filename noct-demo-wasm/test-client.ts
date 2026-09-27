import { VelaClient } from '@horizenofficial/vela-common-ts';
import { ethers } from 'ethers';

// Configuration
const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0x...'; // From docker logs after deployment
const APP_ID = 1; // Your deployed app ID

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);

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
