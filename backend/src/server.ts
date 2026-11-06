import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app';
import { getConnection, getBalanceSol } from './lib/solana';
import { ensureFunded, ensureMint, getDemoKeypair } from './lib/demoWallet';
import { Store } from './lib/store';

/** Minimal .env loader (no dotenv dependency): KEY=VALUE lines, no overrides. */
function loadDotEnv(): void {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const port = Number(process.env.PORT ?? 4000);
  const app = createApp();

  // Best-effort demo wallet setup at startup: the server stays up even if
  // the faucet or mint creation fails — /api/demo/seed retries funding and
  // reports the error honestly.
  try {
    const conn = getConnection();
    const demoKeypair = getDemoKeypair();
    const fund = await ensureFunded(conn, demoKeypair);
    if (fund.error) console.error(`[server] startup funding issue: ${fund.error}`);
    const store = new Store();
    const mintRes = await ensureMint(conn, demoKeypair, store.getMint());
    if (mintRes.created) store.setMint(mintRes.mint);
    if (mintRes.error) console.error(`[server] startup mint issue: ${mintRes.error}`);
    const balance = await getBalanceSol(conn, demoKeypair.publicKey);
    console.log(`[server] demo wallet ${demoKeypair.publicKey.toBase58()} balance ${balance} SOL`);
  } catch (err) {
    console.error('[server] startup demo-wallet setup failed (server still starting):', (err as Error).message);
  }

  app.listen(port, () => {
    console.log(`[server] AgentProof backend listening on http://localhost:${port}`);
    console.log(`[server] RPC: ${process.env.RPC_URL ?? 'https://api.devnet.solana.com'} (DevNet only)`);
    console.log(`[server] Groq key present: ${Boolean(process.env.GROQ_API_KEY)}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
