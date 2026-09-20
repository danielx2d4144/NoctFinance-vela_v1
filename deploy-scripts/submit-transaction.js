import { ethers } from 'ethers';

// Configuration
const RPC_URL = 'http://localhost:8545';
const PROCESSOR_ENDPOINT = '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9';

// User account (default Anvil account #0)
const USER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Your deployed application ID (as BigInt for large numbers)
const APP_ID = 2397975349340933566n;

// ProcessorEndpoint ABI
const PROCESSOR_ABI = [
  "function submitRequest(uint64 applicationId, uint8 requestType, bytes memory encryptedPayload, address tokenAddress, uint256 assetAmount) external payable returns (uint256)",
  "event ProcessRequest(uint256 indexed requestId, uint64 indexed applicationId, address indexed sender, uint8 requestType)"
];

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const amount = args[1] || '0';

  if (!command) {
    console.log('Usage: node submit-transaction.js <command> [amount]');
    console.log('Commands:');
    console.log('  deposit <amount>   - Deposit collateral (in wei)');
    console.log('  borrow <amount>    - Borrow against collateral');
    console.log('  repay <amount>     - Repay borrowed amount');
    console.log('  withdraw <amount>  - Withdraw collateral');
    console.log('  balance            - View account balance');
    console.log('');
    console.log('Example: node submit-transaction.js deposit 1000000000000000000');
    process.exit(0);
  }

  console.log(`🚀 NoctFinance Transaction: ${command.toUpperCase()}\n`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(USER_PRIVATE_KEY, provider);

  console.log('📍 User address:', wallet.address);
  console.log('📍 Application ID:', APP_ID);
  console.log('');

  // Create payload based on command
  let payload;
  let requestType = 1; // Process request
  let assetAmount = 0n;

  switch (command) {
    case 'deposit':
      payload = {
        operation: 'DEPOSIT',
        amount: amount
      };
      assetAmount = BigInt(amount);
      console.log('💰 Depositing:', ethers.formatEther(amount), 'ETH as collateral');
      break;

    case 'borrow':
      payload = {
        operation: 'BORROW',
        amount: amount
      };
      console.log('🏦 Borrowing:', ethers.formatEther(amount), 'ETH');
      break;

    case 'repay':
      payload = {
        operation: 'REPAY',
        amount: amount
      };
      assetAmount = BigInt(amount);
      console.log('💵 Repaying:', ethers.formatEther(amount), 'ETH');
      break;

    case 'withdraw':
      payload = {
        operation: 'WITHDRAW',
        amount: amount
      };
      console.log('📤 Withdrawing:', ethers.formatEther(amount), 'ETH collateral');
      break;

    case 'balance':
      payload = {
        operation: 'VIEW_BALANCE'
      };
      console.log('👁️  Requesting balance view');
      break;

    default:
      console.error('Unknown command:', command);
      process.exit(1);
  }

  console.log('');

  // For simplicity, we're sending unencrypted payload
  // In production, this would be encrypted with TEE's P-521 public key
  const payloadBytes = ethers.toUtf8Bytes(JSON.stringify(payload));

  console.log('📦 Payload:', JSON.stringify(payload, null, 2));
  console.log('');

  // Submit request
  const processor = new ethers.Contract(PROCESSOR_ENDPOINT, PROCESSOR_ABI, wallet);

  try {
    const tx = await processor.submitRequest(
      APP_ID,
      requestType,
      payloadBytes,
      ethers.ZeroAddress, // Native token
      assetAmount,
      {
        value: assetAmount + ethers.parseEther('0.001') // asset + fee
      }
    );

    console.log('📤 Transaction sent:', tx.hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed in block:', receipt.blockNumber);

    // Parse events
    for (const log of receipt.logs) {
      try {
        const parsed = processor.interface.parseLog(log);
        if (parsed.name === 'ProcessRequest') {
          console.log('🎉 Process Request ID:', parsed.args.requestId.toString());
        }
      } catch (e) {
        // Not our event
      }
    }

    console.log('');
    console.log('✅ Transaction submitted successfully!');
    console.log('');
    console.log('📊 Watch the execution:');
    console.log('   docker logs vela-skit-manager -f');
    console.log('');
    console.log('You should see:');
    console.log('   - Manager picks up the request');
    console.log('   - Fetches encrypted state');
    console.log('   - Sends to Executor TEE');
    console.log('   - Your WASM processes the', command);
    console.log('   - New state encrypted and signed');
    console.log('   - Result published on-chain');

  } catch (error) {
    console.error('❌ Transaction failed:', error.message);
    if (error.data) {
      console.error('   Error data:', error.data);
    }
    process.exit(1);
  }
}

main().catch(console.error);
