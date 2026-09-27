import { ethers } from 'ethers';

async function deploy() {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    const wallet = new ethers.Wallet(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        provider
    );

    // TODO: Replace this with your actual ProcessorEndpoint address from deployer logs
    const processorAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    const abi = [
        "function submitDeployRequest(uint8 protocolVersion, bytes memory payload) public payable"
    ];

    const processor = new ethers.Contract(processorAddress, abi, wallet);

    const deployPayload = JSON.stringify({
        mode: "artifact_ref",
        artifactId: "sha256:d0df4baedfc0ee1572d1d6910eae4ec4093e06a267ee9e642d54077eafdd8243",
        wasmSha256: "d0df4baedfc0ee1572d1d6910eae4ec4093e06a267ee9e642d54077eafdd8243",
        constructorParams: {
            collateral_ratio: 200,
            protocol_version: "v0.1.0"
        }
    });

    console.log('🚀 Deploying NoctFinance WASM to Vela...');
    console.log('Wallet:', wallet.address);
    console.log('ProcessorEndpoint:', processorAddress);

    const tx = await processor.submitDeployRequest(
        1,
        ethers.toUtf8Bytes(deployPayload),
        { value: ethers.parseEther('0.01') }
    );

    console.log('📤 Transaction:', tx.hash);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('✅ Deployed in block:', receipt.blockNumber);
    console.log('Application ID: 1');
}

deploy().catch(console.error);
