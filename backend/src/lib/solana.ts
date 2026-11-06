import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { MEMO_PROGRAM_ID } from './risks';
import { parseMemoText } from './receipt';

export const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
export const APROOF_DECIMALS = 6;
export const APROOF_INITIAL_SUPPLY = 1000; // whole tokens minted to demo wallet on first run

let cachedConnection: Connection | null = null;

export function getConnection(): Connection {
  if (!cachedConnection) cachedConnection = new Connection(RPC_URL, 'confirmed');
  return cachedConnection;
}

export async function getBalanceSol(conn: Connection, address: PublicKey): Promise<number> {
  const lamports = await conn.getBalance(address);
  return lamports / LAMPORTS_PER_SOL;
}

export async function getSlot(conn: Connection): Promise<number> {
  return conn.getSlot();
}

/** Number of prior txs for an address (0 = fresh wallet). Null on RPC failure. */
export async function getPayeeTxCount(conn: Connection, address: PublicKey): Promise<number | null> {
  try {
    const sigs = await conn.getSignaturesForAddress(address, { limit: 1 });
    return sigs.length;
  } catch (err) {
    console.warn('[solana] getSignaturesForAddress failed:', (err as Error).message);
    return null;
  }
}

export async function buildSolTransfer(
  conn: Connection,
  from: PublicKey,
  to: PublicKey,
  lamports: number,
): Promise<Transaction> {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = from;
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  return tx;
}

export interface TokenTransferBuild {
  tx: Transaction;
  fromAta: PublicKey;
  toAta: PublicKey;
}

/** Build an SPL transfer; creates the recipient ATA if it does not exist yet. */
export async function buildTokenTransfer(
  conn: Connection,
  payer: PublicKey,
  mint: PublicKey,
  fromOwner: PublicKey,
  to: PublicKey,
  amountBaseUnits: number,
): Promise<TokenTransferBuild> {
  const fromAta = await getAssociatedTokenAddress(mint, fromOwner);
  const toAta = await getAssociatedTokenAddress(mint, to);
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  const toAtaInfo = await conn.getAccountInfo(toAta);
  if (!toAtaInfo) {
    tx.add(createAssociatedTokenAccountInstruction(payer, toAta, to, mint));
  }
  tx.add(createTransferInstruction(fromAta, toAta, fromOwner, amountBaseUnits));
  return { tx, fromAta, toAta };
}

export function programIdsOf(tx: Transaction): string[] {
  return tx.instructions.map((ix) => ix.programId.toBase58());
}

/** Build (but do not send) a memo transaction signed by `payer`. */
export async function buildMemoTransaction(
  conn: Connection,
  payer: Keypair,
  memoText: string,
): Promise<Transaction> {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.add(
    new TransactionInstruction({
      keys: [],
      programId: new PublicKey(MEMO_PROGRAM_ID),
      data: Buffer.from(memoText, 'utf8'),
    }),
  );
  tx.sign(payer);
  return tx;
}

/** Send raw tx bytes and wait until confirmed (polling, up to timeoutMs). */
export async function sendAndConfirm(
  conn: Connection,
  rawTx: Uint8Array,
  timeoutMs = 60_000,
): Promise<string> {
  const signature = await conn.sendRawTransaction(rawTx, { skipPreflight: false });
  await waitForConfirmation(conn, signature, timeoutMs);
  return signature;
}

/** Poll getSignatureStatus until confirmed/finalized, or throw on timeout/error. */
export async function waitForConfirmation(
  conn: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await conn.getSignatureStatus(signature);
    const status = res.value;
    if (status?.err) throw new Error(`transaction failed on-chain: ${JSON.stringify(status.err)}`);
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`transaction ${signature} did not confirm within ${timeoutMs}ms`);
}

/** Deserialize a base64 signed tx (versioned first, then legacy). */
export function deserializeSignedTx(base64: string): Transaction | VersionedTransaction {
  const bytes = Buffer.from(base64, 'base64');
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export function signatureOf(tx: Transaction | VersionedTransaction): string | null {
  if (tx instanceof VersionedTransaction) {
    const sig = tx.signatures[0];
    return sig && sig.some((b) => b !== 0) ? Buffer.from(sig).toString('base64') : null;
  }
  return tx.signature ? tx.signature.toString('base64') : null;
}

/** Raw bytes of a signed tx, for sendRawTransaction. */
export function serializeSigned(tx: Transaction | VersionedTransaction): Uint8Array {
  return tx.serialize();
}

export interface HistoryEntry {
  signature: string;
  slot: number;
  blockTime: number | null | undefined;
  confirmationStatus: string | null | undefined;
  err: unknown;
}

export async function getHistory(conn: Connection, address: PublicKey, limit = 10): Promise<HistoryEntry[]> {
  const sigs = await conn.getSignaturesForAddress(address, { limit });
  return sigs.map((s) => ({
    signature: s.signature,
    slot: s.slot,
    blockTime: s.blockTime,
    confirmationStatus: s.confirmationStatus,
    err: s.err,
  }));
}

export interface ExplainedTx {
  signature: string;
  slot: number | null;
  blockTime: number | null | undefined;
  feeSol: number | null;
  success: boolean;
  programs: string[];
  memo: string | null;
  logMessages: string[];
}

/** Fetch a tx and summarise it in plain fields for explain_tx. */
export async function explainTransaction(conn: Connection, signature: string): Promise<ExplainedTx> {
  const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
  if (!tx) throw new Error(`transaction ${signature} not found on DevNet`);
  const programs = new Set<string>();
  // Versioned messages expose compiledInstructions + getAccountKeys();
  // legacy parsed messages expose instructions + accountKeys.
  const msg = tx.transaction.message as unknown as {
    instructions?: { programIdIndex: number }[];
    compiledInstructions?: { programIdIndex: number }[];
    accountKeys?: PublicKey[];
    getAccountKeys?: () => { staticAccountKeys: PublicKey[] };
  };
  const accountKeys: PublicKey[] =
    typeof msg.getAccountKeys === 'function'
      ? msg.getAccountKeys().staticAccountKeys
      : (msg.accountKeys ?? []);
  const instructions = msg.instructions ?? msg.compiledInstructions ?? [];
  for (const ix of instructions) {
    const key = accountKeys[ix.programIdIndex];
    if (key) programs.add(key.toBase58());
  }
  const memo = extractMemoFromLogs(tx.meta?.logMessages ?? null);
  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    feeSol: tx.meta?.fee !== undefined && tx.meta?.fee !== null ? tx.meta.fee / LAMPORTS_PER_SOL : null,
    success: !tx.meta?.err,
    programs: [...programs],
    memo,
    logMessages: tx.meta?.logMessages ?? [],
  };
}

/** The Memo program logs the memo text: `Program log: Memo (len N): "..."`. */
export function extractMemoFromLogs(logMessages: string[] | null): string | null {
  if (!logMessages) return null;
  for (const line of logMessages) {
    const m = /Program log: Memo \(len \d+\): "(.*)"$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** Fetch a memo tx by signature and return the parsed AgentProof memo, if any. */
export async function fetchOnChainMemo(
  conn: Connection,
  memoSignature: string,
): Promise<{ actionId: string; hash: string } | null> {
  const tx = await conn.getTransaction(memoSignature, { maxSupportedTransactionVersion: 0 });
  if (!tx) return null;
  const memo = extractMemoFromLogs(tx.meta?.logMessages ?? null);
  if (!memo) return null;
  return parseMemoText(memo);
}
