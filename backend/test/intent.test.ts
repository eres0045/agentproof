import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  deterministicParse,
  explainAction,
  parseIntent,
  validateParsedIntent,
} from '../src/lib/groq';

function mockFetch(jsonBody: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => jsonBody,
    text: async () => (typeof jsonBody === 'string' ? jsonBody : JSON.stringify(jsonBody)),
  })) as unknown as typeof fetch;
}

const GROQ_OK = {
  choices: [{ message: { content: '{"intent":"transfer_sol","amountSol":0.05,"to":"demo-recipient"}' } }],
};

describe('deterministicParse (LLM fallback)', () => {
  it('parses "send 0.05 SOL to Alice" as a demo-recipient transfer', () => {
    const p = deterministicParse('Send 0.05 SOL to Alice');
    expect(p.intent).toBe('transfer_sol');
    expect(p.amountSol).toBe(0.05);
    expect(p.to).toBe('demo-recipient');
  });

  it('parses a base58 address from the message', () => {
    const addr = Keypair.generate().publicKey.toBase58();
    const p = deterministicParse(`send 1.5 SOL to ${addr} please`);
    expect(p.intent).toBe('transfer_sol');
    expect(p.amountSol).toBe(1.5);
    expect(p.to).toBe(addr);
  });

  it('parses APROOF token transfers', () => {
    const p = deterministicParse('Send 10 APROOF to Alice');
    expect(p.intent).toBe('transfer_token');
    expect(p.amountSol).toBe(10);
    expect(p.to).toBe('demo-recipient');
  });

  it('parses balance / history / explain_tx', () => {
    expect(deterministicParse('What is the balance of the demo wallet?').intent).toBe('balance');
    expect(deterministicParse('show my recent transactions').intent).toBe('history');
    const sig = '5'.repeat(87);
    const p = deterministicParse(`explain this transaction ${sig}`);
    expect(p.intent).toBe('explain_tx');
    expect(p.signature).toBe(sig);
  });

  it('returns unknown with a clarifying question for gibberish', () => {
    const p = deterministicParse('hello there, nice weather');
    expect(p.intent).toBe('unknown');
    expect(p.question).toBeTruthy();
  });

  it('transfer without an amount keeps the intent but no amount', () => {
    const p = deterministicParse('send SOL to Alice');
    expect(p.intent).toBe('transfer_sol');
    expect(p.amountSol).toBeUndefined();
  });
});

describe('validateParsedIntent', () => {
  it('accepts a well-formed LLM object', () => {
    expect(
      validateParsedIntent({ intent: 'balance' }),
    ).toEqual({ intent: 'balance' });
    expect(
      validateParsedIntent({ intent: 'transfer_sol', amountSol: 0.05, to: 'demo-recipient' }),
    ).toEqual({ intent: 'transfer_sol', amountSol: 0.05, to: 'demo-recipient' });
  });

  it('rejects unknown intents, bad amounts, bad addresses', () => {
    expect(validateParsedIntent({ intent: 'buy_lambo' })).toBeNull();
    expect(validateParsedIntent({ intent: 'transfer_sol', amountSol: -1 })).toEqual({ intent: 'transfer_sol' });
    expect(validateParsedIntent({ intent: 'transfer_sol', amountSol: 0.05, to: 'not-an-address!!!' })).toEqual({
      intent: 'transfer_sol',
      amountSol: 0.05,
    });
    expect(validateParsedIntent('just a string')).toBeNull();
    expect(validateParsedIntent(null)).toBeNull();
  });
});

describe('parseIntent (mocked Groq)', () => {
  it('uses the LLM result when valid', async () => {
    const p = await parseIntent('Send 0.05 SOL to Alice', {
      apiKey: 'test-key',
      fetchFn: mockFetch(GROQ_OK),
    });
    expect(p.intent).toBe('transfer_sol');
    expect(p.amountSol).toBe(0.05);
    expect(p.to).toBe('demo-recipient');
  });

  it('falls back to deterministic parse when Groq returns invalid JSON', async () => {
    const bad = { choices: [{ message: { content: 'not json at all' } }] };
    const p = await parseIntent('Send 0.05 SOL to Alice', {
      apiKey: 'test-key',
      fetchFn: mockFetch(bad),
    });
    expect(p.intent).toBe('transfer_sol');
    expect(p.amountSol).toBe(0.05);
  });

  it('falls back to deterministic parse on Groq HTTP error', async () => {
    const p = await parseIntent('What is my balance?', {
      apiKey: 'test-key',
      fetchFn: mockFetch({ error: 'rate limited' }, false, 429),
    });
    expect(p.intent).toBe('balance');
  });

  it('returns intent "unknown" (via fallback) when nothing parses, even with a key', async () => {
    const p = await parseIntent('blorp glorp', {
      apiKey: 'test-key',
      fetchFn: mockFetch({ choices: [{ message: { content: '{"intent":"unknown"}' } }] }),
    });
    expect(p.intent).toBe('unknown');
  });

  it('uses deterministic parse with no API key (no network call)', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      throw new Error('must not be called');
    }) as unknown as typeof fetch;
    const p = await parseIntent('Send 0.05 SOL to Alice', { apiKey: undefined, fetchFn: spy });
    expect(called).toBe(false);
    expect(p.intent).toBe('transfer_sol');
  });
});

describe('explainAction', () => {
  it('returns a template explanation with no API key (no network call)', async () => {
    const text = await explainAction({
      intent: 'transfer_sol',
      amountSol: 0.05,
      to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVZRde1',
      riskFlags: [],
      perTxCapSol: 0.1,
      sessionCapSol: 0.5,
      sessionSpentSol: 0,
    });
    expect(text).toContain('0.05 SOL');
    expect(text).toContain('Confirm');
  });

  it('uses the LLM explanation when Groq answers', async () => {
    const text = await explainAction(
      {
        intent: 'transfer_sol',
        amountSol: 0.05,
        to: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVZRde1',
        riskFlags: [],
        perTxCapSol: 0.1,
        sessionCapSol: 0.5,
        sessionSpentSol: 0,
      },
      {
        apiKey: 'test-key',
        fetchFn: mockFetch({ choices: [{ message: { content: 'You send a tiny amount on DevNet.' } }] }),
      },
    );
    expect(text).toBe('You send a tiny amount on DevNet.');
  });
});
