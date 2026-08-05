// ─────────────────────────────────────────────────────────────────────────
// API client for INRXScan — talks to the local Node BFF (see server/),
// not the gateway directly. The BFF is what exposes the dynamic
// per-network routes and is the single place a mainnet cutover touches on
// the frontend's side of things (just VITE_API_BASE_URL, if the BFF's own
// address changes — its GATEWAY_URL env var is what actually points at
// testnet vs mainnet backend infra).
// ─────────────────────────────────────────────────────────────────────────
import axios from 'axios';

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const client = axios.create({ baseURL: BASE, timeout: 20_000 });

function unwrap(promise) {
  return promise.then(r => r.data).catch(err => {
    const message = err.response?.data?.message || err.message || 'Request failed';
    const e = new Error(message);
    e.status = err.response?.status;
    e.data = err.response?.data;
    throw e;
  });
}

// ── Explorer ──────────────────────────────────────────────────────────
// `chain` accepts 'all' or any network key returned by networks().
// `type` accepts '' (all) or: SEND | MINT | BURN | BRIDGE_LOCK | BRIDGE_MINT | SWAP
// `from`/`to` are ISO date strings (yyyy-mm-dd), inclusive range.
export const explorer = {
  networks: () => unwrap(client.get('/explorer/networks')),

  stats: (chain) => unwrap(
    chain && chain !== 'all'
      ? client.get(`/explorer/stats/${chain}`)
      : client.get('/explorer/stats'),
  ),

  transactions: ({ page = 1, limit = 25, type = '', chain = 'all', query = '', from = '', to = '' } = {}) => {
    const params = { page, limit };
    if (type)  params.type  = type;
    if (chain && chain !== 'all') params.chain = chain;
    if (query) params.q = query;
    if (from)  params.from = from;
    if (to)    params.to   = to;
    return unwrap(client.get('/explorer/transactions', { params }));
  },

  transaction: (hash) => unwrap(client.get(`/explorer/tx/${hash}`)),

  address: (address, { page = 1, limit = 25, chain = 'all' } = {}) => {
    const params = { page, limit };
    if (chain && chain !== 'all') params.chain = chain;
    return unwrap(client.get(`/explorer/address/${address}`, { params }));
  },
};
