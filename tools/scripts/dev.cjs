// Run from root: node tools/scripts/dev.js
// Starts all services in ONE terminal with colored output

const { spawn } = require('child_process');
const path      = require('path');

const services = [
  { name: 'gateway',              dir: 'services/gateway',              port: 3001, color: '\x1b[36m' },
  { name: 'auth',                 dir: 'services/auth-service',         port: 3002, color: '\x1b[32m' },
  { name: 'wallet',               dir: 'services/wallet-service',       port: 3003, color: '\x1b[33m' },
  { name: 'bridge',               dir: 'services/bridge-service',       port: 3004, color: '\x1b[35m' },
  { name: 'stablecoin',           dir: 'services/stablecoin-service',   port: 3005, color: '\x1b[34m' },
  { name: 'treasury',             dir: 'services/treasury-service',     port: 3006, color: '\x1b[31m' },
  { name: 'reserve',              dir: 'services/reserve-service',      port: 3007, color: '\x1b[37m' },
  { name: 'payment',              dir: 'services/payment-service',      port: 3008, color: '\x1b[92m' },
  { name: 'merchant',             dir: 'services/merchant-service',     port: 3009, color: '\x1b[93m' },
  { name: 'kyc',                  dir: 'services/kyc-service',          port: 3010, color: '\x1b[94m' },
  { name: 'notification',         dir: 'services/notification-service', port: 3011, color: '\x1b[95m' },
  { name: 'analytics',            dir: 'services/analytics-service',    port: 3012, color: '\x1b[96m' },
  { name: 'fraud',                dir: 'services/fraud-service',        port: 3013, color: '\x1b[91m' },
  { name: 'listener',             dir: 'services/listener-service',     port: 3014, color: '\x1b[90m' },
  { name: 'admin',                dir: 'services/admin-service',        port: 3015, color: '\x1b[97m' },
];

const RESET = '\x1b[0m';
const processes = [];

function pad(str, len) {
  return str.padEnd(len, ' ');
}

function startService(svc) {
  const cwd = path.join(__dirname, '..', '..', svc.dir);

  console.log(`Starting ${svc.name} from ${cwd}`);

  const proc = spawn('cmd.exe', ['/c', 'pnpm', 'dev'], {
    cwd,
    env: { ...process.env },
    windowsHide: false,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());

    lines.forEach(line => {
      console.log(`${svc.color}[${pad(svc.name, 12)}]${RESET} ${line}`);
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());

    lines.forEach(line => {
      if (line.includes('ExperimentalWarning')) return;
      if (line.includes('DeprecationWarning')) return;

      console.error(
        `${svc.color}[${pad(svc.name, 12)}]${RESET}\x1b[31m ${line}${RESET}`
      );
    });
  });

  proc.on('error', (err) => {
    console.error(`Failed to start ${svc.name}:`, err);
  });

  proc.on('exit', (code) => {
    if (code !== 0) {
      console.log(
        `\x1b[31m[${svc.name}] exited with code ${code}. Restarting in 3s...\x1b[0m`
      );

      setTimeout(() => startService(svc), 3000);
    }
  });

  processes.push(proc);

  return proc;
}
// Graceful shutdown
process.on('SIGINT',  () => { processes.forEach(p => p.kill()); process.exit(); });
process.on('SIGTERM', () => { processes.forEach(p => p.kill()); process.exit(); });

console.log('\x1b[36m╔══════════════════════════════════════╗\x1b[0m');
console.log('\x1b[36m║   Stablecoin Ecosystem — Dev Mode    ║\x1b[0m');
console.log('\x1b[36m╚══════════════════════════════════════╝\x1b[0m');
console.log('');

// Start all with 300ms stagger so logs don't collide at startup
services.forEach((svc, i) => {
  setTimeout(() => {
    startService(svc);
    console.log(`\x1b[32m✓ Starting ${svc.name} on :${svc.port}\x1b[0m`);
  }, i * 300);
});