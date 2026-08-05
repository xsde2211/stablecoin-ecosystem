// ─────────────────────────────────────────────────────────────────────────
// INRXScan BFF (Backend-For-Frontend) — a thin Node/Express layer between
// the React app and your gateway. It exists for one reason: to expose the
// friendly, dynamic-by-network routes the explorer UI wants (and that a
// future integration might want too), on top of the single, filterable
// /stablecoin/explorer/* API that actually lives on stablecoin-service.
//
// MAINNET CUTOVER: this file has ZERO testnet-specific values in it. The
// only thing it points at is GATEWAY_URL — change that env var to your
// production gateway and this layer needs no other change. All network
// display metadata (labels, native gas symbols, block explorer URLs) comes
// from stablecoin-service's networks.config.ts via GET /explorer/networks,
// fetched fresh at boot and periodically after — so a mainnet cutover on
// the backend (which is the one file that DOES need editing:
// services/stablecoin-service/src/stablecoin/networks.config.ts) is picked
// up here automatically, with no redeploy of this BFF required.
// ─────────────────────────────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());
app.use(express.json());

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const PORT = process.env.PORT || 4000;

const gateway = axios.create({ baseURL: GATEWAY_URL, timeout: 15_000 });

// Used only to tell apart "/explorer/transactions/:p1" meaning a network
// (tron, ethereum...) vs meaning an address (0x..., T...) — refreshed from
// the backend so a newly-added chain doesn't need a BFF code change either.
let KNOWN_NETWORKS = ['ethereum', 'bsc', 'polygon', 'tron', 'solana'];

async function loadNetworks() {
  try {
    const { data } = await gateway.get('/stablecoin/explorer/networks');
    if (Array.isArray(data?.keys) && data.keys.length) KNOWN_NETWORKS = data.keys;
  } catch (err) {
    console.warn('[inrxscan-bff] could not refresh network list from gateway, keeping previous list:', err.message);
  }
}
loadNetworks();
setInterval(loadNetworks, 10 * 60 * 1000);

const isKnownNetwork = (p) => KNOWN_NETWORKS.includes(p);

async function forward(res, path, params) {
  try {
    const { data } = await gateway.get(path, { params });
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json(err.response?.data || { message: err.message });
  }
}

// ── Static / whole-ledger routes ────────────────────────────────────────

app.get('/explorer/networks', (req, res) =>
  forward(res, '/stablecoin/explorer/networks'));

app.get('/explorer/stats', (req, res) =>
  forward(res, '/stablecoin/explorer/stats', req.query));

// Per-network stats: stablecoin-service's /stats isn't chain-scoped today
// (circulating supply is a cross-chain figure) — this route exists so the
// frontend has a stable place to call as that becomes chain-scoped later;
// for now it returns the same all-network stats. Documented, not silently
// wrong.
app.get('/explorer/stats/:network', (req, res) =>
  forward(res, '/stablecoin/explorer/stats', req.query));

app.get('/explorer/tx/:hash', (req, res) =>
  forward(res, `/stablecoin/explorer/transactions/${req.params.hash}`));

// ── Transactions — the routes requested, plus the address alias below ───

// GET /explorer/transactions  — every filter (chain, type, q, from, to,
// page, limit) passed straight through as query params.
app.get('/explorer/transactions', (req, res) =>
  forward(res, '/stablecoin/explorer/transactions', req.query));

// GET /explorer/transactions/:p1  — dynamic by design: if p1 is a known
// network key, this is "all transactions on that network"; otherwise it's
// treated as an address ("all transactions for that address, any network").
app.get('/explorer/transactions/:p1', (req, res) => {
  const { p1 } = req.params;
  if (isKnownNetwork(p1)) {
    forward(res, '/stablecoin/explorer/transactions', { ...req.query, chain: p1 });
  } else {
    forward(res, `/stablecoin/explorer/address/${p1}`, req.query);
  }
});

// GET /explorer/transactions/:address/:network — address, scoped to one
// specific network.
app.get('/explorer/transactions/:address/:network', (req, res) => {
  const { address, network } = req.params;
  forward(res, `/stablecoin/explorer/address/${address}`, { ...req.query, chain: network });
});

// ── Address — unambiguous alias, used by the frontend directly so it never
// has to rely on the network/address guessing above. ────────────────────

app.get('/explorer/address/:address', (req, res) =>
  forward(res, `/stablecoin/explorer/address/${req.params.address}`, req.query));

app.get('/explorer/address/:address/:network', (req, res) => {
  const { address, network } = req.params;
  forward(res, `/stablecoin/explorer/address/${address}`, { ...req.query, chain: network });
});

app.get('/health', (req, res) => res.json({ ok: true, gateway: GATEWAY_URL, networks: KNOWN_NETWORKS }));

app.listen(PORT, () => {
  console.log(`[inrxscan-bff] listening on :${PORT}, forwarding to ${GATEWAY_URL}`);
});
