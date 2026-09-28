import { ethers } from 'ethers';

// Read-only verification of the live Vela Base Sepolia instance.
// NO private key, NO transactions -- every call is an eth_call.
//
// Every accessor used below was CONFIRMED to exist on the deployed contract on
// 2026-09-28. Accessors that were tried and proven NOT to exist are listed at the bottom,
// so nobody re-adds them. Run:  cd deploy-scripts && node verify-vela-testnet.js
//
// This doubles as a REGRESSION CHECK. If any value drifts, the instance was upgraded or
// we are pointed at the wrong contract, and every constant derived from it -- including
// the ones hardcoded into .env.example and 14-DAY-ROADMAP.md -- must be re-verified.

const RPC_URL = (process.env.VELA_RPC_URL || '').trim() || 'https://sepolia.base.org';
const EXPECTED_CHAIN_ID = 84532n;
const PROCESSOR = (process.env.VELA_PROCESSOR_ENDPOINT || '').trim()
    || '0xd5E405a84753635608E7a28A59D7349BB2DAaEeF';
const TEE_AUTH = (process.env.VELA_TEE_AUTHENTICATOR || '').trim()
    || '0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3';

// Verified 2026-09-28. See VELA-TESTNET-CONSTANTS.md sections 1 and 8.
const EXPECTED = {
    DEPLOYER_ROLE: '0xfc425f2263d0df187444b70e47283d622c70181c5baebb1306a01edba1ce184c',
    RESET_OPERATOR: '0xc580ee26c87bb95870d138607be6d8598a348af3608b6ce0cef58e73a4c95917',
    DEFAULT_ADMIN_ROLE: '0x0000000000000000000000000000000000000000000000000000000000000000',
    tokenAllowlist: '0x8774E760B45a60a15B75770Fd7c60338006beEfa',   // B3, self-derived
    authorityRegistry: '0x754a26f68E3E4Fab1BD05FB6B227bedEC2e732d3' // B4, self-derived
};

// Horizen's deployer, read from the subgraph's DeployRequestSubmitted entities. It holds
// DEPLOYER_ROLE and RESET_OPERATOR but NOT DEFAULT_ADMIN_ROLE -- so a different, still
// unknown Horizen address is the admin who would have to grant us the role (blocker B11).
const HORIZEN_DEPLOYER = '0x2eaaf231ce583b7cd7ae02c03b8fe7a96f0aacb8';

const ABI = [
    'function DEPLOYER_ROLE() view returns (bytes32)',
    'function RESET_OPERATOR() view returns (bytes32)',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function tokenAllowlist() view returns (address)',
    'function authorityRegistry() view returns (address)'
];

let drift = 0;
function expect(label, actual, want) {
    const ok = String(actual).toLowerCase() === String(want).toLowerCase();
    if (!ok) drift++;
    console.log(`  ${ok ? 'MATCH' : 'DRIFT'}  ${label}`);
    console.log(`         got  ${actual}`);
    if (!ok) console.log(`         want ${want}`);
}

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = (await provider.getNetwork()).chainId;
    console.log(`RPC:     ${RPC_URL}`);
    console.log(`chainId: ${chainId}`);
    if (chainId !== EXPECTED_CHAIN_ID) {
        console.error('FATAL: wrong chain -- refusing to record any result from it.');
        process.exit(1);
    }

    for (const [name, addr] of [['ProcessorEndpoint', PROCESSOR], ['TeeAuthenticator', TEE_AUTH],
        ['tokenAllowlist', EXPECTED.tokenAllowlist], ['authorityRegistry', EXPECTED.authorityRegistry]]) {
        const bytes = ((await provider.getCode(addr)).length - 2) / 2;
        console.log(`${name.padEnd(17)} ${addr}  ${bytes} bytes`);
        if (bytes === 0) { console.error(`FATAL: no code at ${name}. Aborting.`); process.exit(1); }
    }

    const p = new ethers.Contract(PROCESSOR, ABI, provider);

    console.log('\n-- Role hashes --');
    expect('DEPLOYER_ROLE()', await p.DEPLOYER_ROLE(), EXPECTED.DEPLOYER_ROLE);
    expect('RESET_OPERATOR()', await p.RESET_OPERATOR(), EXPECTED.RESET_OPERATOR);
    expect('DEFAULT_ADMIN_ROLE()', await p.DEFAULT_ADMIN_ROLE(), EXPECTED.DEFAULT_ADMIN_ROLE);

    console.log('\n-- Dependent contracts (B3, B4) --');
    expect('tokenAllowlist()', await p.tokenAllowlist(), EXPECTED.tokenAllowlist);
    expect('authorityRegistry()', await p.authorityRegistry(), EXPECTED.authorityRegistry);

    console.log('\n-- B11: who is allowed to deploy? --');
    const [dr, ro, ad] = [await p.DEPLOYER_ROLE(), await p.RESET_OPERATOR(), await p.DEFAULT_ADMIN_ROLE()];
    expect(`hasRole(DEPLOYER_ROLE, ${HORIZEN_DEPLOYER})`, await p.hasRole(dr, HORIZEN_DEPLOYER), true);
    expect(`hasRole(RESET_OPERATOR, ${HORIZEN_DEPLOYER})`, await p.hasRole(ro, HORIZEN_DEPLOYER), true);
    expect(`hasRole(DEFAULT_ADMIN_ROLE, ${HORIZEN_DEPLOYER})`, await p.hasRole(ad, HORIZEN_DEPLOYER), false);
    console.log('  => Horizen ops can deploy and reset, but a SEPARATE unknown address holds');
    console.log('     DEFAULT_ADMIN_ROLE. That admin is who must grant us DEPLOYER_ROLE.');

    console.log(drift === 0
        ? '\nALL CHECKS MATCH the values recorded in VELA-TESTNET-CONSTANTS.md.'
        : `\n${drift} CHECK(S) DRIFTED -- re-verify every derived constant before use.`);
    process.exit(drift === 0 ? 0 : 2);
}

main().catch((e) => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });

// PROVEN NOT TO EXIST on ProcessorEndpoint (2026-09-28; every call reverted with no data):
//   getApplicationState(uint64)  getApplicationData(uint64)  applications(uint64)
//   getApplication(uint64)  getApp(uint64)  appStates(uint64)  applicationStates(uint64)
//   resetOperator()  operator()  getResetOperator()
// deploy-scripts/check-app-state.js is built on the first two and therefore cannot work.
// Application state is observable only through the Goldsky subgraph, not the contract.
