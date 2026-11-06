import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { evaluateRiskFlags, KNOWN_PROGRAM_IDS, MEMO_PROGRAM_ID } from '../src/lib/risks';
import { SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const PAYEE = Keypair.generate().publicKey.toBase58();

function base(over: Record<string, unknown> = {}) {
  return {
    amountSol: 0.05,
    to: PAYEE,
    perTxCap: 0.1,
    seenPayees: new Set<string>(),
    payeeTxCount: 5,
    programIds: [SystemProgram.programId.toBase58()],
    ...over,
  };
}

describe('risk rules (deterministic, never LLM)', () => {
  it('NEW_PAYEE fires for a payee unseen this session', () => {
    const flags = evaluateRiskFlags(base());
    expect(flags.map((f) => f.code)).toContain('NEW_PAYEE');
  });

  it('NEW_PAYEE does not fire for a known payee', () => {
    const flags = evaluateRiskFlags(base({ seenPayees: new Set([PAYEE]) }));
    expect(flags.map((f) => f.code)).not.toContain('NEW_PAYEE');
  });

  it('LARGE_AMOUNT fires at exactly the per-tx cap', () => {
    const flags = evaluateRiskFlags(base({ amountSol: 0.1, seenPayees: new Set([PAYEE]) }));
    expect(flags.map((f) => f.code)).toContain('LARGE_AMOUNT');
    expect(flags.find((f) => f.code === 'LARGE_AMOUNT')?.severity).toBe('high');
  });

  it('LARGE_AMOUNT does not fire below the cap', () => {
    const flags = evaluateRiskFlags(base({ amountSol: 0.099, seenPayees: new Set([PAYEE]) }));
    expect(flags.map((f) => f.code)).not.toContain('LARGE_AMOUNT');
  });

  it('FRESH_WALLET fires when the payee has zero prior txs', () => {
    const flags = evaluateRiskFlags(base({ payeeTxCount: 0, seenPayees: new Set([PAYEE]) }));
    expect(flags.map((f) => f.code)).toContain('FRESH_WALLET');
  });

  it('FRESH_WALLET does not fire when payee tx count is unknown (null)', () => {
    const flags = evaluateRiskFlags(base({ payeeTxCount: null, seenPayees: new Set([PAYEE]) }));
    expect(flags.map((f) => f.code)).not.toContain('FRESH_WALLET');
  });

  it('UNKNOWN_PROGRAM fires for a program outside System/Token/Memo', () => {
    const flags = evaluateRiskFlags(
      base({ seenPayees: new Set([PAYEE]), programIds: [Keypair.generate().publicKey.toBase58()] }),
    );
    expect(flags.map((f) => f.code)).toContain('UNKNOWN_PROGRAM');
  });

  it('UNKNOWN_PROGRAM does not fire for System, Token, or Memo programs', () => {
    const flags = evaluateRiskFlags(
      base({
        seenPayees: new Set([PAYEE]),
        programIds: [
          SystemProgram.programId.toBase58(),
          TOKEN_PROGRAM_ID.toBase58(),
          MEMO_PROGRAM_ID,
        ],
      }),
    );
    expect(flags).toEqual([]);
    expect(KNOWN_PROGRAM_IDS.has(SystemProgram.programId.toBase58())).toBe(true);
  });

  it('a risky 5 SOL transfer to a fresh address raises NEW_PAYEE + LARGE_AMOUNT + FRESH_WALLET', () => {
    const flags = evaluateRiskFlags(base({ amountSol: 5, payeeTxCount: 0 }));
    const codes = flags.map((f) => f.code);
    expect(codes).toContain('NEW_PAYEE');
    expect(codes).toContain('LARGE_AMOUNT');
    expect(codes).toContain('FRESH_WALLET');
  });
});
