import { ethers } from 'ethers';

// Extract the function selectors actually present in a deployed contract's runtime bytecode and
// match them against a candidate signature list.
//
// Why: the Masterclass reply pointed us at main's TeeAuthenticator.sol, but eth_call showed the
// live Base Sepolia contract has no pcr0(), nitroProver() or maxVerificationAge(). Basescan
// reports it as unverified, so the only way to learn its real interface is to read the bytecode.
// This settles "which branch is deployed" from evidence instead of from a link in an email.
//
// Usage: node inspect-selectors.js [address]

const RPC_URL = (process.env.VELA_RPC_URL || '').trim() || 'https://sepolia.base.org';
const EXPECTED_CHAIN_ID = 84532n;

const TARGET = (process.argv[2] || process.env.VELA_TEE_AUTHENTICATOR || '')
    .trim() || '0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3';

// Candidate signatures drawn from main and pc/tee_upgrade of HorizenOfficial/vela.
const CANDIDATES = [
    // Ownable
    'owner()', 'renounceOwnership()', 'transferOwnership(address)',
    // TeeAuthenticator as it appears in main
    'pcr0()', 'nitroProver()', 'maxVerificationAge()', 'teeSigner()', 'pubSecp521r1()',
    'currentUpdateStep()', 'step2CurrentIndex()', 'getStep2TotalLength()',
    'updateTee(bytes)', 'updatePcr0(bytes)', 'updateTeeStep1(bytes)', 'updateTeeStep2()',
    'updateTeeStep3()', 'updateTeeStep4()', 'PK_LENGTH()',
    // ITeeAuthenticator
    'getTeeSigner()', 'getPubSecp521r1()', 'checkSignature(bytes32,bytes)',
    // older / alternative attestation schemes worth ruling in or out
    'attestation()', 'attestationNonce()', 'verifier()', 'attestationVerifier()',
    'nitroVerifier()', 'enclaveKey()', 'userData()', 'pcrs()', 'measurement()',
    'setTeeSigner(address)', 'registerTee(address,bytes)', 'updateTee(address,bytes)',
    'setAttestation(bytes)', 'verify(bytes)', 'isValidSignature(bytes32,bytes)',
    // AccessControl
    'DEFAULT_ADMIN_ROLE()', 'DEPLOYER_ROLE()', 'RESET_OPERATOR()',
    'hasRole(bytes32,address)', 'grantRole(bytes32,address)', 'getRoleAdmin(bytes32)',
    // ProcessorEndpoint -- signatures taken verbatim from IProcessorEndpoint.sol (identical on
    // main and pc/tee_upgrade). Both submitRequest overloads our scripts disagree about are
    // listed so the bytecode decides which one is really deployed.
    'submitRequest(uint8,uint64,uint8,bytes,address,uint256,uint256)',
    'submitRequest(uint64,uint8,bytes,address,uint256)',
    'submitRequestFor(address,uint8,uint64,uint8,bytes,address,uint256,uint256,bytes,bytes)',
    'submitDeployRequest(uint8,bytes)',
    'submitDeployRequestWithTrigger(uint8,bytes,address)',
    'stateUpdate(uint64,bytes32,bytes32,bytes32,(bytes[],bytes32[]),(bytes[],bytes32[]),(address,address,uint256)[],uint256,uint256,uint8,string,bytes)',
    'adminReset()', 'adminResetApps(uint64[])', 'adminResetApps(uint64[],address[])',
    'appCustody(uint64,address)', 'totalAppCustody(address)',
    'pendingClaims(address,address)', 'totalPendingClaims(address)', 'claim(address,address)',
    'generateRequestId(address,uint64,uint8,bytes32,address,uint256,uint256)',
    'getNextPendingRequest()', 'isCurrentPendingRequest(bytes32)',
    'getPendingRequestsSize()', 'getTriggerQueueSize()', 'getTriggerQueue()',
    'applicationStateRoots(uint64)', 'triggerContracts(uint64)', 'getFacilitatorNonce(address)',
    'teeAuthenticator()', 'tokenAllowlist()', 'availableDeploySlots()',
    'getDeployedAppIds()', 'getAllowedTokens()', 'allowedTokens(address)',
    'setResetOperator(address)', 'updatePcr0(bytes)', 'updatePCR0(bytes)',
    'PROTOCOL_VERSION()', 'protocolVersion()', 'DEPLOYER_ROLE()', 'RESET_OPERATOR()'
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = (await provider.getNetwork()).chainId;
    if (chainId !== EXPECTED_CHAIN_ID) {
        console.error(`FATAL: chainId ${chainId}, expected ${EXPECTED_CHAIN_ID}.`);
        process.exit(1);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(TARGET)) {
        console.error(`FATAL: not a valid address: ${TARGET}`);
        process.exit(1);
    }

    const code = await provider.getCode(TARGET);
    if (code === '0x') {
        console.error(`FATAL: no contract at ${TARGET}.`);
        process.exit(1);
    }
    const body = code.slice(2).toLowerCase();
    console.log(`${TARGET}`);
    console.log(`runtime bytecode: ${(code.length - 2) / 2} bytes  (unverified on Basescan)`);

    // solc dispatcher idioms: DUP1 PUSH4 <sel> EQ ... JUMPI  and  PUSH4 <sel> DUP1 EQ ... JUMPI
    const found = new Set();
    for (const re of [/8063([0-9a-f]{8})14/g, /63([0-9a-f]{8})8014/g, /63([0-9a-f]{8})14/g]) {
        for (const m of body.matchAll(re)) found.add(m[1]);
    }

    const bySel = new Map();
    for (const sig of CANDIDATES) {
        bySel.set(ethers.id(sig).slice(2, 10), sig);
    }

    const known = [];
    const unknown = [];
    for (const sel of [...found].sort()) {
        (bySel.has(sel) ? known : unknown).push(sel);
    }

    console.log(`\n=== ${known.length} selector(s) matched against the candidate list ===`);
    for (const sel of known) console.log(`  ${sel}  ${bySel.get(sel)}`);

    console.log(`\n=== ${unknown.length} selector(s) present but NOT in our candidate list ===`);
    for (const sel of unknown) console.log(`  ${sel}  (unidentified)`);

    console.log('\n=== candidate signatures ABSENT from this deployment ===');
    for (const [sel, sig] of bySel) {
        if (!found.has(sel)) console.log(`  ${sig}`);
    }

    console.log(`\nTotal distinct selectors found: ${found.size}`);
    console.log('Note: selector extraction from bytecode is heuristic. A match proves the');
    console.log('selector is dispatched; an absence proves only that the idiom was not seen,');
    console.log('so confirm anything load-bearing with a real eth_call.');
}

main().catch((e) => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
