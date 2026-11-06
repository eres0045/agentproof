# AgentProof — backend ↔ frontend API contract (both sides MUST follow this exactly)

Backend: Node + TypeScript + Express, port 4000. Frontend: React + Vite + TypeScript.
All amounts in SOL (numbers) unless stated. All IDs are short strings (e.g. `act_xxxx`).
Every response is JSON. Errors: `{error: "message"}` with an HTTP 4xx/5xx status.

## Money rules

- DevNet ONLY. Demo amounts 0.01–0.1 SOL. Never mainnet.
- Default caps: per-transaction 0.1 SOL, session 0.5 SOL. Caps enforced in the backend.
- No Jupiter swaps. Transfers + lookups + explainer only.

## Endpoints

### GET /api/health
→ `{ok: true, slot: <number>, demoWallet: "<base58>", demoBalanceSol: <number>}`

### POST /api/chat
Body: `{message: string, wallet?: string, demo?: boolean}`
- `wallet`: the user's Phantom pubkey (base58) when connected; omit in demo mode.
- `demo`: true = use the server demo wallet (server-held DevNet keypair) for signing.
- The LLM parses intent. Response (transfer intent, not yet executed):
```json
{
  "actionId": "act_xxx",
  "intent": "transfer_sol",
  "summary": "Send 0.05 SOL to 9x...AbC",
  "explanation": "Plain-English breakdown: you send 0.05 SOL ...",
  "riskFlags": [{"code": "NEW_PAYEE", "severity": "medium", "detail": "..."}],
  "txPreview": "<base64 unsigned serialized transaction>",
  "requiresConfirm": true,
  "amountSol": 0.05,
  "to": "<base58>",
  "blocked": false
}
```
- Read-only intents (`balance`, `history`, `explain_tx`) execute immediately and
  return `{actionId, intent, summary, result: {...}, requiresConfirm: false}` and
  are also written to the action log (no receipt memo needed for pure reads,
  but log the record).
- If a transfer exceeds a cap, return `{blocked: true, blockReason: "..."}` with
  HTTP 200 and NO txPreview. Log it as status `blocked`.
- If intent is unclear, return `{intent: "unknown", summary: "...", requiresConfirm: false}`
  with a clarifying question in `summary`. No txPreview.

### POST /api/confirm
Body: `{actionId: string, signedTx?: string}`
- If `signedTx` (base64) is present: backend sends it to DevNet.
- Else if the action was created with `demo: true`: backend signs with the demo
  keypair and sends.
- Else: 400 `{error: "no signature provided"}`.
- On success: `{actionId, status: "executed", signature: "<tx sig>", memoSignature: "<memo tx sig>", solscan: {...}}`.
  The backend MUST write the receipt memo tx AFTER the transfer confirms, then
  update the record. `solscan: {tx: "https://solscan.io/tx/<sig>?cluster=devnet", memo: "https://solscan.io/tx/<memoSig>?cluster=devnet"}`.

### POST /api/reject
Body: `{actionId: string}` → `{actionId, status: "rejected"}`. Record is kept.

### GET /api/actions
→ `{actions: [ {id, intent, summary, status, amountSol?, to?, signature?, memoSignature?, receiptHash?, createdAt} ]}` newest first.
Status values: `pending` | `executed` | `rejected` | `blocked` | `failed`.

### GET /api/actions/:id
→ full record including `explanation`, `riskFlags`, `receiptHash`, `recordJson`.

### POST /api/verify/:id
Recomputes sha256 of the stored canonical record JSON, fetches the memo tx from
DevNet, extracts the memo, compares. → `{verified: true|false, expectedHash, onChainHash, memoSignature}`.
Tampered records must verify FALSE.

### GET /api/limits  /  POST /api/limits
GET → `{perTxCapSol: 0.1, sessionCapSol: 0.5, sessionSpentSol: <number>}`.
POST `{perTxCapSol?, sessionCapSol?}` → updated limits (perTxCapSol must be ≤ 1).

### GET /api/demo/seed
→ `{commands: [{label, message}, ...]}` — the three seeded demo commands:
1. balance check, 2. transfer 0.05 SOL with explainer, 3. risky instruction
   (send 5 SOL to a fresh address) that must be flagged AND cap-blocked.
Also ensures the demo wallet is funded (backend airdrops via DevNet faucet if
balance < 0.2 SOL). Response includes `{demoWallet, demoBalanceSol}`.

## Receipt memo format

Memo text: `AgentProof v1 | action:<id> | sha256:<hex>` where hex = sha256 of the
canonical record JSON: `JSON.stringify({id, intent, summary, amountSol, to, signature, createdAt})`
with keys in exactly that order. `receiptHash` stored on the record is that hex.

## LLM usage (backend only)

- Model `openai/gpt-oss-120b` via `https://api.groq.com/openai/v1/chat/completions`,
  `Authorization: Bearer <process.env.GROQ_API_KEY>`, descriptive User-Agent.
  Keep prompts short; temperature 0.2; force JSON output for intent parsing
  (use response_format json_object) and validate it — never trust raw LLM JSON.
- Two LLM calls: (1) intent parse → strict JSON `{intent, amountSol?, to?, signature?, question?}`;
  (2) plain-English explanation of the built transaction (given parsed tx facts).
- Deterministic risk rules run in code, NOT in the LLM: NEW_PAYEE (payee never
  seen in this session), LARGE_AMOUNT (≥ perTxCap), UNKNOWN_PROGRAM (tx touches
  a program id outside the known set: System, Token, Memo), ROUND_NUMBER? (no —
  keep the three above plus FRESH_WALLET for a payee with no prior txs).
- Groq key: NEVER in the repo. Backend reads `process.env.GROQ_API_KEY`.
  Launcher `backend/scripts/run-backend.py` fetches a surrogate from authd
  (see /opt/muse/skills/custom-connector-setup/bin/dynamic_credentials.py,
  `dynamic_credential_entry('custom.groq')`) and spawns node with it in env.
  Do NOT print the key/surrogate anywhere.

## State

Backend stores records in `backend/data/db.json` (gitignored JSON file, atomic
writes). Demo keypair in `backend/data/demo-keypair.json` (gitignored, generated
on first run if missing). SPL test token: backend creates its own mint on first
run ("APROOF" test token), mints 1000 to the demo wallet; mint address stored
in db.json. Do NOT depend on any third-party DevNet USDC mint.
