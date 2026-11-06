import { createHash } from 'node:crypto';

/**
 * Receipt memo format (CONTRACT.md):
 *   `AgentProof v1 | action:<id> | sha256:<hex>`
 * where hex = sha256 of the canonical record JSON:
 *   JSON.stringify({id, intent, summary, amountSol, to, signature, createdAt})
 * with keys in exactly that order. `undefined` fields are omitted by
 * JSON.stringify — the same construction is used at write and verify time,
 * so the hash is stable.
 */

export interface CanonicalRecordFields {
  id: string;
  intent: string;
  summary: string;
  amountSol?: number;
  to?: string;
  signature?: string;
  createdAt: string;
}

export function canonicalRecordJson(fields: CanonicalRecordFields): string {
  return JSON.stringify({
    id: fields.id,
    intent: fields.intent,
    summary: fields.summary,
    amountSol: fields.amountSol,
    to: fields.to,
    signature: fields.signature,
    createdAt: fields.createdAt,
  });
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function receiptHashFor(fields: CanonicalRecordFields): string {
  return sha256Hex(canonicalRecordJson(fields));
}

export function memoTextFor(id: string, hashHex: string): string {
  return `AgentProof v1 | action:${id} | sha256:${hashHex}`;
}

const MEMO_RE = /AgentProof v1 \| action:([A-Za-z0-9_-]+) \| sha256:([0-9a-f]{64})/;

/** Parse an AgentProof memo string into its action id and hash, or null. */
export function parseMemoText(memo: string): { actionId: string; hash: string } | null {
  const m = MEMO_RE.exec(memo);
  if (!m) return null;
  return { actionId: m[1], hash: m[2] };
}
