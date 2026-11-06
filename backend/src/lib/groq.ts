import { PublicKey } from '@solana/web3.js';

/**
 * LLM layer (CONTRACT.md): Groq OpenAI-compatible endpoint,
 * model openai/gpt-oss-120b, temperature 0.2, descriptive User-Agent.
 * Two calls: (1) intent parse (response_format json_object, strictly
 * validated in code), (2) plain-English explanation.
 *
 * A deterministic regex parser is the fallback when the LLM is unavailable
 * or returns invalid JSON — the backend must stay usable on demo day and
 * must never burn Groq quota on retries. Groq usage in tests stays tiny:
 * unit tests mock fetch; integration tests use the fallback path unless a
 * key is present.
 */

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'openai/gpt-oss-120b';
export const USER_AGENT = 'AgentProof/1.0 (MLH Solana Hackathon demo; Node)';

export type Intent =
  | 'transfer_sol'
  | 'transfer_token'
  | 'balance'
  | 'history'
  | 'explain_tx'
  | 'unknown';

export const INTENTS: Intent[] = [
  'transfer_sol',
  'transfer_token',
  'balance',
  'history',
  'explain_tx',
  'unknown',
];

export interface ParsedIntent {
  intent: Intent;
  amountSol?: number;
  to?: string;
  signature?: string;
  question?: string;
}

/** Alias the LLM / user may use for the fixed server-side demo recipient. */
export const DEMO_RECIPIENT_ALIAS = 'demo-recipient';

type FetchFn = typeof fetch;

interface GroqOptions {
  apiKey?: string;
  fetchFn?: FetchFn;
}

const INTENT_SYSTEM_PROMPT = [
  'You parse a user message for a Solana wallet agent on DevNet.',
  'Reply with ONLY a JSON object, no other text, with keys:',
  'intent (one of: transfer_sol, transfer_token, balance, history, explain_tx, unknown),',
  'amountSol (number, the amount mentioned, else omit),',
  'to (a base58 Solana address from the message; if the message says Alice, demo, or demo recipient, use exactly "demo-recipient"; else omit),',
  'signature (a transaction signature from the message, else omit),',
  'question (a clarifying question if the intent is unclear, else omit).',
  'Rules: "send X SOL" is transfer_sol. "send X APROOF" or "send X tokens" is transfer_token.',
  '"balance", "how much do I have" is balance. "history", "past transactions", "recent transactions" is history.',
  '"explain this transaction" plus a signature is explain_tx. Anything else is unknown.',
].join(' ');

const BASE58_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const SIG_RE = /[1-9A-HJ-NP-Za-km-z]{87,88}/g;
const AMOUNT_SOL_RE = /(\d+(?:\.\d+)?)\s*sol\b/i;
const AMOUNT_TOKEN_RE = /(\d+(?:\.\d+)?)\s*(?:aproof|tokens?)\b/i;

export function isValidAddress(s: string): boolean {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

function extractAddress(message: string): string | undefined {
  for (const m of message.match(BASE58_RE) ?? []) {
    if (isValidAddress(m)) return m;
  }
  return undefined;
}

function extractSignature(message: string): string | undefined {
  for (const m of message.match(SIG_RE) ?? []) {
    // A signature is 87-88 base58 chars; an address match is shorter, so a
    // hit here is a signature, not a wallet address.
    if (m.length >= 87) return m;
  }
  return undefined;
}

/**
 * Deterministic intent parser (regex + keywords). Used as the fallback when
 * the LLM is unavailable, and as a cross-check that fills in amounts and
 * addresses the LLM may have missed.
 */
export function deterministicParse(message: string): ParsedIntent {
  const lower = message.toLowerCase();
  const amountSol = AMOUNT_SOL_RE.exec(message)?.[1];
  const amountToken = AMOUNT_TOKEN_RE.exec(message)?.[1];
  const address = extractAddress(message);
  const signature = extractSignature(message);
  const mentionsDemoRecipient = /\b(alice|demo recipient|demo wallet)\b/i.test(message);

  const to = address ?? (mentionsDemoRecipient ? DEMO_RECIPIENT_ALIAS : undefined);

  if (/\b(send|transfer|pay|give)\b/.test(lower)) {
    if (amountToken !== undefined || /\baproof\b/.test(lower)) {
      return { intent: 'transfer_token', amountSol: amountToken ? Number(amountToken) : undefined, to };
    }
    return { intent: 'transfer_sol', amountSol: amountSol ? Number(amountSol) : undefined, to };
  }
  if (/\b(balance|how much (do i|have)|my sol)\b/.test(lower)) {
    return { intent: 'balance' };
  }
  if (/\b(history|past transactions|recent transactions|my transactions|activity)\b/.test(lower)) {
    return { intent: 'history' };
  }
  if (/\b(explain|what (is|was)|decode|details (of|for)|show).{0,40}(transaction|tx|signature)\b/.test(lower) || (/\bexplain\b/.test(lower) && signature)) {
    return { intent: 'explain_tx', signature };
  }
  if (signature) return { intent: 'explain_tx', signature };
  return {
    intent: 'unknown',
    question: 'What would you like to do? I can send SOL or APROOF tokens, check a balance, show recent transactions, or explain a transaction signature.',
  };
}

/** Strict validation of LLM JSON — never trust raw LLM output. */
export function validateParsedIntent(raw: unknown): ParsedIntent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.intent !== 'string' || !(INTENTS as string[]).includes(o.intent)) return null;
  const out: ParsedIntent = { intent: o.intent as Intent };
  if (typeof o.amountSol === 'number' && Number.isFinite(o.amountSol) && o.amountSol > 0) {
    out.amountSol = o.amountSol;
  }
  if (typeof o.to === 'string') {
    if (o.to === DEMO_RECIPIENT_ALIAS || isValidAddress(o.to)) out.to = o.to;
  }
  if (typeof o.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(o.signature)) {
    out.signature = o.signature;
  }
  if (typeof o.question === 'string' && o.question.length > 0) out.question = o.question;
  return out;
}

async function groqChat(
  apiKey: string,
  messages: { role: string; content: string }[],
  opts: { jsonMode: boolean; fetchFn: FetchFn },
): Promise<string> {
  const res = await opts.fetchFn(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages,
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('Groq returned an empty completion');
  }
  return content;
}

/** LLM intent parse, with deterministic fallback. Never throws. */
export async function parseIntent(message: string, opts: GroqOptions = {}): Promise<ParsedIntent> {
  const fallback = deterministicParse(message);
  const apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[groq] no GROQ_API_KEY — using deterministic intent parse');
    return fallback;
  }
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const content = await groqChat(
      apiKey,
      [
        { role: 'system', content: INTENT_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      { jsonMode: true, fetchFn },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[groq] intent JSON parse failed, using deterministic fallback');
      return fallback;
    }
    const valid = validateParsedIntent(parsed);
    if (!valid) {
      console.warn('[groq] intent JSON failed validation, using deterministic fallback');
      return fallback;
    }
    // Fill gaps deterministically: regex extraction of amounts/addresses is
    // more reliable than the LLM for exact values.
    if (valid.intent === 'transfer_sol' || valid.intent === 'transfer_token') {
      if (valid.amountSol === undefined && fallback.amountSol !== undefined) valid.amountSol = fallback.amountSol;
      if (valid.to === undefined && fallback.to !== undefined) valid.to = fallback.to;
    }
    if (valid.intent === 'explain_tx' && valid.signature === undefined && fallback.signature) {
      valid.signature = fallback.signature;
    }
    return valid;
  } catch (err) {
    console.warn('[groq] intent parse failed, using deterministic fallback:', (err as Error).message);
    return fallback;
  }
}

export interface ExplainFacts {
  intent: string;
  amountSol?: number;
  tokenAmount?: number;
  to?: string;
  from?: string;
  riskFlags: { code: string; severity: string; detail: string }[];
  perTxCapSol: number;
  sessionCapSol: number;
  sessionSpentSol: number;
}

/** LLM plain-English explanation of a built transaction. Falls back to a template. */
export async function explainAction(facts: ExplainFacts, opts: GroqOptions = {}): Promise<string> {
  const template = templateExplanation(facts);
  const apiKey = opts.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) return template;
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const what = facts.intent === 'transfer_token'
      ? `send ${facts.tokenAmount} APROOF test tokens`
      : `send ${facts.amountSol} SOL`;
    const content = await groqChat(
      apiKey,
      [
        {
          role: 'system',
          content:
            'You explain a Solana DevNet transaction to a non-technical user in 3 short sentences max. ' +
            'Plain English, no jargon. State what happens, what it costs (tiny DevNet fee), and any risk. ' +
            'Never invent amounts, addresses, or guarantees.',
        },
        {
          role: 'user',
          content:
            `Explain this pending transaction: the user will ${what} from ${facts.from ?? 'their wallet'} ` +
            `to ${facts.to}. Per-transaction cap ${facts.perTxCapSol} SOL, session cap ${facts.sessionCapSol} SOL, ` +
            `${facts.sessionSpentSol} SOL spent this session. Risk flags: ${JSON.stringify(facts.riskFlags)}.`,
        },
      ],
      { jsonMode: false, fetchFn },
    );
    return content.trim();
  } catch (err) {
    console.warn('[groq] explanation failed, using template:', (err as Error).message);
    return template;
  }
}

export function templateExplanation(facts: ExplainFacts): string {
  const what = facts.intent === 'transfer_token'
    ? `${facts.tokenAmount} APROOF test tokens`
    : `${facts.amountSol} SOL`;
  const risks = facts.riskFlags.length
    ? ` Watch out: ${facts.riskFlags.map((f) => f.detail).join(' ')}`
    : ' No risk flags were raised.';
  return (
    `Plain-English breakdown: you send ${what} to ${facts.to}. ` +
    `This is on Solana DevNet (play money, not real SOL) and costs only a tiny network fee. ` +
    `Nothing moves until you press Confirm.${risks}`
  );
}
