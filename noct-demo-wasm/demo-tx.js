import { ethers } from 'ethers';

async function runDemo() {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    const wallet = new ethers.Wallet(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        provider
    );

    // TODO: Replace this with your actual ProcessorEndpoint address from deployer logs
    const processorAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    const abi = [
        "function submitRequest(uint8 protocolVersion, uint64 applicationId, uint8 requestType, bytes memory payload, address tokenAddress, uint256 assetAmount, uint256 maxFeeValue) public payable"
    ];

    const processor = new ethers.Contract(processorAddress, abi, wallet);

    console.log('🏦 NoctFinance Demo - Running Transactions\n');
    console.log('Wallet:', wallet.address);
    console.log('ProcessorEndpoint:', processorAddress);
    console.log('Application ID: 1\n');

    // Transaction 1: Deposit 1000 USDC
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💰 Transaction 1: DEPOSIT 1000 USDC');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    let payload = JSON.stringify({
        operation: "DEPOSIT",
        amount: "0x3b9aca00" // 1000000000 (1000 USDC with 6 decimals)
    });

    let tx = await processor.submitRequest(
        1, // protocol version
        1, // app ID
        1, // PROCESS request type
        ethers.toUtf8Bytes(payload),
        ethers.ZeroAddress,
        1000000000n, // asset amount
        ethers.parseEther('0.001'),
        { value: ethers.parseEther('0.001') + 1000000000n }
    );

    console.log('📤 Tx:', tx.hash);
    await tx.wait();
    console.log('✅ Confirmed!\n');

    await new Promise(r => setTimeout(r, 3000));

    // Transaction 2: Borrow 400 USDC
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏦 Transaction 2: BORROW 400 USDC');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    payload = JSON.stringify({
        operation: "BORROW",
        amount: "0x17d78400" // 400000000 (400 USDC)
    });

    tx = await processor.submitRequest(
        1, 1, 1,
        ethers.toUtf8Bytes(payload),
        ethers.ZeroAddress,
        0n,
        ethers.parseEther('0.001'),
        { value: ethers.parseEther('0.001') }
    );

    console.log('📤 Tx:', tx.hash);
    await tx.wait();
    console.log('✅ Confirmed!\n');

    await new Promise(r => setTimeout(r, 3000));

    // Transaction 3: View Balance
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👁️  Transaction 3: VIEW BALANCE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    payload = JSON.stringify({
        operation: "VIEW_BALANCE"
    });

    tx = await processor.submitRequest(
        1, 1, 1,
        ethers.toUtf8Bytes(payload),
        ethers.ZeroAddress,
        0n,
        ethers.parseEther('0.001'),
        { value: ethers.parseEther('0.001') }
    );

    console.log('📤 Tx:', tx.hash);
    await tx.wait();
    console.log('✅ Confirmed!\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Demo Complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nCheck Docker logs to see TEE execution:');
    console.log('  docker logs vela-skit-manager -f');
}

runDemo().catch(console.error);
