import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type ActionStatus = 'pending' | 'executed' | 'rejected' | 'blocked' | 'failed';

export interface RiskFlag {
  code: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface ActionRecord {
  id: string;
  intent: string;
  summary: string;
  explanation?: string;
  riskFlags?: RiskFlag[];
  amountSol?: number;
  /** Token amount (whole tokens) for transfer_token intents. */
  tokenAmount?: number;
  mint?: string;
  to?: string;
  status: ActionStatus;
  signature?: string;
  memoSignature?: string;
  receiptHash?: string;
  recordJson?: string;
  createdAt: string;
  demo?: boolean;
  wallet?: string;
  result?: unknown;
  question?: string;
  blockReason?: string;
}

export interface Limits {
  perTxCapSol: number;
  sessionCapSol: number;
}

export interface DbShape {
  actions: ActionRecord[];
  limits: Limits;
  /** APROOF SPL test mint address, created on first run. */
  mint?: string;
}

export const DEFAULT_LIMITS: Limits = { perTxCapSol: 0.1, sessionCapSol: 0.5 };

export const DATA_DIR =
  process.env.AGENTPROOF_DATA_DIR ?? join(__dirname, '..', '..', 'data');
export const DB_PATH = join(DATA_DIR, 'db.json');

/**
 * JSON-file store with atomic writes (write temp file + rename).
 * sessionSpentSol is derived from executed transfer records in db.json,
 * so it always agrees with the action log.
 */
export class Store {
  private dbPath: string;
  private db: DbShape;

  constructor(dbPath: string = DB_PATH) {
    this.dbPath = dbPath;
    this.db = this.load();
  }

  private load(): DbShape {
    try {
      if (existsSync(this.dbPath)) {
        const parsed = JSON.parse(readFileSync(this.dbPath, 'utf8')) as Partial<DbShape>;
        return {
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
          limits: { ...DEFAULT_LIMITS, ...(parsed.limits ?? {}) },
          mint: parsed.mint,
        };
      }
    } catch (err) {
      console.error(`[store] failed to read ${this.dbPath}, starting empty:`, err);
    }
    return { actions: [], limits: { ...DEFAULT_LIMITS } };
  }

  /** Atomic write: temp file + rename, so a crash can't half-write db.json. */
  private save(): void {
    mkdirSync(join(this.dbPath, '..'), { recursive: true });
    const tmp = `${this.dbPath}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    renameSync(tmp, this.dbPath);
  }

  getAll(): ActionRecord[] {
    return [...this.db.actions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Re-read db.json from disk (used by /api/verify so a tampered file is caught). */
  reload(): void {
    this.db = this.load();
  }

  get(id: string): ActionRecord | undefined {
    return this.db.actions.find((a) => a.id === id);
  }

  upsert(record: ActionRecord): ActionRecord {
    const i = this.db.actions.findIndex((a) => a.id === record.id);
    if (i >= 0) this.db.actions[i] = record;
    else this.db.actions.push(record);
    this.save();
    return record;
  }

  update(id: string, patch: Partial<ActionRecord>): ActionRecord | undefined {
    const rec = this.get(id);
    if (!rec) return undefined;
    Object.assign(rec, patch);
    this.save();
    return rec;
  }

  getLimits(): Limits {
    return { ...this.db.limits };
  }

  setLimits(patch: Partial<Limits>): Limits {
    Object.assign(this.db.limits, patch);
    this.save();
    return this.getLimits();
  }

  /** Sum of amountSol over executed SOL/token-transfer records. */
  sessionSpentSol(): number {
    let spent = 0;
    for (const a of this.db.actions) {
      if (a.status === 'executed' && (a.intent === 'transfer_sol' || a.intent === 'transfer_token')) {
        spent += a.amountSol ?? 0;
      }
    }
    return Math.round(spent * 1e9) / 1e9;
  }

  /** Payees seen in this session (any non-rejected transfer record). */
  seenPayees(): Set<string> {
    const seen = new Set<string>();
    for (const a of this.db.actions) {
      if (a.to && (a.intent === 'transfer_sol' || a.intent === 'transfer_token')) seen.add(a.to);
    }
    return seen;
  }

  getMint(): string | undefined {
    return this.db.mint;
  }

  setMint(mint: string): void {
    this.db.mint = mint;
    this.save();
  }
}
