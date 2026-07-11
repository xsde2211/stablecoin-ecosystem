# Reserve Dashboard — INRX · EGold · ESilver

A read-only, live dashboard for the token ecosystem across Ethereum, Polygon, BSC, and Tron. No wallet connection, no private keys, no writes — everything here is public on-chain reads and public price APIs.

## What it shows

- **Network selector** — Ethereum / Polygon / BSC / Tron. Switching networks re-reads contract balances for that chain only.
- **Live market prices** — USDT, USD, INR, Gold, Silver, each with its INR/USD equivalent.
- **Contract token rates** — INRX (₹1 peg + live USD equivalent), EGold (1g gold), ESilver (1g silver), all driven by live prices.
- **Converter** — USDT ⇄ INRX using the live USDT/INR market rate.
- **Smart contract balances** — INRX/EGold/ESilver held **by the contracts themselves**, not any connected wallet.
- **Total portfolio value** — sum of the three balances above at current prices, shown in INR and USD, with a composition bar showing what fraction of the total each asset contributes.

## One assumption worth double-checking with your PM

"Balance held by the deployed contracts" is implemented as **each token contract's own `balanceOf(itself)`** — i.e. how many of its own tokens each token contract is holding. You only gave me the three token addresses per chain (no separate treasury/vault address), so that's the literal reading. If what you actually meant is a *different* contract (e.g. a ReserveVault or Treasury address) holding these tokens, that's a one-line change: in `src/lib/chainReader.ts`, swap the second argument to `balanceOf(...)` from the token's own address to whatever holder address you want, per token.

## Data sources & refresh rates

| Data | Source | Refresh |
|---|---|---|
| Gold / Silver (USD/oz) | `api.gold-api.com/price/XAU` \| `XAG` | every 7 min, **cached in localStorage** so page reloads within that window don't spend another call — the free tier caps around 10 req/hour |
| USD/INR | `open.er-api.com`, falls back to `api.frankfurter.app` if the primary is unreachable | every 60s |
| USDT price | CoinGecko public simple-price endpoint | every 60s |
| Contract balances | direct RPC reads (`ethers` for EVM, `tronweb` for Tron) | every 45s, per selected network |

**Scaling note:** all of the above run client-side, in each visitor's browser. That's fine for a low-traffic internal dashboard. If this becomes a public, higher-traffic page, the gold/silver calls in particular should move behind a small server-side cache (a Vercel serverless function that itself polls every 7 min and serves all visitors from one cached value) so N concurrent visitors don't multiply the upstream call count — happy to build that next if/when you need it.

## Local development

```bash
npm install
npm run dev
```

## Deploying to Vercel

No environment variables are required — every RPC and contract address already has a working default matching what you provided. Two ways to ship it:

**Option A — Vercel CLI**
```bash
npm i -g vercel
vercel
```

**Option B — Git**
1. Push this folder to a GitHub repo.
2. Import it in the Vercel dashboard → it auto-detects Vite (build command `vite build`, output dir `dist`).
3. Deploy.

If you ever want to override an RPC or contract address without touching code, set the matching `VITE_*` variable in Vercel's Project → Settings → Environment Variables (see `.env.example` for the full list) and redeploy.

## Notes on the RPC endpoints

Defaults point at the same testnets already in use elsewhere in this project (Sepolia, Polygon Amoy, BSC testnet, Tron Nile). The BSC default deliberately uses `bsc-testnet-rpc.publicnode.com` rather than the raw `bsc-testnet-dataseed.bnbchain.org` endpoint — the latter has been unreliable for even plain reads under load in earlier testing on this project.
