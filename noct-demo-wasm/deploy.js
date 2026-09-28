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

    // Blocker B1 is RESOLVED (2026-09-28): the Base Sepolia ProcessorEndpoint is
    // 0xd5E405a84753635608E7a28A59D7349BB2DAaEeF, verified three independent ways --
    // Horizen's reply, eth_getCode on the live RPC (46,494 hex chars of bytecode) and
    // the facilitator status page. It is recorded in .env.example. Still read from the
    // environment, so this script cannot silently target the wrong chain or instance.
    //
    // The value previously hardcoded here (0x5FbDB2315678afecb367f032d93F642f64180aa3)
    // was merely the first address a fresh Hardhat/Anvil chain assigns -- a guess
    // dressed up by a "TODO: replace with your actual address" comment. Deploying
    // against a guessed address is what 14-DAY-ROADMAP.md Day 13 explicitly forbids.
    const processorAddress = process.env.VELA_PROCESSOR_ENDPOINT;
    if (!processorAddress || !/^0x[0-9a-fA-F]{40}$/.test(processorAddress)) {
        console.error('FATAL: VELA_PROCESSOR_ENDPOINT is not set to a valid address.');
        console.error('  Blocker B1 IS resolved -- the verified value is in .env.example.');
        console.error('  Set it only from an address the Vela deployer actually reported.');
        process.exit(1);
    }

    // Blocker B11 (CRITICAL, learned 2026-09-28): Vela deployment is PERMISSIONED.
    // Horizen state that "only Horizen can deploy new apps", and the vela-nova wallet
    // README names the mechanism -- the deploy sender must hold DEPLOYER_ROLE on the
    // ProcessorEndpoint. The only app installed on either instance is vela-nova.
    // This transaction will therefore revert on Base Sepolia until that role is granted
    // to our address, or Horizen deploys the artifact for us. Warn loudly rather than
    // letting it surface as an opaque revert.
    console.error('NOTE: deployment is permissioned (blocker B11). Unless this wallet holds');
    console.error('      DEPLOYER_ROLE on the ProcessorEndpoint, this call WILL revert.');
    console.error('      See VELA-TESTNET-CONSTANTS.md section 5.');

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
    // This line previously printed a hardcoded "Application ID: 1". That was a guess.
    // The ID is assigned by the chain at deploy time and MUST be read back, never
    // assumed (File 31 assertion 5). We do not yet have a verified event ABI to parse it
    // from, so dump the raw logs and require the operator to record the real value.
    console.log('Deploy receipt logs (parse the assigned ApplicationID from these):');
    for (const log of receipt.logs) {
        const data = log.data.length > 66 ? log.data.slice(0, 66) + '...' : log.data;
        console.log(`   ${log.address}  topic0=${log.topics[0]}  data=${data}`);
    }
    console.log('');
    console.log('ACTION REQUIRED: record the real ApplicationID in the Day 13 completion');
    console.log('record. Do NOT assume it, and do NOT reuse vela-nova');
    console.log('11579806367557720661 -- that is somebody else\'s application.');
}

deploy().catch(console.error);
