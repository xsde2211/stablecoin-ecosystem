# INRXScan

A public explorer for the INRX ledger: search any transaction hash or
wallet address, browse mint/burn/send/swap/bridge activity across every
network, filter by network and date range, and connect a browser wallet.
No sign up / sign in — wallet connect only.

## Run it

Three pieces: your existing gateway + stablecoin-service + swap-service
(unchanged paths, see `../inrxscan-backend-changes.zip` for what to drop
in), the new Node BFF in `server/`, and this React app.

```bash
# 1) BFF
cd server
npm install
cp .env.example .env      # GATEWAY_URL should point at your gateway
npm start                 # listens on :4000 by default

# 2) Frontend (separate terminal)
npm install
cp .env.example .env      # VITE_API_BASE_URL should point at the BFF
npm run dev
```

```bash
npm run build              # production build to dist/
```

## What changed since the last version

1. **Sign up / Sign in removed.** Only "Connect Wallet" remains (MetaMask /
   any EIP-1193 browser wallet) — this is a public read-only explorer, not
   an account-gated app.
2. **RECEIVE is gone as a shown/filterable type.** A wallet-to-wallet
   transfer is one on-chain event; it's now shown once, as SEND. (Backend:
   `dedupeTxRows()` collapses the SEND/RECEIVE pair the DB still writes
   internally.)
3. **Bridge transactions now show up.** They were entirely invisible
   before — bridge activity lives in a separate `BridgeTransfer` table
   that nothing merged into the explorer. Now `BRIDGE_LOCK` (source-chain
   leg) and `BRIDGE_MINT` (destination-chain leg) both appear as normal
   rows.
4. **Date range filter** — "From" / "To" date pickers on the transactions
   list, alongside type and network.
5. **Block and Txn Fee columns** — Block is the on-chain block number;
   Txn Fee is gas cost in the chain's native currency (e.g. `0.000043
   sepETH`, `16 TRX(testnet)`, `0.02 POL(testnet)`, `0.03 tBNB`). Shows
   "—" where fee wasn't captured — see the backend changes' known
   limitation on fee coverage.
6. **"View on network scan" link** on the transaction detail page — links
   straight to Sepolia Etherscan / Tron Nile Tronscan / BSC testnet
   BscScan / Polygon Amoy PolygonScan for that exact tx hash. The URL is
   built server-side (`explorerUrl` on every transaction) so this frontend
   never needs to know the URL scheme itself.
7. **Network display names** — "Sepolia Ethereum", "Tron Nile", "BSC
   Testnet", "Polygon Amoy" everywhere a chain is shown, sourced from the
   backend's `GET /explorer/networks` (via the BFF) rather than hardcoded
   in this repo — see "Moving to mainnet" below.
8. **Address page: balance per network + total.** Visiting an address
   shows its INRX balance broken out by network (Sepolia ETH, BSC
   testnet, Polygon Amoy, Tron Nile...) plus a combined total, and its
   full transaction history across all networks by default, filterable
   down to one.
9. **Node BFF (`server/`) + axios.** A thin Express layer sits between
   this app and your gateway, exposing:
   - `GET /explorer/transactions` — everything, every filter as query params
   - `GET /explorer/transactions/:network` — all tx on one network
   - `GET /explorer/transactions/:address` — all tx for an address, any network
   - `GET /explorer/transactions/:address/:network` — address, one network
   - `GET /explorer/address/:address` and `/explorer/address/:address/:network`
     — same as above, unambiguous names (used by this frontend directly)
   - `GET /explorer/tx/:hash` — single transaction
   - `GET /explorer/stats`, `/explorer/stats/:network`
   - `GET /explorer/networks` — the label/fee-symbol/explorer-URL metadata
   The frontend now uses **axios**, not `fetch`, everywhere (`src/lib/api.js`).

## Moving to mainnet later

This was built specifically so a mainnet cutover touches as few places as
possible:

- **One file on the backend**: `stablecoin-service/src/stablecoin/networks.config.ts`
  — swap each network's `label`/`nativeSymbol`/`explorerTxBase`/
  `explorerAddressBase` for its mainnet equivalent, flip `testnet: false`.
  Everything downstream (the explorer API, this frontend, the BFF) reads
  from this file or from `GET /stablecoin/explorer/networks`, which just
  serves it — none of them hardcode "Sepolia" or "testnet" anywhere else.
- **RPC URLs / contract addresses**: unchanged from however
  stablecoin-service already handled per-chain env vars for its existing
  mint/burn logic (`ETH_RPC`, `ETH_INRX_ADDRESS`, etc.) — same pattern,
  just point them at mainnet.
- **The BFF (`server/`)** has zero testnet-specific values — its only
  config is `GATEWAY_URL`, and it refreshes its known-networks list from
  the backend automatically. No code change needed there for a cutover.
- **This frontend** has zero testnet-specific values either — network
  labels come from the BFF/backend at runtime (`NetworksContext`), and the
  only local config is `VITE_API_BASE_URL` (pointing at the BFF).

## Known limitations (carried over / new)

- **Pagination on the merged transaction list is windowed, not a true
  unbounded COUNT(*)** — see the long comment in the backend changes'
  `HOW_TO_APPLY.txt`. Fine at testnet scale; revisit with a materialized
  view before real production traffic.
- **Fee ("Txn Fee") is only captured for transactions that went through
  the direct mint/burn endpoints (including both swap legs)** — a plain
  transfer detected purely by `listener-service` watching the chain
  doesn't have fee data yet and shows "—". Extending `listener-service`'s
  confirmation path to fetch the receipt's gas cost too would close this;
  I can add it next if you want full coverage.
- **Bridge transaction fee/block aren't captured at all yet** (the
  `BridgeTransfer` table has no fee/block columns, and nothing writes
  them today) — bridge rows always show "—" for both. Worth adding if
  bridge activity becomes a meaningful share of traffic.
- **Balance is ledger-derived** (sums recorded `Transaction` rows), not a
  live `balanceOf()` read per chain — can drift if a row is ever missed
  by both the direct-call path and `listener-service`.

## Design notes

- **Palette** — deep ink-navy base, *Rupee Indigo* (primary) + *Bullion
  Gold* (verified/live states, and the signature scan-line animation on
  the homepage stat strip).
- **Type** — Space Grotesk (headings), Inter (UI text), IBM Plex Mono
  (every hash, address, and number).
- **Structure** — dense hairline-divided tables with Block and Txn Fee now
  alongside the core columns, a persistent search bar, and network + type
  + date-range filters that all compose together as query params rather
  than being mutually exclusive UI states.
