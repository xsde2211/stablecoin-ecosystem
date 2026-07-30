// tools/scripts/dev.js
// Run from root: node tools/scripts/dev.js

const { spawn, execSync } = require('child_process');
const path  = require('path');
const net   = require('net');

// ── Config ────────────────────────────────────────────────────────────────────

const services = [
  { name: 'auth',          dir: 'services/auth-service',         port: 3002, color: '\x1b[32m' },
  { name: 'wallet',        dir: 'services/wallet-service',       port: 3003, color: '\x1b[33m' },
  { name: 'stablecoin',    dir: 'services/stablecoin-service',   port: 3005, color: '\x1b[34m' },
  { name: 'swap',          dir: 'services/swap-service',         port: 3016, color: '\x1b[1;36m' },
  { name: 'treasury',      dir: 'services/treasury-service',     port: 3006, color: '\x1b[31m' },
  { name: 'reserve',       dir: 'services/reserve-service',      port: 3007, color: '\x1b[37m' },
  { name: 'payment',       dir: 'services/payment-service',      port: 3008, color: '\x1b[92m' },
  { name: 'merchant',      dir: 'services/merchant-service',     port: 3009, color: '\x1b[93m' },
  { name: 'kyc',           dir: 'services/kyc-service',          port: 3010, color: '\x1b[94m' },
  { name: 'notification',  dir: 'services/notification-service', port: 3011, color: '\x1b[95m' },
  { name: 'analytics',     dir: 'services/analytics-service',    port: 3012, color: '\x1b[96m' },
  { name: 'fraud',         dir: 'services/fraud-service',        port: 3013, color: '\x1b[91m' },
  { name: 'listener',      dir: 'services/listener-service',     port: 3014, color: '\x1b[90m' },
  { name: 'admin',         dir: 'services/admin-service',        port: 3015, color: '\x1b[97m' },
  // Gateway last — after all services are up
  { name: 'gateway',       dir: 'services/gateway',              port: 3001, color: '\x1b[36m' },
  // Bridge last — needs kafka
  { name: 'bridge',        dir: 'services/bridge-service',       port: 3004, color: '\x1b[35m' },
];

const RESET  = '\x1b[0m';
const processes = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(str, len) {
  return str.padEnd(len, ' ');
}

function log(svc, msg, isErr = false) {
  const prefix = `${svc.color}[${pad(svc.name, 13)}]${RESET}`;
  if (isErr) {
    // Filter out known harmless warnings
    if (msg.includes('ExperimentalWarning'))  return;
    if (msg.includes('DeprecationWarning'))   return;
    if (msg.includes('punycode'))             return;
    if (msg.includes('NODE_TLS_REJECT'))      return;
    console.error(`${prefix} \x1b[31m${msg}${RESET}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

// Wait until a TCP port is accepting connections
function waitForPort(host, port, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const start   = Date.now();
    const tryConn = () => {
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error',   () => { sock.destroy(); retry(); });
      sock.on('timeout', () => { sock.destroy(); retry(); });
      sock.connect(port, host);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timeout waiting for ${host}:${port}`));
        return;
      }
      setTimeout(tryConn, 500);
    };
    tryConn();
  });
}

// Start one service process
function startService(svc) {

  const cwd = path.join(__dirname, '..', '..', svc.dir);

  console.log(`Starting ${svc.name} from ${cwd}`);

    const proc = spawn('pnpm', ['dev'], {
    cwd,
    shell: true,
    env:   { ...process.env },
  });

  proc.stdout.on('data', (data) => {
    data.toString().split('\n')
      .filter(l => l.trim())
      .forEach(line => log(svc, line));
  });

  proc.stderr.on('data', (data) => {
    data.toString().split('\n')
      .filter(l => l.trim())
      .forEach(line => log(svc, line, true));
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(svc, `Exited (code ${code}). Restarting in 5s...`, true);
      setTimeout(() => startService(svc), 5000);
    }
  });

  processes.push(proc);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[36m');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Stablecoin Ecosystem — Dev Server      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(RESET);

  // ── Step 1: Check Docker infra is up ──────────────────────────────────────
  console.log('\x1b[33m[1/3] Checking infrastructure...\x1b[0m');

  const infra = [
    { name: 'PostgreSQL', host: 'localhost', port: 5433 },
    { name: 'Redis',      host: 'localhost', port: 6379 },
  ];

  for (const svc of infra) {
    process.stdout.write(`      Waiting for ${svc.name} on :${svc.port}...`);
    try {
      await waitForPort(svc.host, svc.port, 60_000);
      console.log(' \x1b[32mready\x1b[0m');
    } catch {
      console.log(' \x1b[31mNOT REACHABLE\x1b[0m');
      console.log('');
      console.log('\x1b[31mERROR: Infrastructure not running.\x1b[0m');
      console.log('Run this first:');
      console.log('  \x1b[36mdocker compose up -d postgres redis kafka zookeeper\x1b[0m');
      console.log('Then wait 10 seconds and retry.');
      process.exit(1);
    }
  }

  // After the for loop that checks infra, add:
  console.log('\n      Giving postgres 5s to finish initializing...');
  await new Promise(r => setTimeout(r, 5000));

  // ── Step 2: Sync .env files ───────────────────────────────────────────────
  console.log('\n\x1b[33m[2/3] Syncing .env files...\x1b[0m');
  try {
    const fs   = require('fs');
    const root = path.join(__dirname, '../..');

    const svcPorts = {
      'gateway':              3001, 'auth-service':         3002,
      'wallet-service':       3003, 'bridge-service':       3004,
      'stablecoin-service':   3005, 'treasury-service':     3006,
      'reserve-service':      3007, 'payment-service':      3008,
      'merchant-service':     3009, 'kyc-service':          3010,
      'notification-service': 3011, 'analytics-service':    3012,
      'fraud-service':        3013, 'listener-service':     3014,
      'admin-service':        3015, 'swap-service':         3016,
    };

    const rootEnv = fs.readFileSync(path.join(root, '.env'), 'utf8');

    for (const [svc, port] of Object.entries(svcPorts)) {
      const svcPath = path.join(root, 'services', svc);
      if (!fs.existsSync(svcPath)) continue;
      const content = rootEnv.trimEnd() + `\nPORT=${port}\n`;
      fs.writeFileSync(path.join(svcPath, '.env'), content);
    }
    console.log('      \x1b[32mAll .env files synced from root\x1b[0m');
  } catch (e) {
    console.log(`      \x1b[33mCould not sync .env: ${e.message}\x1b[0m`);
  }

  // ── Step 3: Start all services ────────────────────────────────────────────
  console.log('\n\x1b[33m[3/3] Starting services...\x1b[0m\n');

  services.forEach((svc, i) => {
    setTimeout(() => {
      startService(svc);
      console.log(`\x1b[32m✓\x1b[0m ${svc.color}${svc.name}${RESET} → :${svc.port}`);
    }, i * 400);
  });

  const totalDelay = services.length * 400 + 1000;
  setTimeout(() => {
    console.log('');
    console.log('\x1b[36m══════════════════════════════════════════\x1b[0m');
    console.log('\x1b[32mAll services starting up\x1b[0m');
    console.log(`Gateway:   \x1b[36mhttp://localhost:3001\x1b[0m`);
    console.log(`Swagger:   \x1b[36mhttp://localhost:3001/docs\x1b[0m`);
    console.log('\x1b[36m══════════════════════════════════════════\x1b[0m');
  }, totalDelay);
}

// ── Shutdown ─────────────────────────────────────────────────────────────────
process.on('SIGINT',  () => {
  console.log('\n\x1b[33mShutting down all services...\x1b[0m');
  processes.forEach(p => { try { p.kill('SIGTERM'); } catch {} });
  setTimeout(() => process.exit(0), 1000);
});
process.on('SIGTERM', () => {
  processes.forEach(p => { try { p.kill('SIGTERM'); } catch {} });
  process.exit(0);
});

main().catch(err => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});
