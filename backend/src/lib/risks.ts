import { SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { RiskFlag } from './store';

/**
 * Deterministic risk rules — run in code, NEVER in the LLM (CONTRACT.md).
 * Pure functions: every rule is unit-testable without network or LLM.
 */

export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export const KNOWN_PROGRAM_IDS = new Set<string>([
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  MEMO_PROGRAM_ID,
]);

export interface RiskInput {
  /** Amount in SOL (transfer_sol) — undefined for reads. */
  amountSol?: number;
  /** Destination address (base58), if any. */
  to?: string;
  /** Per-transaction cap in SOL. */
  perTxCap: number;
  /** Payees seen earlier this session. */
  seenPayees: Set<string>;
  /** Number of prior on-chain txs for the payee; null when unknown (RPC failed). */
  payeeTxCount: number | null;
  /** Program ids touched by the built transaction. */
  programIds: string[];
}

export function evaluateRiskFlags(input: RiskInput): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (input.to && !input.seenPayees.has(input.to)) {
    flags.push({
      code: 'NEW_PAYEE',
      severity: 'medium',
      detail: `This address (${shortAddr(input.to)}) has not received a transfer in this session before.`,
    });
  }

  if (input.amountSol !== undefined && input.amountSol >= input.perTxCap) {
    flags.push({
      code: 'LARGE_AMOUNT',
      severity: 'high',
      detail: `${input.amountSol} SOL is at or above the per-transaction cap of ${input.perTxCap} SOL.`,
    });
  }

  if (input.payeeTxCount === 0 && input.to) {
    flags.push({
      code: 'FRESH_WALLET',
      severity: 'medium',
      detail: `This address (${shortAddr(input.to)}) has no prior transactions on-chain — it looks brand new.`,
    });
  }

  for (const pid of input.programIds) {
    if (!KNOWN_PROGRAM_IDS.has(pid)) {
      flags.push({
        code: 'UNKNOWN_PROGRAM',
        severity: 'high',
        detail: `Transaction touches unknown program ${shortAddr(pid)}. Expected only System, Token, or Memo programs.`,
      });
    }
  }

  return flags;
}

export function shortAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-3)}`;
}
