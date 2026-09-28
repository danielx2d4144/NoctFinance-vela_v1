import { ethers } from 'ethers';

// Read-only check of who holds which AccessControl role on the live Vela ProcessorEndpoint.
// No private key, no transactions -- only eth_call.
//
// This file previously pointed at an Anvil mock (0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9)
// and at Anvil's account #0, so it could only ever report on a local chain that no longer
// exists. It now targets the verified Base Sepolia contract (blocker B1) and defaults to
// Horizen's deployer, the address that actually holds DEPLOYER_ROLE.
//
// Usage: node check-role.js [addressToCheck]
// See also verify-vela-testnet.js, which asserts these values as a regression check.

const RPC_URL = (process.env.VELA_RPC_URL || '').trim() || 'https://sepolia.base.org';
const EXPECTED_CHAIN_ID = 84532n;
const PROCESSOR = (process.env.VELA_PROCESSOR_ENDPOINT || '').trim()
    || '0xd5E405a84753635608E7a28A59D7349BB2DAaEeF';

// Verified role hashes -- VELA-TESTNET-CONSTANTS.md section 8.3.
const ROLES = {
    DEPLOYER_ROLE: '0xfc425f2263d0df187444b70e47283d622c70181c5baebb1306a01edba1ce184c',
    RESET_OPERATOR: '0xc580ee26c87bb95870d138607be6d8598a348af3608b6ce0cef58e73a4c95917',
    DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000'
};

// Horizen's deployer, from the subgraph's DeployRequestSubmitted.sender.
const DEFAULT_TARGET = (process.env.VELA_HORIZEN_DEPLOYER || '').trim()
    || '0x2eaaf231ce583b7cd7ae02c03b8fe7a96f0aacb8';

const ABI = [
    'function DEPLOYER_ROLE() view returns (bytes32)',
    'function RESET_OPERATOR() view returns (bytes32)',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
    'function hasRole(bytes32 role, address account) view returns (bool)'
];

async function main() {
    const target = (process.argv[2] || DEFAULT_TARGET).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
        console.error(`FATAL: not a valid 20-byte address: ${target}`);
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = (await provider.getNetwork()).chainId;
    if (chainId !== EXPECTED_CHAIN_ID) {
        console.error(`FATAL: chainId ${chainId}, expected ${EXPECTED_CHAIN_ID}.`);
        console.error('  Refusing to report role membership for the wrong chain.');
        process.exit(1);
    }
    if ((await provider.getCode(PROCESSOR)) === '0x') {
        console.error(`FATAL: no contract at ${PROCESSOR}.`);
        process.exit(1);
    }

    const p = new ethers.Contract(PROCESSOR, ABI, provider);
    console.log(`Processor: ${PROCESSOR}  (chainId ${chainId})`);
    console.log(`Account:   ${target}\n`);

    // Re-check the recorded role hashes first, so a silent protocol upgrade cannot make the
    // membership answers below meaningless while still looking authoritative.
    let drift = 0;
    for (const [name, want] of Object.entries(ROLES)) {
        const got = String(await p[name]()).toLowerCase();
        if (got !== want.toLowerCase()) {
            drift++;
            console.log(`DRIFT  ${name} = ${got}`);
            console.log(`       recorded ${want}`);
        }
    }
    if (drift) {
        console.error(`\nFATAL: ${drift} role hash(es) drifted. Re-verify`);
        console.error('  VELA-TESTNET-CONSTANTS.md section 8 before trusting any answer here.');
        process.exit(2);
    }

    let any = false;
    for (const [name, hash] of Object.entries(ROLES)) {
        const has = await p.hasRole(hash, target);
        if (has) any = true;
        console.log(`  hasRole(${name.padEnd(18)}) = ${has}`);
    }

    console.log('');
    if (any) {
        console.log('This account holds at least one role. If DEPLOYER_ROLE is among them,');
        console.log('it can deploy a Vela application on this instance.');
    } else {
        console.log('This account holds NO role on the ProcessorEndpoint, so it cannot deploy');
        console.log('an application (blocker B11). DEFAULT_ADMIN_ROLE is held by an address we');
        console.log('have not identified, and only that admin can grant DEPLOYER_ROLE --');
        console.log("Horizen's own deployer does not hold it either.");
    }
}

main().catch((e) => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
