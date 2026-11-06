import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * REAL DevNet integration test. Skipped unless RUN_INTEGRATION=1.
 * Spawns the built server (node dist/server.js) on port 4001 with NO Groq
 * key (deterministic intent parsing — zero Groq usage), then drives the full
 * HTTP flow: seed -> chat transfer -> confirm -> verify true -> tamper ->
 * verify false. Every signature asserted here comes from a real DevNet call.
 */

const RUN = process.env.RUN_INTEGRATION === '1';
const BACKEND_DIR = join(__dirname, '..');
const PORT = 4001;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;
let actionId = '';
let signature = '';
let memoSignature = '';

async function waitForHealth(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms (last: ${lastErr})`);
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe.skipIf(!RUN)('DevNet integration (real chain)', () => {
  beforeAll(async () => {
    const env = { ...process.env, PORT: String(PORT), RPC_URL: 'https://api.devnet.solana.com' };
    delete env.GROQ_API_KEY; // deterministic fallback path — no Groq usage
    server = spawn('node', ['dist/server.js'], { cwd: BACKEND_DIR, env, stdio: 'pipe' });
    server.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
    server.stderr?.on('data', (d) => process.stdout.write(`[server:err] ${d}`));
    await waitForHealth();
  }, 200_000);

  afterAll(() => {
    server?.kill('SIGTERM');
  });

  it('health reports a demo wallet and balance', async () => {
    const { status, body } = await api('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.demoWallet).toBe('string');
    expect(typeof body.demoBalanceSol).toBe('number');
    expect(body.demoBalanceSol as number).toBeGreaterThanOrEqual(0);
  });

  it('seed returns the three demo commands and a funded demo wallet', async () => {
    const { status, body } = await api('/api/demo/seed');
    expect(status).toBe(200);
    const commands = body.commands as { label: string; message: string }[];
    expect(commands).toHaveLength(3);
    expect(commands[0].message.toLowerCase()).toContain('balance');
    expect(commands[1].message).toContain('0.05 SOL');
    expect(commands[2].message).toContain('5 SOL');
    expect(typeof body.demoWallet).toBe('string');
    expect(body.demoBalanceSol as number).toBeGreaterThanOrEqual(0.2);
  });

  it('risky 5 SOL instruction is flagged AND cap-blocked with no txPreview', async () => {
    const seed = await api('/api/demo/seed');
    const risky = (seed.body.commands as { message: string }[])[2].message;
    const { status, body } = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: risky, demo: true }),
    });
    expect(status).toBe(200);
    expect(body.blocked).toBe(true);
    expect(body.blockReason).toContain('per-transaction cap');
    expect(body.txPreview).toBeUndefined();
    const actions = await api('/api/actions');
    const blocked = (actions.body.actions as { status: string; id: string }[]).find(
      (a) => a.id === body.actionId,
    );
    expect(blocked?.status).toBe('blocked');
  });

  it('executes a 0.01 SOL demo transfer end-to-end with an on-chain receipt', async () => {
    const chat = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Send 0.01 SOL to Alice', demo: true }),
    });
    expect(chat.status).toBe(200);
    expect(chat.body.intent).toBe('transfer_sol');
    expect(chat.body.blocked).toBe(false);
    expect(chat.body.requiresConfirm).toBe(true);
    expect(typeof chat.body.txPreview).toBe('string');
    expect(Array.isArray(chat.body.riskFlags)).toBe(true);
    actionId = chat.body.actionId as string;

    const confirm = await api('/api/confirm', {
      method: 'POST',
      body: JSON.stringify({ actionId }),
    });
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('executed');
    signature = confirm.body.signature as string;
    memoSignature = confirm.body.memoSignature as string;
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(80);
    expect(typeof memoSignature).toBe('string');
    expect(memoSignature).not.toBe(signature);
    const solscan = confirm.body.solscan as { tx: string; memo: string };
    expect(solscan.tx).toBe(`https://solscan.io/tx/${signature}?cluster=devnet`);
    expect(solscan.memo).toBe(`https://solscan.io/tx/${memoSignature}?cluster=devnet`);
    console.log(`[integration] transfer signature: ${signature}`);
    console.log(`[integration] memo signature: ${memoSignature}`);
    console.log(`[integration] solscan tx: ${solscan.tx}`);
    console.log(`[integration] solscan memo: ${solscan.memo}`);

    const limits = await api('/api/limits');
    expect(limits.body.sessionSpentSol as number).toBeGreaterThanOrEqual(0.01);
  }, 120_000);

  it('verify returns true for the genuine record', async () => {
    const { status, body } = await api(`/api/verify/${actionId}`, { method: 'POST' });
    expect(status).toBe(200);
    expect(body.verified).toBe(true);
    expect(body.memoSignature).toBe(memoSignature);
    expect(body.expectedHash).toBe(body.onChainHash);
    expect(typeof body.expectedHash).toBe('string');
  });

  it('verify returns false after the stored record is tampered with', async () => {
    const dbPath = join(BACKEND_DIR, 'data', 'db.json');
    expect(existsSync(dbPath)).toBe(true);
    const original = readFileSync(dbPath, 'utf8');
    try {
      const db = JSON.parse(original) as { actions: { id: string; summary: string }[] };
      const rec = db.actions.find((a) => a.id === actionId);
      expect(rec).toBeDefined();
      rec!.summary = `${rec!.summary} TAMPERED`;
      writeFileSync(dbPath, JSON.stringify(db, null, 2));
      const tampered = await api(`/api/verify/${actionId}`, { method: 'POST' });
      expect(tampered.status).toBe(200);
      expect(tampered.body.verified).toBe(false);
      expect(tampered.body.onChainHash).not.toBe(tampered.body.expectedHash);
    } finally {
      writeFileSync(dbPath, original);
    }
    // Restored record verifies true again.
    const restored = await api(`/api/verify/${actionId}`, { method: 'POST' });
    expect(restored.body.verified).toBe(true);
  });
});
