import { spawn } from 'node:child_process';

const rpcUrl = process.env.VELA_RPC_URL || 'http://127.0.0.1:8545';
const appId = process.argv[2] === '--app-id' ? process.argv[3] : undefined;

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC responded ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  return body.result;
}

try {
  const chainId = await rpc('eth_chainId');
  if (chainId !== '0x7a69') throw new Error(`Expected Anvil chain 31337, received ${chainId}`);
  const block = await rpc('eth_blockNumber');
  console.log(`Local Vela/Anvil RPC is reachable at ${rpcUrl} (chain 31337, block ${BigInt(block)}).`);
  if (appId) {
    console.log(`Running the existing encrypted WASM client for application ${appId}...`);
    const child = spawn(process.execPath, ['deploy-scripts/local-e2e-client.js', 'run', appId], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 1));
  } else {
    console.log('Pass --app-id <id> to run the existing encrypted WASM end-to-end flow.');
  }
} catch (error) {
  console.error(`Local Vela validation failed: ${error.message}`);
  console.error('Start noct-vela-demo/dockerfiles with Docker Compose, then try again.');
  process.exitCode = 1;
}
