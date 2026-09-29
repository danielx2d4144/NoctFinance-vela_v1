// Application state is readable from the ProcessorEndpoint contract -- but not under the names
// this script originally guessed. It tried getApplicationState(uint64), getApplicationData(uint64),
// applications(uint64), getApplication(uint64), getApp(uint64), appStates(uint64),
// applicationStates(uint64) and applications(uint256); none of those exist, so the conclusion
// drawn from them ("not readable on-chain") was wrong.
//
// CORRECTION 2026-09-28: inspect-selectors.js recovered the real surface from the deployed
// bytecode. applicationStateRoots(uint64) (selector 7a36a891) DOES exist and returns live state
// roots -- e.g. vela-nova 11579806367557720661 ->
// 0xf94034604b7cf0e87d7d480c7bcbaa148b14cf680deafd983305da2abc6647d4. So does appCustody(uint64,
// address), totalAppCustody(address), pendingClaims(address,address), triggerContracts(uint64),
// getDeployedAppIds() and PROTOCOL_VERSION(). Use check-processor-state.js for those; this
// earlier claim is retracted there and in VELA-TESTNET-CONSTANTS.md section 8.2/B9.
//
// The subgraph is still the right source for REQUEST HISTORY (who submitted what, when, and how
// it completed), because the contract only stores the current head of the queue. So both are
// needed: chain for current state, subgraph for history.
//
// Its old hardcoded APP_ID was also FABRICATED: 2397975349340933566 returns 0 records from
// the subgraph, and only 2 applications have ever been deployed on Base Sepolia -- now confirmed
// by getDeployedAppIds() on the contract itself, not just by the subgraph. That claim
// was retracted from the root commit -- see VELA-TESTNET-CONSTANTS.md section 8.5.
//
// Read-only: no key, no transaction, no gas.
//
// Usage: node check-app-state.js [applicationId]   (omit the id to list all known apps)

const SUBGRAPH = (process.env.VELA_SUBGRAPH_URL || '').trim()
    || 'https://api.goldsky.com/api/public/project_cml7x1bnbintv01xu7tih85gl/subgraphs/vela-base-sepolia/0.2.0/gn';

// The applications that actually exist on Base Sepolia. Neither one is ours -- see B11.
const KNOWN = {
    '4474814306369175243': 'unnamed app, not mentioned in the Horizen reply',
    '11579806367557720661': 'vela-nova'
};

const FABRICATED_ID = '2397975349340933566';

async function gql(query, variables) {
    const res = await fetch(SUBGRAPH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
    return json.data;
}

async function main() {
    const arg = (process.argv[2] || '').trim();
    if (arg && !/^\d+$/.test(arg)) {
        console.error(`FATAL: applicationId must be a decimal integer, got: ${arg}`);
        process.exit(1);
    }

    console.log(`Subgraph: ${SUBGRAPH}\n`);

    const where = arg ? ', where: { applicationId: $id }' : '';
    const data = await gql(`query q($id: BigInt) {
      submitted: deployRequestSubmitteds(first: 100, orderBy: blockNumber${where}) {
        applicationId sender blockNumber
      }
      completed: deployRequestCompleteds(first: 100, orderBy: blockNumber${where}) {
        applicationId status errorCode errorMessage blockNumber
      }
    }`, arg ? { id: arg } : {});

    if (!data.submitted.length && !data.completed.length) {
        console.log(arg
            ? `No application ${arg} has ever been deployed on this instance.`
            : 'No applications found on this instance.');
        if (arg === FABRICATED_ID) {
            console.log('That is the FABRICATED id retracted from the root commit, so zero');
            console.log('records is the expected and correct result.');
        }
        return;
    }

    for (const s of data.submitted) {
        const label = KNOWN[s.applicationId] || 'unidentified';
        console.log(`app ${s.applicationId}   [${label}]`);
        console.log(`   DeployRequestSubmitted by ${s.sender} at block ${s.blockNumber}`);
        const c = data.completed.find((x) => x.applicationId === s.applicationId);
        if (c) {
            console.log(`   DeployRequestCompleted at block ${c.blockNumber}:`);
            console.log(`     status=${c.status} errorCode=${c.errorCode} errorMessage=${JSON.stringify(c.errorMessage)}`);
            if (c.status === 0 && c.errorCode === 0) console.log('     -> deploy succeeded');
        } else {
            console.log('   no DeployRequestCompleted found -- the deploy did not finish');
        }
        console.log('');
    }

    const orphans = data.completed.filter((c) => !data.submitted.some((s) => s.applicationId === c.applicationId));
    for (const c of orphans) {
        console.log(`app ${c.applicationId} has a completion but no submission in this page (pagination artefact)`);
    }

    if (!arg) {
        console.log('None of the above is ours. We have no application: Vela deployment is');
        console.log('permissioned (blocker B11) and requires DEPLOYER_ROLE, which only the');
        console.log('unidentified DEFAULT_ADMIN_ROLE holder can grant.');
    }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
