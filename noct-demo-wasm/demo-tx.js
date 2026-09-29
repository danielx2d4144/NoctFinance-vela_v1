import { ethers } from 'ethers';

// Nothing here is hardcoded any more. This file previously carried three values that
// would each have failed silently or leaked: the well-known Anvil dev key
// (0xac0974bec3...ff80, committed to a public repo), a guessed processorAddress
// (0x5FbDB2315678afecb367f032d93F642f64180aa3 -- just the first address a fresh
// Hardhat/Anvil chain assigns), and applicationId 1 (assumed; the real ID is assigned
// at deploy time). Values now come from the environment (see .env.example) and fail
// closed when absent.

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

function requireAppId() {
    const raw = requireEnv('VELA_APPLICATION_ID', [
        'BLOCKED by B11: Vela deployment is permissioned and we have no application yet.',
        'Do NOT substitute vela-nova 11579806367557720661 -- that is a different app.',
        'See VELA-TESTNET-CONSTANTS.md section 5.'
    ]);
    if (!/^\d+$/.test(raw)) {
        console.error(`FATAL: VELA_APPLICATION_ID must be a decimal integer, got: ${raw}`);
        process.exit(1);
    }
    return BigInt(raw);
}

async function runDemo() {
    const rpcUrl = (process.env.VELA_RPC_URL || '').trim() || 'http://localhost:8545';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const privateKey = requireEnv('VELA_DEPLOYER_PRIVATE_KEY', [
        'A signing key must never be committed to this repository.'
    ]);
    const wallet = new ethers.Wallet(privateKey, provider);

    // B1 RESOLVED (2026-09-28): the Base Sepolia ProcessorEndpoint is
    // 0xd5E405a84753635608E7a28A59D7349BB2DAaEeF -- verified via Horizen's reply,
    // eth_getCode on the live RPC and the facilitator status page. Still read from the
    // environment so this script cannot silently target the wrong chain.
    const processorAddress = requireAddress('VELA_PROCESSOR_ENDPOINT', [
        'Blocker B1 IS resolved -- the verified value is in .env.example.'
    ]);
    const appId = requireAppId();

    // RESOLVED 2026-09-28. Both contradictions recorded here are now settled from the
    // deployed contract rather than from docs:
    //   * the 7-argument submitRequest below is the real one. inspect-selectors.js recovered
    //     selector 2fbfa0d5 = submitRequest(uint8,uint64,uint8,bytes,address,uint256,uint256)
    //     from the live bytecode; no selector for a 5-argument form exists. The sibling
    //     script deploy-scripts/submit-transaction.js has been corrected to match.
    //   * protocolVersion is 0, not 1. PROTOCOL_VERSION() is a public getter on the live
    //     ProcessorEndpoint and returns 0 (see check-processor-state.js), matching
    //     vela-common-ts/src/constants.ts. Sending 1 would have been rejected.
    // The return type is bytes32 (the requestId), not uint256.
    const PROTOCOL_VERSION = 0;
    const abi = [
        "function submitRequest(uint8 protocolVersion, uint64 applicationId, uint8 requestType, bytes calldata payload, address tokenAddress, uint256 assetAmount, uint256 maxFeeValue) external payable returns (bytes32)"
    ];
    const processor = new ethers.Contract(processorAddress, abi, wallet);

    console.log('🏦 NoctFinance Demo - Running Transactions\n');
    console.log('RPC:               ', rpcUrl);
    console.log('Wallet:            ', wallet.address);
    console.log('ProcessorEndpoint: ', processorAddress);
    console.log('Application ID:    ', appId.toString(), '\n');

    // LOCAL-DEMO SHORTCUT -- NOT valid against a real Vela instance. A real PROCESS
    // request carries an ECIES-encrypted PayloadInstructions blob keyed to the enclave's
    // P-521 public key (133 bytes, 0x04 || x || y), not plaintext JSON. Sending this to
    // Base Sepolia would be rejected, or would leak the operation and amount and defeat
    // the privacy model in Files 05 and 21. Kept only so the local Anvil demo still runs.
    const rule = '━'.repeat(32);
    async function submit(label, emoji, payloadObj, assetAmount, nativeValue) {
        console.log(rule);
        console.log(`${emoji} ${label}`);
        console.log(rule);
        const tx = await processor.submitRequest(
            PROTOCOL_VERSION,
            appId,
            1, // PROCESS request type
            ethers.toUtf8Bytes(JSON.stringify(payloadObj)),
            ethers.ZeroAddress,
            assetAmount,
            ethers.parseEther('0.001'),
            { value: nativeValue }
        );
        console.log('📤 Tx:', tx.hash);
        await tx.wait();
        console.log('✅ Confirmed!\n');
        await new Promise(r => setTimeout(r, 3000));
    }

    // Deposit 1000 USDC (6 decimals -> 1000000000 base units)
    await submit('Transaction 1: DEPOSIT 1000 USDC', '💰',
        { operation: 'DEPOSIT', amount: '0x3b9aca00' },
        1000000000n,
        ethers.parseEther('0.001') + 1000000000n);

    // Borrow 400 USDC (400000000 base units)
    await submit('Transaction 2: BORROW 400 USDC', '🏦',
        { operation: 'BORROW', amount: '0x17d78400' },
        0n,
        ethers.parseEther('0.001'));

    await submit('Transaction 3: VIEW BALANCE', '👁️',
        { operation: 'VIEW_BALANCE' },
        0n,
        ethers.parseEther('0.001'));

    console.log(rule);
    console.log('✅ Demo Complete!');
    console.log(rule);
    console.log('\nCheck Docker logs to see TEE execution:');
    console.log('  docker logs vela-skit-manager -f');
}

runDemo().catch(console.error);
