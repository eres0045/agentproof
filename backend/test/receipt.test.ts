import { describe, expect, it } from 'vitest';
import {
  canonicalRecordJson,
  memoTextFor,
  parseMemoText,
  receiptHashFor,
  sha256Hex,
} from '../src/lib/receipt';

const FIELDS = {
  id: 'act_abcdef01',
  intent: 'transfer_sol',
  summary: 'Send 0.05 SOL to 9WzD...de1',
  amountSol: 0.05,
  to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVZRde1',
  signature: '5'.repeat(87),
  createdAt: '2026-11-06T10:00:00.000Z',
};

describe('receipt memo hash', () => {
  it('canonical JSON has keys in contract order', () => {
    const json = canonicalRecordJson(FIELDS);
    expect(json).toBe(
      '{"id":"act_abcdef01","intent":"transfer_sol","summary":"Send 0.05 SOL to 9WzD...de1",' +
        '"amountSol":0.05,"to":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVZRde1",' +
        `"signature":"${'5'.repeat(87)}","createdAt":"2026-11-06T10:00:00.000Z"}`,
    );
    // Key order check via index positions.
    const order = ['"id"', '"intent"', '"summary"', '"amountSol"', '"to"', '"signature"', '"createdAt"'];
    let last = -1;
    for (const k of order) {
      const i = json.indexOf(k);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
  });

  it('hash is a stable 64-hex sha256 of the canonical JSON', () => {
    const h1 = receiptHashFor(FIELDS);
    const h2 = receiptHashFor(FIELDS);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(sha256Hex(canonicalRecordJson(FIELDS)));
  });

  it('any field change changes the hash (tamper detection)', () => {
    const base = receiptHashFor(FIELDS);
    expect(receiptHashFor({ ...FIELDS, summary: 'Send 0.05 SOL to 9WzD...de1 TAMPERED' })).not.toBe(base);
    expect(receiptHashFor({ ...FIELDS, amountSol: 0.06 })).not.toBe(base);
    expect(receiptHashFor({ ...FIELDS, signature: '6'.repeat(87) })).not.toBe(base);
  });

  it('memo text round-trips through the parser', () => {
    const hash = receiptHashFor(FIELDS);
    const memo = memoTextFor(FIELDS.id, hash);
    expect(memo).toBe(`AgentProof v1 | action:${FIELDS.id} | sha256:${hash}`);
    expect(parseMemoText(memo)).toEqual({ actionId: FIELDS.id, hash });
  });

  it('parser rejects non-AgentProof memos', () => {
    expect(parseMemoText('hello world')).toBeNull();
    expect(parseMemoText('AgentProof v1 | action:act_x | sha256:zzzz')).toBeNull();
  });

  it('undefined optional fields are omitted, consistently', () => {
    const json = canonicalRecordJson({
      id: 'act_1', intent: 'balance', summary: 'Balance: 1 SOL', createdAt: '2026-11-06T10:00:00.000Z',
    });
    expect(json).toBe('{"id":"act_1","intent":"balance","summary":"Balance: 1 SOL","createdAt":"2026-11-06T10:00:00.000Z"}');
    expect(receiptHashFor({
      id: 'act_1', intent: 'balance', summary: 'Balance: 1 SOL', createdAt: '2026-11-06T10:00:00.000Z',
    })).toBe(sha256Hex(json));
  });
});
