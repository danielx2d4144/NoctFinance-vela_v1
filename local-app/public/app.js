const SCALE = 10n ** 18n;
const COLLATERAL_RATIO = 200n;
const STORAGE_KEY = 'noctfinance-local-protocol-v1';
const DEMO_ADDRESS = '0xdEAD00000000000000000000000000000000c0de';
const LOCAL_CHAINS = new Set(['0x7a69', '0x539']); // 31337 / 1337

const $ = (selector) => document.querySelector(selector);
const els = {
  network: $('#network-label'), connect: $('#connect-button'), connectLabel: $('#connect-label'), heroConnect: $('#hero-connect'),
  modal: $('#modal-backdrop'), modalClose: $('#modal-close'), modalConnect: $('#modal-connect'), demoButton: $('#demo-button'),
  amount: $('#amount-input'), amountLabel: $('#amount-label'), availableLabel: $('#available-label'), available: $('#available-value'), max: $('#max-button'),
  actionSubmit: $('#action-submit'), actionSubmitLabel: $('#action-submit-label'), quotePrimaryLabel: $('#quote-primary-label'), quotePrimary: $('#quote-primary'),
  quoteSecondaryLabel: $('#quote-secondary-label'), quoteSecondary: $('#quote-secondary'), collateral: $('#collateral-value'), borrowed: $('#borrowed-value'),
  walletBalance: $('#wallet-balance'), netPosition: $('#net-position'), healthFactor: $('#health-factor'), healthRing: $('#health-ring'), healthState: $('#health-state'),
  healthMessage: $('#health-message'), healthDetail: $('#health-detail'), activity: $('#activity-list'), toast: $('#toast'), toastMessage: $('#toast-message'),
  liquidity: $('#liquidity-value'), utilization: $('#utilization-value'), utilizationBar: $('#utilization-bar-fill'), tvl: $('#tvl-value'),
};

let activeAction = 'supply';
let account = null;
let walletType = null;
let chainId = null;
let realWalletBalance = null;
let protocol = loadProtocol();

function loadProtocol() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && parsed.users ? parsed : { users: {} };
  } catch {
    return { users: {} };
  }
}

function saveProtocol() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(protocol));
}

function userKey() { return account?.toLowerCase() || DEMO_ADDRESS.toLowerCase(); }

function getUser() {
  const key = userKey();
  if (!protocol.users[key]) {
    protocol.users[key] = { collateral: '0', debt: '0', wallet: '10000000000000000000', activity: [] };
    saveProtocol();
  }
  return protocol.users[key];
}

function toBig(value) { try { return BigInt(value || '0'); } catch { return 0n; } }

function parseAmount(value) {
  const normalized = String(value || '').trim().replace(',', '.');
  if (!/^\d*(\.\d*)?$/.test(normalized) || !normalized || normalized === '.') throw new Error('Enter a valid amount.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  if (fraction.length > 18) throw new Error('Use up to 18 decimal places.');
  return BigInt(whole || '0') * SCALE + BigInt((fraction + '0'.repeat(18)).slice(0, 18) || '0');
}

function formatEth(value, decimals = 2) {
  const amount = toBig(value);
  const whole = amount / SCALE;
  const fraction = (amount % SCALE).toString().padStart(18, '0').slice(0, decimals);
  const text = `${whole.toLocaleString('en-US')}.${fraction}`;
  return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatAddress(value) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : ''; }

function toHex(value) { return `0x${new TextEncoder().encode(value).reduce((out, byte) => out + byte.toString(16).padStart(2, '0'), '')}`; }

function isLocalChain() { return chainId && LOCAL_CHAINS.has(chainId.toLowerCase()); }

function showToast(message, error = false) {
  els.toastMessage.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('visible'), 4500);
}

function openModal() { els.modal.hidden = false; requestAnimationFrame(() => els.modal.classList.add('visible')); }
function closeModal() { els.modal.classList.remove('visible'); setTimeout(() => { els.modal.hidden = true; }, 180); }

async function connectMetaMask() {
  if (!window.ethereum) {
    els.modal.querySelector('#modal-copy').textContent = 'MetaMask was not detected. Use the demo wallet below, or install a browser wallet to connect a real address.';
    showToast('MetaMask was not detected. Demo mode is ready.', true);
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('No wallet account was returned.');
    account = accounts[0];
    walletType = 'metamask';
    chainId = await window.ethereum.request({ method: 'eth_chainId' });
    await readRealBalance();
    closeModal();
    refresh();
    showToast(`Connected ${formatAddress(account)}`);
  } catch (error) {
    if (error?.code === 4001) showToast('Wallet connection was cancelled.', true);
    else showToast(error?.message || 'Unable to connect wallet.', true);
  }
}

function useDemoWallet() {
  account = DEMO_ADDRESS;
  walletType = 'demo';
  chainId = '0x7a69';
  realWalletBalance = 10n * SCALE;
  closeModal();
  refresh();
  showToast('Demo wallet connected · 10 ETH simulated balance');
}

async function readRealBalance() {
  if (!window.ethereum || !account) return;
  try {
    const raw = await window.ethereum.request({ method: 'eth_getBalance', params: [account, 'latest'] });
    realWalletBalance = BigInt(raw);
    const user = getUser();
    // A new wallet starts with its actual balance; existing local positions remain deterministic.
    if (user.activity.length === 0 && user.collateral === '0' && user.debt === '0') {
      user.wallet = realWalletBalance.toString();
      saveProtocol();
    }
  } catch { /* Some injected providers do not expose balances until a network is selected. */ }
}

async function switchToLocalhost() {
  if (!window.ethereum) { showToast('Install MetaMask to add the localhost network.', true); return; }
  try {
    await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x7a69', chainName: 'Noct Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['http://127.0.0.1:8545'], blockExplorerUrls: [] }] });
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a69' }] });
    chainId = '0x7a69';
    showToast('Switched to Noct Local · 31337');
    refresh();
  } catch (error) { showToast(error?.message || 'Could not switch networks.', true); }
}

async function maybeWriteLocalTransaction(action, amount) {
  if (walletType !== 'metamask' || !isLocalChain() || !window.ethereum) return { skipped: true };
  try {
    // This transaction is intentionally self-directed and has no value. It gives each local
    // simulator action a real localhost receipt without pretending to be a deployed contract.
    const hash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [{ from: account, to: account, value: '0x0', data: toHex(JSON.stringify({ protocol: 'noct-local-v1', action, amount: amount.toString() })) }] });
    return { hash };
  } catch (error) {
    if (error?.code === 4001) throw new Error('Wallet rejected the local transaction.');
    // A wallet can be on a localhost chain before its RPC is running. Keep the simulator usable.
    return { skipped: true, reason: error?.message };
  }
}

function actionCopy() {
  return {
    supply: { label: 'Supply collateral', available: 'Available in wallet', primary: 'You supply', secondary: 'New collateral', submit: account ? 'Supply collateral' : 'Connect wallet to supply' },
    borrow: { label: 'Borrow liquidity', available: 'Available to borrow', primary: 'You borrow', secondary: 'New debt', submit: account ? 'Borrow liquidity' : 'Connect wallet to borrow' },
    repay: { label: 'Repay debt', available: 'Outstanding debt', primary: 'You repay', secondary: 'Remaining debt', submit: account ? 'Repay debt' : 'Connect wallet to repay' },
    withdraw: { label: 'Withdraw collateral', available: 'Available to withdraw', primary: 'You withdraw', secondary: 'Remaining collateral', submit: account ? 'Withdraw collateral' : 'Connect wallet to withdraw' },
  }[activeAction];
}

function availableFor(user) {
  const collateral = toBig(user.collateral); const debt = toBig(user.debt); const wallet = toBig(user.wallet);
  if (activeAction === 'supply') return wallet;
  if (activeAction === 'borrow') return collateral / 2n > debt ? collateral / 2n - debt : 0n;
  if (activeAction === 'repay') return debt;
  return collateral;
}

function refreshActionForm(user) {
  const copy = actionCopy(); const available = availableFor(user); const inputAmount = (() => { try { return parseAmount(els.amount.value); } catch { return 0n; } })();
  els.amountLabel.textContent = copy.label; els.availableLabel.textContent = copy.available; els.available.textContent = account ? `${formatEth(available)} ETH` : 'Connect wallet';
  els.quotePrimaryLabel.textContent = copy.primary; els.quotePrimary.textContent = `${formatEth(inputAmount)} ETH`;
  let secondary = toBig(user.collateral);
  if (activeAction === 'supply') secondary += inputAmount;
  if (activeAction === 'borrow' || activeAction === 'repay') secondary = activeAction === 'borrow' ? toBig(user.debt) + inputAmount : Math.max(0n, toBig(user.debt) - inputAmount);
  if (activeAction === 'withdraw') secondary = Math.max(0n, toBig(user.collateral) - inputAmount);
  els.quoteSecondaryLabel.textContent = copy.secondary; els.quoteSecondary.textContent = `${formatEth(secondary)} ETH`;
  els.actionSubmitLabel.textContent = copy.submit;
}

function refreshPosition(user) {
  const collateral = toBig(user.collateral); const debt = toBig(user.debt); const wallet = toBig(user.wallet);
  els.collateral.textContent = formatEth(collateral);
  els.borrowed.textContent = `${formatEth(debt)} ETH`;
  els.walletBalance.textContent = `${formatEth(wallet)} ETH`;
  els.netPosition.textContent = `${formatEth(collateral - debt)} ETH`;
  if (debt === 0n) {
    els.healthFactor.textContent = '∞'; els.healthState.textContent = 'Healthy'; els.healthState.className = 'health-state';
    els.healthMessage.textContent = 'No debt yet'; els.healthDetail.textContent = 'Supply collateral to unlock private borrowing power.'; els.healthRing.style.setProperty('--health', '100%');
  } else {
    const ratio = Number(collateral) / Number(debt);
    const factor = ratio.toFixed(2);
    els.healthFactor.textContent = factor;
    const state = ratio >= 2 ? 'Healthy' : ratio > 1 ? 'Watch' : 'Liquidatable';
    els.healthState.textContent = state; els.healthState.className = `health-state ${state.toLowerCase()}`;
    els.healthMessage.textContent = ratio >= 2 ? 'Position is healthy' : ratio > 1 ? 'Add collateral soon' : 'Position needs attention';
    els.healthDetail.textContent = ratio >= 2 ? `${factor}× collateral backing your debt.` : 'The protocol requires 2.00× collateral backing.';
    els.healthRing.style.setProperty('--health', `${Math.min(100, Math.max(8, ratio / 2 * 100))}%`);
  }
}

function refreshMarket() {
  const totalCollateral = Object.values(protocol.users).reduce((sum, user) => sum + toBig(user.collateral), 0n);
  const totalDebt = Object.values(protocol.users).reduce((sum, user) => sum + toBig(user.debt), 0n);
  const baseLiquidity = 2815n * SCALE;
  const available = baseLiquidity + totalCollateral - totalDebt;
  const utilization = Number(baseLiquidity + totalCollateral) ? Number(totalDebt * 10000n / (baseLiquidity + totalCollateral)) / 100 : 0;
  els.liquidity.textContent = `${formatEth(available)} ETH`;
  els.utilization.textContent = `${utilization.toFixed(1)}%`;
  els.utilizationBar.style.width = `${Math.min(100, Math.max(2, utilization))}%`;
  els.tvl.textContent = `$${(2.84 + Number(totalCollateral) / Number(SCALE) * 0.001).toFixed(2)}m`;
}

function renderActivity(user) {
  if (!user.activity?.length) {
    els.activity.innerHTML = '<div class="empty-activity"><span class="empty-icon">◌</span><strong>No activity yet</strong><span>Your signed protocol actions will appear here.</span></div>';
    return;
  }
  els.activity.innerHTML = user.activity.slice().reverse().map((item) => `<div class="activity-row"><div class="activity-type ${item.action}"><span>${item.action === 'supply' ? '↓' : item.action === 'borrow' ? '↗' : item.action === 'repay' ? '↙' : '↑'}</span></div><div class="activity-info"><strong>${item.action[0].toUpperCase() + item.action.slice(1)}</strong><span>${new Date(item.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${item.hash ? ` · ${item.hash.slice(0, 8)}…` : ' · local state'}</span></div><strong class="activity-amount">${item.action === 'borrow' || item.action === 'repay' ? '-' : '+'}${formatEth(item.amount)} ETH</strong><span class="activity-status">Confirmed</span></div>`).join('');
}

function refresh() {
  const user = getUser();
  refreshPosition(user); refreshActionForm(user); refreshMarket(); renderActivity(user);
  els.connectLabel.textContent = account ? (walletType === 'demo' ? 'Demo wallet' : formatAddress(account)) : 'Connect wallet';
  els.network.textContent = account && isLocalChain() ? 'Noct Local · 31337' : account ? `Chain ${parseInt(chainId, 16)}` : 'Local simulator';
  els.heroConnect.textContent = account ? 'Open your position ↗' : 'Enter the market ↗';
  document.body.classList.toggle('connected', Boolean(account));
}

async function submitAction() {
  if (!account) { openModal(); return; }
  let amount;
  try { amount = parseAmount(els.amount.value); } catch (error) { showToast(error.message, true); return; }
  if (amount <= 0n) { showToast('Enter an amount first.', true); return; }
  const user = getUser(); const collateral = toBig(user.collateral); const debt = toBig(user.debt); const wallet = toBig(user.wallet);
  if (activeAction === 'supply' && amount > wallet) return showToast('That is more than your simulated wallet balance.', true);
  if (activeAction === 'borrow' && amount > (collateral / 2n > debt ? collateral / 2n - debt : 0n)) return showToast('This borrow would exceed the 200% collateral requirement.', true);
  if (activeAction === 'repay' && amount > debt) return showToast('Repayment exceeds your outstanding debt.', true);
  if (activeAction === 'withdraw') {
    if (amount > collateral) return showToast('You cannot withdraw more than your supplied collateral.', true);
    if ((collateral - amount) * 100n < debt * COLLATERAL_RATIO) return showToast('That withdrawal would breach the 200% collateral requirement.', true);
  }
  els.actionSubmit.disabled = true; els.actionSubmitLabel.textContent = 'Confirming…';
  try {
    const chain = await maybeWriteLocalTransaction(activeAction, amount);
    if (activeAction === 'supply') { user.collateral = (collateral + amount).toString(); user.wallet = (wallet - amount).toString(); }
    if (activeAction === 'borrow') { user.debt = (debt + amount).toString(); user.wallet = (wallet + amount).toString(); }
    if (activeAction === 'repay') { user.debt = (debt - amount).toString(); user.wallet = (wallet - amount).toString(); }
    if (activeAction === 'withdraw') { user.collateral = (collateral - amount).toString(); user.wallet = (wallet + amount).toString(); }
    user.activity.push({ action: activeAction, amount: amount.toString(), timestamp: Date.now(), hash: chain.hash || null });
    saveProtocol(); els.amount.value = ''; refresh();
    showToast(`${activeAction[0].toUpperCase() + activeAction.slice(1)} confirmed${chain.hash ? ' on Noct Local' : ' in local state'}.`);
  } catch (error) { showToast(error.message || 'Action failed.', true); refresh(); }
  finally { els.actionSubmit.disabled = false; }
}

function selectAction(action) {
  activeAction = action;
  document.querySelectorAll('.tab').forEach((tab) => { const selected = tab.dataset.action === action; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', selected); });
  els.amount.value = ''; refreshActionForm(getUser());
}

els.connect.addEventListener('click', () => account ? showToast(`${formatAddress(account)} is connected · actions are local`) : openModal());
els.heroConnect.addEventListener('click', () => account ? $('#actions').scrollIntoView({ behavior: 'smooth' }) : openModal());
els.modalClose.addEventListener('click', closeModal); els.modalConnect.addEventListener('click', connectMetaMask); els.demoButton.addEventListener('click', useDemoWallet);
els.modal.addEventListener('click', (event) => { if (event.target === els.modal) closeModal(); });
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectAction(tab.dataset.action)));
els.amount.addEventListener('input', () => refreshActionForm(getUser()));
els.max.addEventListener('click', () => { const available = availableFor(getUser()); els.amount.value = formatEth(available, 18); refreshActionForm(getUser()); });
els.actionSubmit.addEventListener('click', submitAction);
$('#market-borrow').addEventListener('click', () => { selectAction('borrow'); $('#actions').scrollIntoView({ behavior: 'smooth' }); });
$('#refresh-button').addEventListener('click', async () => { await readRealBalance(); refresh(); showToast('Position refreshed.'); });
$('#clear-history').addEventListener('click', () => { const key = userKey(); delete protocol.users[key]; saveProtocol(); refresh(); showToast('Local position reset.'); });

window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !els.modal.hidden) closeModal(); });
if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', async (accounts) => { if (!accounts?.[0]) { account = null; walletType = null; chainId = null; } else { account = accounts[0]; walletType = 'metamask'; await readRealBalance(); } refresh(); });
  window.ethereum.on?.('chainChanged', async (nextChain) => { chainId = nextChain; await readRealBalance(); refresh(); });
}
refresh();
