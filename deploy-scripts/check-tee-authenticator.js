import { ethers } from 'ethers';

// Read-only probe of the live Vela TeeAuthenticator and the privileged functions around it.
// No private key, no transactions -- only eth_call.
//
// Why this script exists: the Masterclass reply said the TEE upgrade procedure "is currently
// in the design phase" and no implementation has started. But main's TeeAuthenticator.sol
// already contains `updatePcr0(bytes) external onlyOwner` with no timelock. So the honest
// answer to "who controls PCR0?" is readable from the chain, not from the reply. This reads it.
//
// It also checks whether ProcessorEndpoint.getDeployedAppIds and TokenAllowlist.getAllowedTokens
// exist on the LIVE deployment. Both are specified in docs/design/PROCESSOR_ENDPOINT_ADMIN_RESET.md
// and APP_EVENT.md on the pc/tee_upgrade branch; their presence or absence tells us which branch
// Base Sepolia is actually running, and therefore whether AppEvent is usable today.
//
// Usage: node check-tee-authenticator.js

const RPC_URL = (process.env.VELA_RPC_URL || '').trim() || 'https://sepolia.base.org';
const EXPECTED_CHAIN_ID = 84532n;

const TEE_AUTH = (process.env.VELA_TEE_AUTHENTICATOR || '').trim()
    || '0x69Ca935A17e3920B80DB71d723Aee918e1aE75E3';
const PROCESSOR = (process.env.VELA_PROCESSOR_ENDPOINT || '').trim()
    || '0xd5E405a84753635608E7a28A59D7349BB2DAaEeF';
const ALLOWLIST = (process.env.VELA_TOKEN_ALLOWLIST || '').trim()
    || '0x8774E760B45a60a15B75770Fd7c60338006beEfa';

// Horizen's deployer, from the subgraph's DeployRequestSubmitted.sender. Holds DEPLOYER_ROLE
// and RESET_OPERATOR on ProcessorEndpoint but NOT DEFAULT_ADMIN_ROLE.
const HORIZEN_DEPLOYER = (process.env.VELA_HORIZEN_DEPLOYER || '').trim()
    || '0x2eaaf231ce583b7cd7ae02c03b8fe7a96f0aacb8';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TZEN = '0x107fdE93838e3404934877935993782F977324BB';

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
const RESET_OPERATOR = '0xc580ee26c87bb95870d138607be6d8598a348af3608b6ce0cef58e73a4c95917';

const TEE_ABI = [
    'function owner() view returns (address)',
    'function pcr0() view returns (bytes)',
    'function teeSigner() view returns (address)',
    'function pubSecp521r1() view returns (bytes)',
    'function maxVerificationAge() view returns (uint256)',
    'function nitroProver() view returns (address)',
    'function currentUpdateStep() view returns (uint256)',
    'function getStep2TotalLength() view returns (uint256)'
];

const PROC_ABI = [
    'function teeAuthenticator() view returns (address)',
    'function tokenAllowlist() view returns (address)',
    'function availableDeploySlots() view returns (uint256)',
    'function getDeployedAppIds() view returns (uint64[])',
    'function hasRole(bytes32 role, address account) view returns (bool)'
];

const ALLOW_ABI = [
    'function allowedTokens(address token) view returns (bool)',
    'function getAllowedTokens() view returns (address[])'
];

// Call a view function, reporting ABSENT (not on this deployment) separately from a real error.
async function probe(label, fn) {
    try {
        const v = await fn();
        console.log(`  ${label.padEnd(38)} ${v}`);
        return { ok: true, value: v };
    } catch (e) {
        const data = e.data || e.error?.data;
        const absent = data === '0x'
            || /call revert exception|missing revert data|no error data/i.test(e.shortMessage || e.message);
        console.log(`  ${label.padEnd(38)} ${absent
            ? 'ABSENT (not on this deployment)'
            : `ERROR: ${e.shortMessage || e.message}`}`);
        return { ok: false, absent };
    }
}

const hex = (b) => (typeof b === 'string' ? b : ethers.hexlify(b));
const short = (b) => (b.length > 20
    ? `${b.slice(0, 18)}…${b.slice(-8)} (${(b.length - 2) / 2} bytes)`
    : b);

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const chainId = (await provider.getNetwork()).chainId;
    if (chainId !== EXPECTED_CHAIN_ID) {
        console.error(`FATAL: chainId ${chainId}, expected ${EXPECTED_CHAIN_ID}. Refusing to report.`);
        process.exit(1);
    }
    for (const [name, addr] of [['TeeAuthenticator', TEE_AUTH], ['ProcessorEndpoint', PROCESSOR], ['TokenAllowlist', ALLOWLIST]]) {
        if ((await provider.getCode(addr)) === '0x') {
            console.error(`FATAL: no contract at ${name} ${addr}.`);
            process.exit(1);
        }
    }

    const tee = new ethers.Contract(TEE_AUTH, TEE_ABI, provider);
    const proc = new ethers.Contract(PROCESSOR, PROC_ABI, provider);
    const allow = new ethers.Contract(ALLOWLIST, ALLOW_ABI, provider);

    console.log(`Base Sepolia (chainId ${chainId})  block ${await provider.getBlockNumber()}`);

    console.log(`\n=== TeeAuthenticator ${TEE_AUTH} ===`);
    const owner = await probe('owner()  [controls updatePcr0]', () => tee.owner());
    const pcr0 = await probe('pcr0()', async () => short(hex(await tee.pcr0())));
    const signer = await probe('teeSigner()', () => tee.teeSigner());
    const pubkey = await probe('pubSecp521r1()', async () => short(hex(await tee.pubSecp521r1())));
    const maxAge = await probe('maxVerificationAge()  [seconds]', async () => String(await tee.maxVerificationAge()));
    const prover = await probe('nitroProver()', () => tee.nitroProver());
    await probe('currentUpdateStep()', async () => String(await tee.currentUpdateStep()));
    await probe('getStep2TotalLength()', async () => String(await tee.getStep2TotalLength()));

    console.log(`\n=== ProcessorEndpoint ${PROCESSOR} ===`);
    const wiredTee = await probe('teeAuthenticator()', () => proc.teeAuthenticator());
    const wiredAllow = await probe('tokenAllowlist()', () => proc.tokenAllowlist());
    await probe('availableDeploySlots()', async () => String(await proc.availableDeploySlots()));
    const appIds = await probe('getDeployedAppIds()  [pc/tee_upgrade]', async () => {
        const ids = await proc.getDeployedAppIds();
        return `[${ids.map(String).join(', ')}]`;
    });

    console.log(`\n=== TokenAllowlist ${ALLOWLIST} ===`);
    await probe('allowedTokens(USDC)', () => allow.allowedTokens(USDC));
    await probe('allowedTokens(tZEN)', () => allow.allowedTokens(TZEN));
    const allTokens = await probe('getAllowedTokens()  [pc/tee_upgrade]', async () => {
        const t = await allow.getAllowedTokens();
        return `[${t.join(', ')}]`;
    });

    console.log('\n=== interpretation ===');

    if (owner.ok) {
        console.log(`  PCR0 is controlled by ${owner.value} via updatePcr0() -- onlyOwner, no`);
        console.log(`  timelock, no multisig enforced by the contract. That one key can re-point`);
        console.log(`  the whole instance at a different enclave image, instantly.`);
        if (String(owner.value).toLowerCase() === HORIZEN_DEPLOYER.toLowerCase()) {
            console.log(`  => it IS Horizen's deployer, so one address controls TEE identity AND`);
            console.log(`     app deployment on this instance.`);
        } else {
            console.log(`  => it is NOT Horizen's deployer ${HORIZEN_DEPLOYER}: TEE identity and`);
            console.log(`     app deployment sit under different keys.`);
        }
        const teeOwnerIsAdmin = await proc.hasRole(DEFAULT_ADMIN_ROLE, owner.value).catch(() => null);
        if (teeOwnerIsAdmin !== null) {
            console.log(`  => TeeAuthenticator.owner() holds ProcessorEndpoint DEFAULT_ADMIN_ROLE: ${teeOwnerIsAdmin}`);
            if (teeOwnerIsAdmin) {
                console.log(`     THIS is the unidentified admin B11 needs: it can grant DEPLOYER_ROLE.`);
            }
        }
    }
    if (pcr0.ok && typeof pcr0.value === 'string') {
        const n = pcr0.value.match(/\((\d+) bytes\)/)?.[1];
        console.log(`  pcr0 is a single ${n || '?'}-byte measurement shared by the WHOLE instance.`);
        console.log(`  It binds the attestation to the VELA RUNTIME VERSION -- never to our app`);
        console.log(`  WASM, which is uploaded separately to the authority service afterwards.`);
    }

    if (wiredTee.ok) {
        const same = String(wiredTee.value).toLowerCase() === TEE_AUTH.toLowerCase();
        console.log(`  teeAuthenticator() wiring ${same ? `confirmed -> ${TEE_AUTH}` : `MISMATCH: ${wiredTee.value}`}`);
    }
    if (wiredAllow.ok) {
        const same = String(wiredAllow.value).toLowerCase() === ALLOWLIST.toLowerCase();
        console.log(`  tokenAllowlist() wiring ${same ? `confirmed -> ${ALLOWLIST}` : `MISMATCH: ${wiredAllow.value}`}`);
    }

    console.log(`  Branch fingerprint: getDeployedAppIds=${appIds.ok}  getAllowedTokens=${allTokens.ok}`);
    if (!appIds.ok && !allTokens.ok) {
        console.log(`  => Base Sepolia is running main, NOT pc/tee_upgrade. So AppEvent and`);
        console.log(`     adminResetApps are design docs only and are NOT usable by us today.`);
    } else {
        console.log(`  => the upgrade branch looks deployed here; re-read the design docs before`);
        console.log(`     relying on the main-branch ABIs recorded elsewhere in this repo.`);
    }

    const resetHeld = await proc.hasRole(RESET_OPERATOR, HORIZEN_DEPLOYER).catch(() => null);
    if (resetHeld) {
        console.log(`  RESET_OPERATOR is held by ${HORIZEN_DEPLOYER}: this instance was deployed`);
        console.log(`  with admin reset ENABLED, i.e. a testnet configuration. Per`);
        console.log(`  PROCESSOR_ENDPOINT_ADMIN_RESET.md that role can call adminResetApps([],[])`);
        console.log(`  to sweep EVERY app's locked ETH and allowlisted ERC-20 to itself and zero`);
        console.log(`  every state root in one transaction. Hold no real value on Base Sepolia.`);
    }

    if (signer.ok && pubkey.ok) {
        console.log(`  teeSigner ${signer.value} + the stored P-521 key verify every stateUpdate.`);
        console.log(`  Certified once by attestation, replaceable at will by owner() above.`);
    }
    if (maxAge.ok) {
        console.log(`  Attestation freshness is an AGE WINDOW of ${maxAge.value}s, not a nonce.`);
    }
    if (prover.ok) {
        console.log(`  nitroProver = ${prover.value} (HorizenOfficial/NitroProver, fork of marlinprotocol's).`);
    }
}

main().catch((e) => { console.error('FATAL:', e.shortMessage || e.message); process.exit(1); });
