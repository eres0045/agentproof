import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { APROOF_DECIMALS, APROOF_INITIAL_SUPPLY, getBalanceSol } from './solana';
import { DATA_DIR } from './store';

/**
 * Demo wallet: a server-held DevNet keypair, generated on first run and
 * stored in backend/data/demo-keypair.json (gitignored, never committed).
 * Holds demo SOL only. The same keypair signs receipt memo transactions.
 */

const DEMO_KEYPAIR_PATH = join(DATA_DIR, 'demo-keypair.json');
const DEMO_RECIPIENT_KEYPAIR_PATH = join(DATA_DIR, 'demo-recipient-keypair.json');

function loadOrCreateKeypair(path: string, label: string): Keypair {
  if (existsSync(path)) {
    const secret = JSON.parse(readFileSync(path, 'utf8')) as number[];
    const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
    console.log(`[demoWallet] loaded ${label}: ${kp.publicKey.toBase58()}`);
    return kp;
  }
  const kp = Keypair.generate();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`[demoWallet] generated new ${label}: ${kp.publicKey.toBase58()} (saved to ${path})`);
  return kp;
}

let demoKeypair: Keypair | null = null;
let demoRecipientKeypair: Keypair | null = null;

export function getDemoKeypair(): Keypair {
  if (!demoKeypair) demoKeypair = loadOrCreateKeypair(DEMO_KEYPAIR_PATH, 'demo keypair');
  return demoKeypair;
}

/** Fixed demo recipient ("Alice"): a server-generated keypair, never funded by default. */
export function getDemoRecipientKeypair(): Keypair {
  if (!demoRecipientKeypair) {
    demoRecipientKeypair = loadOrCreateKeypair(DEMO_RECIPIENT_KEYPAIR_PATH, 'demo recipient keypair');
  }
  return demoRecipientKeypair;
}

export function getDemoRecipientPubkey(): PublicKey {
  return getDemoRecipientKeypair().publicKey;
}

export interface FundResult {
  balanceSol: number;
  funded: boolean;
  airdroppedSol?: number;
  error?: string;
}

/**
 * Fund the demo wallet via the DevNet faucet if balance < minSol.
 * Retries the airdrop once. If the faucet fails, logs loudly and reports
 * the error — funding is NEVER faked.
 */
export async function ensureFunded(
  conn: Connection,
  keypair: Keypair,
  minSol = 0.2,
  airdropSol = 1,
): Promise<FundResult> {
  const pubkey = keypair.publicKey;
  let balance = await getBalanceSol(conn, pubkey);
  if (balance >= minSol) return { balanceSol: balance, funded: false };
  console.log(`[demoWallet] balance ${balance} SOL < ${minSol} SOL — requesting ${airdropSol} SOL airdrop...`);
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const sig = await conn.requestAirdrop(pubkey, airdropSol * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, 'confirmed');
      balance = await getBalanceSol(conn, pubkey);
      console.log(`[demoWallet] airdrop confirmed (attempt ${attempt}), balance now ${balance} SOL`);
      return { balanceSol: balance, funded: true, airdroppedSol: airdropSol };
    } catch (err) {
      lastErr = err;
      console.error(`[demoWallet] AIRDROP FAILED (attempt ${attempt}/2):`, (err as Error).message);
    }
  }
  const msg = `DevNet faucet airdrop failed after 2 attempts: ${(lastErr as Error)?.message ?? lastErr}. ` +
    `Demo wallet ${pubkey.toBase58()} has ${balance} SOL — fund it manually (e.g. https://faucet.solana.com) before demoing transfers.`;
  console.error(`[demoWallet] ${msg}`);
  return { balanceSol: balance, funded: false, error: msg };
}

export interface MintResult {
  mint: string;
  created: boolean;
  error?: string;
}

/**
 * Create the APROOF SPL test mint on first run and mint 1000 tokens to the
 * demo wallet. Mint address is persisted by the caller (Store.setMint).
 * Returns the existing mint when one is already stored.
 */
export async function ensureMint(
  conn: Connection,
  demoKeypair: Keypair,
  existingMint: string | undefined,
): Promise<MintResult> {
  if (existingMint) return { mint: existingMint, created: false };
  try {
    console.log('[demoWallet] creating APROOF SPL mint...');
    const mint = await createMint(
      conn,
      demoKeypair,
      demoKeypair.publicKey,
      null,
      APROOF_DECIMALS,
    );
    const ata = await getOrCreateAssociatedTokenAccount(conn, demoKeypair, mint, demoKeypair.publicKey);
    await mintTo(conn, demoKeypair, mint, ata.address, demoKeypair, APROOF_INITIAL_SUPPLY * 10 ** APROOF_DECIMALS);
    console.log(`[demoWallet] APROOF mint created: ${mint.toBase58()} (1000 minted to demo wallet)`);
    return { mint: mint.toBase58(), created: true };
  } catch (err) {
    const msg = `APROOF mint creation failed: ${(err as Error).message}`;
    console.error(`[demoWallet] ${msg}`);
    return { mint: '', created: false, error: msg };
  }
}
