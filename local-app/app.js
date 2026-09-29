import { applyOperation, emptyState, userPosition, DEMO_ADDRESS, COLLATERAL_RATIO } from './protocol.mjs';

const STORAGE_KEY = 'noctfinance-local-state-v1';
const MODE_KEY = 'noctfinance-local-mode-v1';
const state = { account: null, mode: localStorage.getItem(MODE_KEY) || 'simulator', chainId: null, protocol: loadState(), action: 'DEPOSIT', busy: false };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const units = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (value) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Connect wallet';
const provider = () => window.ethereum?.providers?.find((item) => item.isMetaMask) || window.ethereum;

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || emptyState(); } catch { return emptyState(); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.protocol)); }
function address() { return state.account || DEMO_ADDRESS; }
function activePosition() { return userPosition(state.protocol, address()); }
function notify(message, error = false) {
  const element = $('#notice');
  element.textContent = message;
  element.className = `notice${error ? ' error' : ''}`;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => element.classList.add('hidden'), 5200);
}

async function connectWallet() {
  const injected = provider();
  if (!injected) {
    state.mode = 'demo';
    state.account = DEMO_ADDRESS;
    localStorage.setItem(MODE_KEY, 'demo');
    notify('Demo wallet connected. Actions are persisted locally in this browser.');
    render();
    return;
  }
  try {
    const accounts = await injected.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('No wallet account was returned');
    state.mode = 'wallet';
    state.account = accounts[0];
    try { state.chainId = await injected.request({ method: 'eth_chainId' }); } catch { state.chainId = null; }
    localStorage.setItem(MODE_KEY, 'wallet');
    notify(`Wallet connected: ${short(state.account)}`);
    render();
  } catch (error) { notify(error.message || 'Wallet connection was cancelled', true); }
}

async function hydrateWallet() {
  const injected = provider();
  if (!injected) return;
  try {
    const accounts = await injected.request({ method: 'eth_accounts' });
    if (accounts?.[0]) { state.account = accounts[0]; state.mode = 'wallet'; state.chainId = await injected.request({ method: 'eth_chainId' }); }
  } catch { /* Some injected providers do not expose accounts until requested. */ }
}

async function switchToAnvil() {
  const injected = provider();
  if (!injected) { notify('Install MetaMask or choose the demo wallet to use Anvil.', true); return; }
  try {
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a69' }] });
    state.chainId = '0x7a69';
    notify('Connected wallet is now on local Anvil (chain 31337).');
    render();
  } catch (error) {
    if (error.code !== 4902) { notify(error.message || 'Could not switch to Anvil', true); return; }
    try {
      await injected.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x7a69', chainName: 'Anvil Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['http://127.0.0.1:8545'], blockExplorerUrls: [] }] });
      state.chainId = '0x7a69';
      notify('Anvil was added to your wallet.');
      render();
    } catch (addError) { notify(addError.message || 'Could not add Anvil network', true); }
  }
}

function disconnect() {
  state.account = null;
  state.mode = 'simulator';
  localStorage.removeItem(MODE_KEY);
  notify('Wallet disconnected. Use the demo wallet to continue locally.');
  render();
}

function selectAction(action) {
  state.action = action;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.action === action));
  const copy = {
    DEPOSIT: ['Supply collateral', 'Supply collateral to unlock borrowing power.', 'deposit'],
    BORROW: ['Borrow NOCT', 'Borrow up to 50% of your supplied collateral.', 'borrow'],
    REPAY: ['Repay your debt', 'Repay outstanding NOCT to restore borrowing capacity.', 'repay'],
    WITHDRAW: ['Withdraw collateral', 'Withdraw collateral while maintaining the 200% ratio.', 'withdraw'],
  }[action];
  $('#action-title').textContent = copy[0];
  $('#action-hint').textContent = copy[1];
  $('#action-button').innerHTML = `${copy[0]} <span>↗</span>`;
  $('#amount').value = '';
}

function maxAmount() {
  const position = activePosition();
  const max = { DEPOSIT: 10000, BORROW: position.availableBorrow, REPAY: position.borrowed, WITHDRAW: position.collateral }[state.action];
  $('#amount').value = max?.toString() || '0';
}

function submit(event) {
  event.preventDefault();
  if (!state.account) { notify('Connect a wallet or choose the demo wallet first.', true); return; }
  if (state.busy) return;
  const raw = $('#amount').value.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) { notify('Enter a valid positive amount.', true); return; }
  const amount = String(Math.floor(Number(raw)));
  state.busy = true;
  $('#action-button').disabled = true;
  $('#action-button').innerHTML = 'Confirming locally… <span>◌</span>';
  window.setTimeout(() => {
    try {
      const result = applyOperation(state.protocol, address(), state.action, amount);
      state.protocol = result.state;
      saveState();
      notify(`${result.message}. Transaction ${result.tx.id.slice(-8)} confirmed.`);
      $('#amount').value = '';
    } catch (error) { notify(error.message, true); }
    state.busy = false;
    $('#action-button').disabled = false;
    render();
  }, 350);
}

function render() {
  const position = activePosition();
  const totalDeposits = BigInt(state.protocol.totalDeposits || 0);
  const totalBorrows = BigInt(state.protocol.totalBorrows || 0);
  $('#protocol-tvl').textContent = units(totalDeposits);
  $('#protocol-borrows').textContent = units(totalBorrows);
  $('#user-collateral').textContent = units(position.collateral);
  $('#user-borrowed').textContent = units(position.borrowed);
  $('#user-ratio').textContent = `${state.protocol.collateralRatio || COLLATERAL_RATIO}%`;
  $('#user-available').textContent = `${units(position.availableBorrow)} NOCT`;
  $('#market-supplied').textContent = units(totalDeposits);
  $('#market-borrowed').textContent = units(totalBorrows);
  $('#market-utilization').textContent = `${totalDeposits ? units(totalBorrows * 10000n / totalDeposits / 100n) : '0.00'}%`;
  const health = position.borrowed === 0n ? null : Number(position.health);
  const badge = $('#position-health');
  badge.className = `health-badge ${health === null ? 'neutral' : health >= 110 ? 'good' : 'warn'}`;
  badge.textContent = health === null ? 'No debt' : `${health.toFixed(2)}% healthy`;
  $('#health-bar').style.width = `${health === null ? 0 : Math.min(100, Math.max(3, health / 2))}%`;
  $('#wallet-button').textContent = state.account ? short(state.account) : 'Connect wallet';
  $('#wallet-button').onclick = state.account ? disconnect : connectWallet;
  $('#wallet-banner').classList.toggle('hidden', Boolean(state.account));
  $('#demo-button').onclick = () => { state.account = DEMO_ADDRESS; state.mode = 'demo'; localStorage.setItem(MODE_KEY, 'demo'); notify('Demo wallet connected.'); render(); };
  $('#network-label').textContent = state.mode === 'wallet' ? (state.chainId === '0x7a69' ? 'Anvil · 31337' : 'Wallet · click to switch') : 'Local simulator';
  $('#wallet-balance').textContent = state.account ? (state.mode === 'demo' ? 'Demo balance · 10,000 NOCT' : 'Wallet connected') : 'Wallet —';
  const transactions = state.protocol.transactions || [];
  $('#activity-list').innerHTML = transactions.length ? transactions.slice(0, 5).map((tx) => `<div class="activity-row"><span class="activity-icon">${tx.operation === 'BORROW' ? '↓' : tx.operation === 'WITHDRAW' ? '↑' : '↗'}</span><div><strong>${tx.operation[0]}${tx.operation.slice(1).toLowerCase()}</strong><small>${new Date(tx.timestamp).toLocaleString()}</small></div><span class="amount">${units(tx.amount)} NOCT</span></div>`).join('') : '<div class="empty-state"><span>◌</span><p>No activity yet</p><small>Your confirmed protocol actions will appear here.</small></div>';
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => selectAction(tab.dataset.action)));
$('#action-form').addEventListener('submit', submit);
$('#max-button').addEventListener('click', maxAmount);
$('#clear-button').addEventListener('click', () => { state.protocol.transactions = []; saveState(); render(); });
$('#copy-command').addEventListener('click', async () => { await navigator.clipboard?.writeText('npm run validate-vela -- --app-id <id>'); notify('Validation command copied.'); });
$('#network-button').addEventListener('click', switchToAnvil);
if (provider()) {
  provider().on?.('accountsChanged', (accounts) => { state.account = accounts?.[0] || null; state.mode = state.account ? 'wallet' : 'simulator'; localStorage.setItem(MODE_KEY, state.mode); render(); });
  provider().on?.('chainChanged', (chainId) => { state.chainId = chainId; render(); });
}
if (state.mode === 'demo') state.account = DEMO_ADDRESS;
await hydrateWallet();
render();
