import { ethers } from 'ethers';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(here, 'noct-demo.wasm');
const provenancePath = wasmPath + '.provenance.txt';

// The artifact hash is COMPUTED from the file being deployed, never hardcoded.
// This file previously carried the literal
//   d0df4baedfc0ee1572d1d6910eae4ec4093e06a267ee9e642d54077eafdd8243
// under the comment "from successful upload". That value matches no artifact in
// this repository -- not the current gated build, not the stale 966,462-byte
// module it replaced. A hardcoded hash cannot drift visibly, so it lies quietly.
let wasmBytes;
try {
    wasmBytes = readFileSync(wasmPath);
} catch {
    console.error(`FATAL: ${wasmPath} not found. Build it first:`);
    console.error('  powershell -ExecutionPolicy Bypass -File tools/build-guest.ps1');
    process.exit(1);
}
const WASM_HASH = createHash('sha256').update(wasmBytes).digest('hex');

// Fail closed on a verification build. tools/build-guest.ps1 writes this sidecar;
// only -Release produces a release artifact, and it requires real binaryen.
let provenance;
try {
    provenance = readFileSync(provenancePath, 'utf8');
} catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.error(`FATAL: no provenance sidecar at ${provenancePath}.`);
    console.error('  Cannot confirm what this artifact was built with, so it must not ship.');
    console.error('  Re-run tools/build-guest.ps1, which writes the sidecar.');
    process.exit(1);
}
const provStatus = (provenance.match(/^\s*status\s*:\s*(.+)$/m) || [, ''])[1].trim();
if (/VERIFICATION-ONLY/i.test(provStatus)) {
    console.error('FATAL: refusing to deploy a VERIFICATION-ONLY artifact.');
    console.error(`  provenance status: ${provStatus}`);
    console.error('  It was built with the wasm-opt stub, not real binaryen.');
    console.error('  Rebuild with: tools/build-guest.ps1 -Release');
    if (!process.argv.includes('--allow-verification-build')) process.exit(1);
    console.error('  --allow-verification-build given: proceeding for LOCAL TESTING ONLY.');
}

async function deploy() {
    const rpcUrl = process.env.VELA_RPC_URL || 'http://localhost:8545';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const deployerKey = process.env.VELA_DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) {
        console.error('FATAL: VELA_DEPLOYER_PRIVATE_KEY is not set.');
        console.error('  A signing key must not be committed to this repository.');
        process.exit(1);
    }
    const wallet = new ethers.Wallet(deployerKey, provider);

    // Blocker B1: the ProcessorEndpoint address is NOT known. The value previously
    // hardcoded here (0x5FbDB2315678afecb367f032d93F642f64180aa3) is merely the
    // first address a fresh Hardhat/Anvil chain assigns -- a guess dressed up by a
    // "TODO: replace with your actual address" comment. Deploying against a guessed
    // address is what 14-DAY-ROADMAP.md Day 13 explicitly forbids.
    const processorAddress = process.env.VELA_PROCESSOR_ENDPOINT;
    if (!processorAddress || !/^0x[0-9a-fA-F]{40}$/.test(processorAddress)) {
        console.error('FATAL: VELA_PROCESSOR_ENDPOINT is not set to a valid address.');
        console.error('  Blocker B1 is unresolved -- see VELA-DEV-TEAM-REQUEST.md.');
        console.error('  Set it only from an address the Vela deployer actually reported.');
        process.exit(1);
    }

    const abi = [
        "function submitDeployRequest(uint8 protocolVersion, bytes memory payload) public payable"
    ];

    const processor = new ethers.Contract(processorAddress, abi, wallet);

    const deployPayload = JSON.stringify({
        mode: "artifact_ref",
        artifactId: `sha256:${WASM_HASH}`,
        wasmSha256: WASM_HASH,
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
