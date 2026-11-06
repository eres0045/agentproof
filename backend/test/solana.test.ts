import { describe, expect, it } from 'vitest';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  buildMemoTransaction,
  buildSolTransfer,
  buildTokenTransfer,
  deserializeSignedTx,
  extractMemoFromLogs,
  programIdsOf,
} from '../src/lib/solana';

// '1111...1' decodes to 32 zero bytes — a valid (if dummy) blockhash.
const DUMMY_BLOCKHASH = '11111111111111111111111111111111';

function fakeConn(over: Record<string, unknown> = {}) {
  return {
    getLatestBlockhash: async () => ({ blockhash: DUMMY_BLOCKHASH, lastValidBlockHeight: 1 }),
    getAccountInfo: async () => null,
    ...over,
  } as never;
}

describe('solana tx building (offline, fake connection)', () => {
  it('builds an unsigned SOL transfer with the right instruction', async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const tx = await buildSolTransfer(fakeConn(), from, to, 0.05 * LAMPORTS_PER_SOL);
    expect(tx.feePayer?.toBase58()).toBe(from.toBase58());
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(programIdsOf(tx)).toEqual([SystemProgram.programId.toBase58()]);
    // Unsigned preview serializes without signatures.
    const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(50);
  });

  it('builds an SPL transfer with ATA creation + transfer instructions', async () => {
    const payer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const { tx, fromAta, toAta } = await buildTokenTransfer(fakeConn(), payer, mint, payer, to, 10_000_000);
    expect(tx.instructions).toHaveLength(2);
    expect(tx.instructions[0].programId.toBase58()).toBe(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL').toBase58());
    expect(tx.instructions[1].programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(fromAta).toBeDefined();
    expect(toAta).toBeDefined();
    expect(programIdsOf(tx)).toHaveLength(2);
  });

  it('builds a signed memo transaction containing the memo text', async () => {
    const payer = Keypair.generate();
    const tx = await buildMemoTransaction(fakeConn(), payer, 'AgentProof v1 | action:act_x | sha256:ab12');
    expect(tx.signatures.length).toBeGreaterThan(0);
    const data = tx.instructions[0].data.toString('utf8');
    expect(data).toBe('AgentProof v1 | action:act_x | sha256:ab12');
  });

  it('signed tx round-trips through base64 serialize/deserialize', async () => {
    const from = Keypair.generate();
    const to = Keypair.generate().publicKey;
    const tx = await buildSolTransfer(fakeConn(), from.publicKey, to, 1000);
    tx.sign(from);
    const b64 = Buffer.from(tx.serialize()).toString('base64');
    const back = deserializeSignedTx(b64);
    expect(back).toBeDefined();
    expect(Buffer.from(back.serialize()).toString('base64')).toBe(b64);
  });

  it('extractMemoFromLogs pulls the memo out of program logs', () => {
    const logs = [
      'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]',
      'Program log: Memo (len 20): "AgentProof v1 | test"',
      'Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr success',
    ];
    expect(extractMemoFromLogs(logs)).toBe('AgentProof v1 | test');
    expect(extractMemoFromLogs(['Program log: something else'])).toBeNull();
    expect(extractMemoFromLogs(null)).toBeNull();
  });
});
