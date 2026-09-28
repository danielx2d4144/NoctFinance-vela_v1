import { ethers } from 'ethers';

// ── Configuration ─────────────────────────────────────────────────────────────
// Nothing here is hardcoded any more. This file previously carried three fabricated
// values, each of which would have failed silently or spent testnet gas against a
// contract that is not ours:
//   PROCESSOR_ENDPOINT 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9 -- an Anvil mock,
//                      not the real Base Sepolia ProcessorEndpoint
//   USER_PRIVATE_KEY   0xac0974bec3...ff80 -- the well-known Anvil dev key, committed
//                      to a public repository
//   APP_ID             2397975349340933566n -- FABRICATED. It matches no Vela instance
//                      on either chain and was formally retracted in the root commit.
// Values now come from the environment (see .env.example) and fail closed when absent.

function requireEnv(name, hints) {
    const v = process.env[name];
    if (v === undefined || v.trim() === '') {
        console.error(`FATAL: ${name} is not set.`);
        for (const h of hints || []) console.error(`  ${h}`);
        console.error('  Copy .env.example to .env, fill it in, then export it.');
        process.exit(1);
    }
    return v.trim();
}

function requireAddress(name, hints) {
    const v = requireEnv(name, hints);
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
        console.error(`FATAL: ${name} is not a valid 20-byte address: ${v}`);
        process.exit(1);
    }
    return v;
}

// ProcessorEndpoint ABI.
// ⚠️ UNVERIFIED. This signature was written before the real address was known and has
//    never been checked against the deployed contract. Now that B1 is resolved
//    (0xd5E405a84753635608E7a28A59D7349BB2DAaEeF on Base Sepolia), confirm it against
//    the actual bytecode/ABI before trusting a successful call. Note the sibling script
//    noct-demo-wasm/demo-tx.js declares a DIFFERENT submitRequest signature -- at most
//    one of them can be right.
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

  // Setup provider and wallet - everything from the environment, fail closed.
  const rpcUrl = (process.env.VELA_RPC_URL || '').trim() || 'http://localhost:8545';
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const privateKey = requireEnv('VELA_DEPLOYER_PRIVATE_KEY', [
    'A signing key must never be committed to this repository.'
  ]);
  const wallet = new ethers.Wallet(privateKey, provider);

  const processorAddress = requireAddress('VELA_PROCESSOR_ENDPOINT', [
    'Blocker B1 is RESOLVED: the verified Base Sepolia value is in .env.example.'
  ]);

  // Blocker B11: we have no application of our own. Vela deployment is permissioned --
  // only Horizen can deploy, and the deploy sender needs DEPLOYER_ROLE on the
  // ProcessorEndpoint. Until that grant exists nothing here can submit a real request,
  // so a missing ID is a hard stop rather than a defaulted one.
  const appIdRaw = requireEnv('VELA_APPLICATION_ID', [
    'BLOCKED by B11: deployment is permissioned and we have no application yet.',
    'Do NOT substitute vela-nova 11579806367557720661 -- that is a different app.',
    'See VELA-TESTNET-CONSTANTS.md section 5.'
  ]);
  if (!/^\d+$/.test(appIdRaw)) {
    console.error(`FATAL: VELA_APPLICATION_ID must be a decimal integer, got: ${appIdRaw}`);
    process.exit(1);
  }
  const appId = BigInt(appIdRaw);

  console.log('   RPC:               ', rpcUrl);
  console.log('   ProcessorEndpoint: ', processorAddress);

  console.log('📍 User address:', wallet.address);
  console.log('📍 Application ID:', appId.toString());
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

  // LOCAL-DEMO SHORTCUT -- NOT valid against a real Vela instance.
  // A real PROCESS request carries an ECIES-encrypted PayloadInstructions blob keyed to
  // the enclave's P-521 public key (133 bytes, 0x04 || x || y), not plaintext JSON.
  // Sending this to Base Sepolia would be rejected, or would leak the operation and
  // amount and defeat the privacy model in Files 05 and 21. Kept only so the local
  // Anvil demo path still runs. Do not point this at testnet.
  const payloadBytes = ethers.toUtf8Bytes(JSON.stringify(payload));

  console.log('📦 Payload:', JSON.stringify(payload, null, 2));
  console.log('');

  // Submit request
  const processor = new ethers.Contract(processorAddress, PROCESSOR_ABI, wallet);

  try {
    const tx = await processor.submitRequest(
      appId,
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
