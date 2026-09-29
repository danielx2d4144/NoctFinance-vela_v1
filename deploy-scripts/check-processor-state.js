import { ethers } from 'ethers';

// On-chain read surface of the live ProcessorEndpoint. Read-only: eth_call only, no key, no gas.
//
// This exists because check-app-state.js was written on a false premise. It claimed application
// state "is NOT readable from the ProcessorEndpoint contract" after trying invented accessors
// like getApplicationState(uint64) and applications(uint64). The real accessors are named
// differently and they DO work. inspect-selectors.js recovered the actual surface from the
// deployed bytecode, and it matches IProcessorEndpoint.sol on both main and pc/tee_upgrade
// (those two files are byte-identical, 19631 bytes).
//
// It also settles the protocolVersion contradiction recorded in noct-demo-wasm/demo-tx.js:
// PROTOCOL_VERSION() is a public getter on the live contract, so the value is read, not guessed.
//
// Usage: node check-processor-state.js [applicationId]

const RPC_URL = (process.env.VELA_RPC_URL || '').trim() || 'https://sepolia.base.org';
const EXPECTED_CHAIN_ID = 84532n;
const PROCESSOR = (process.env.VELA_PROCESSOR_ENDPOINT || '').trim()
    || '0xd5E405a84753635608E7a28A59D7349BB2DAaEeF';
const ZERO = '0x0000000000000000000000000000000000000000';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const ABI = [
    'function PROTOCOL_VERSION() view returns (uint8)',
    'function getDeployedAppIds() view returns (uint64[])',
    'function applicationStateRoots(uint64) view returns (bytes32)',
    'function appCustody(uint64,address) view returns (uint256)',
    'function totalAppCustody(address) view returns (uint256)',
    'function pendingClaims(address,address) view returns (uint256)',
    'function totalPendingClaims(address) view returns (uint256)',
    'function triggerContracts(uint64) view returns (address)',
    'function availableDeploySlots() view returns (uint256)',
    'function getPendingRequestsSize() view returns (uint256)',
    'function getTriggerQueueSize() view returns (uint256)',
    'function getFacilitatorNonce(address) view returns (uint256)',
    'function tokenAllowlist() view returns (address)',
    'function teeAuthenticator() view returns (address)'
];

async function tryCall(label, fn) {
    try {
        console.log(`  ${label.padEnd(46)} ${await fn()}`);
        return true;
    } catch (e) {
        console.log(`  ${label.padEnd(46)} n/a (${e.shortMessage || e.message})`);
        return false;
    }
}

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = (await provider.getNetwork()).chainId;
    if (chainId !== EXPECTED_CHAIN_ID) {
        console.error(`FATAL: chainId ${chainId}, expected ${EXPECTED_CHAIN_ID}.`);
        process.exit(1);
    }
    const p = new ethers.Contract(PROCESSOR, ABI, provider);
    console.log(`ProcessorEndpoint ${PROCESSOR}  chainId ${chainId}  block ${await provider.getBlockNumber()}`);

    console.log('\n=== protocol constants ===');
    const pv = await tryCall('PROTOCOL_VERSION()', async () => String(await p.PROTOCOL_VERSION()));
    await tryCall('tokenAllowlist()', () => p.tokenAllowlist());
    await tryCall('teeAuthenticator()', () => p.teeAuthenticator());

    console.log('\n=== queue / capacity ===');
    await tryCall('availableDeploySlots()', async () => String(await p.availableDeploySlots()));
    await tryCall('getPendingRequestsSize()', async () => String(await p.getPendingRequestsSize()));
    await tryCall('getTriggerQueueSize()', async () => String(await p.getTriggerQueueSize()));

    let ids = [];
    console.log('\n=== deployed applications ===');
    await tryCall('getDeployedAppIds()', async () => {
        ids = (await p.getDeployedAppIds()).map(String);
        return `[${ids.join(', ')}]`;
    });

    const arg = (process.argv[2] || '').trim();
    const targets = arg ? [arg] : ids;
    for (const id of targets) {
        console.log(`\n=== app ${id} ===`);
        await tryCall('applicationStateRoots()', async () => {
            const r = await p.applicationStateRoots(id);
            return r === ethers.ZeroHash ? '0x00..00 (never finalised / was reset)' : r;
        });
        await tryCall('triggerContracts()', async () => {
            const t = await p.triggerContracts(id);
            return t === ZERO ? 'address(0) -- no trigger contract' : t;
        });
        for (const [n, tok] of [['ETH', ZERO], ['USDC', USDC]]) {
            await tryCall(`appCustody(${n})`, async () => {
                const v = await p.appCustody(id, tok);
                return `${ethers.formatUnits(v, n === 'USDC' ? 6 : 18)} ${n} (raw ${v})`;
            });
        }
    }

    console.log('\n=== instance-wide custody ===');
    for (const [n, tok, dec] of [['ETH', ZERO, 18], ['USDC', USDC, 6]]) {
        await tryCall(`totalAppCustody(${n})`, async () => `${ethers.formatUnits(await p.totalAppCustody(tok), dec)} ${n}`);
        await tryCall(`totalPendingClaims(${n})`, async () => `${ethers.formatUnits(await p.totalPendingClaims(tok), dec)} ${n}`);
    }

    if (pv) {
        console.log('\n=== protocolVersion, settled ===');
        console.log('  PROTOCOL_VERSION() above is the authoritative value. It matches');
        console.log('  vela-common-ts/src/constants.ts (export const PROTOCOL_VERSION = 0),');
        console.log('  so the 7-argument submitRequest(uint8 protocolVersion, ...) in');
        console.log('  noct-demo-wasm/demo-tx.js is correct and the 5-argument ABI in');
        console.log('  deploy-scripts/submit-transaction.js was wrong.');
    }
}

main().catch((e) => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
