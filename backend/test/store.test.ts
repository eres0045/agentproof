import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store, type ActionRecord } from '../src/lib/store';

function rec(over: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: 'act_test01',
    intent: 'transfer_sol',
    summary: 'Send 0.05 SOL to 9WzD...de1',
    amountSol: 0.05,
    to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVZRde1',
    status: 'pending',
    createdAt: '2026-11-06T10:00:00.000Z',
    ...over,
  };
}

describe('Store (db.json)', () => {
  it('upserts, reads, updates, and lists newest-first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentproof-store-'));
    try {
      const store = new Store(join(dir, 'db.json'));
      expect(store.getAll()).toEqual([]);
      store.upsert(rec());
      store.upsert(rec({ id: 'act_test02', createdAt: '2026-11-06T11:00:00.000Z' }));
      expect(store.getAll().map((a) => a.id)).toEqual(['act_test02', 'act_test01']);
      store.update('act_test01', { status: 'executed', signature: 'sig1' });
      expect(store.get('act_test01')?.status).toBe('executed');
      expect(existsSync(join(dir, 'db.json'))).toBe(true);
      // No temp files left behind after atomic writes.
      expect(existsSync(join(dir, 'db.json.tmp.1'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sessionSpentSol sums only executed transfers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentproof-store-'));
    try {
      const store = new Store(join(dir, 'db.json'));
      store.upsert(rec({ id: 'a1', status: 'executed', amountSol: 0.05 }));
      store.upsert(rec({ id: 'a2', status: 'pending', amountSol: 0.05 }));
      store.upsert(rec({ id: 'a3', status: 'executed', amountSol: 0.02, intent: 'transfer_token' }));
      store.upsert(rec({ id: 'a4', status: 'executed', intent: 'balance', amountSol: undefined }));
      expect(store.sessionSpentSol()).toBeCloseTo(0.07, 9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seenPayees tracks transfer destinations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentproof-store-'));
    try {
      const store = new Store(join(dir, 'db.json'));
      store.upsert(rec());
      expect(store.seenPayees().has('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVZRde1')).toBe(true);
      expect(store.seenPayees().size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('limits persist and reload from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentproof-store-'));
    try {
      const dbPath = join(dir, 'db.json');
      const store = new Store(dbPath);
      expect(store.getLimits()).toEqual({ perTxCapSol: 0.1, sessionCapSol: 0.5 });
      store.setLimits({ perTxCapSol: 0.2 });
      const reloaded = new Store(dbPath);
      expect(reloaded.getLimits()).toEqual({ perTxCapSol: 0.2, sessionCapSol: 0.5 });
      const raw = JSON.parse(readFileSync(dbPath, 'utf8')) as { limits: unknown };
      expect(raw.limits).toEqual({ perTxCapSol: 0.2, sessionCapSol: 0.5 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reload() picks up external edits to db.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentproof-store-'));
    try {
      const dbPath = join(dir, 'db.json');
      const store = new Store(dbPath);
      store.upsert(rec());
      const raw = JSON.parse(readFileSync(dbPath, 'utf8')) as { actions: ActionRecord[] };
      raw.actions[0].summary = 'TAMPERED';
      writeFileSync(dbPath, JSON.stringify(raw));
      store.reload();
      expect(store.get('act_test01')?.summary).toBe('TAMPERED');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
