# AgentProof — verification record (2026-11-06, ~11:20 IST)

## Test counts
- Backend unit: **47 passed, 0 failed** (`backend/`, vitest) + 6 integration tests **PASSED 2026-11-08 16:06 IST** (funded run, `RUN_INTEGRATION=1`, see Funding section below).
- Frontend unit: **11 passed, 0 failed** (`frontend/`, vitest).
- Builds: `npm run build` clean in both packages (only the pre-existing Vite chunk-size warning).
- Playwright E2E (`verification/e2e.py`, Python Playwright, Chromium headless): **16/16 passed**.
  Screenshots: `verification/shots/` (gitignored) — 01-home, 02-seeded-demo, 03-explainer,
  04-rejected, 05-audit, 06-settings.

## Verified live (real DevNet reads, slot ~519,280,xxx)
- `GET /api/health` → ok, demo wallet `HXSnG7ReevAVdWnnE676SajbAbJj6Q5st56sHLTth5mq`, balance 0 SOL.
- `GET/POST /api/limits` → caps read + updated (0.1 → 0.05 → back to 0.1 via API; 0.1 → 0.08 → 0.1 via UI).
- `POST /api/chat` balance → real 0 SOL; history → 0 txs; `explain_tx` on a real DevNet
  signature `3ZtjCX4J…nxv42E` → succeeded, fee 0.000005469 SOL, programs listed; fake sig → clean "not found" error.
- Transfer intent (0.05 SOL, Groq `openai/gpt-oss-120b` live) → explainer + NEW_PAYEE/FRESH_WALLET
  risk flags + base64 txPreview, `requiresConfirm: true`.
- Risky 5 SOL → `blocked: true`, LARGE_AMOUNT high flag, no txPreview, logged as `blocked`.
- Unknown intent → clarifying `unknown` response, no txPreview.
- `POST /api/reject` → `rejected`, record kept. `GET /api/actions` newest-first with all statuses.
- `POST /api/confirm` on the unfunded demo wallet → HTTP 400, record marked `failed`
  (insufficient funds: "Attempt to debit an account but found no record of a prior credit").
- `POST /api/verify/:id` on a non-executed record → `verified: false`, `onChainHash: null`.
- Seeded demo runner in the UI: balance shown, explainer built, cap-blocked step shown cleanly,
  failed confirm surfaced as an inline error (no crash).

## Bugs found and fixed (this session)
1. **Demo wallet toggle defaulted OFF on fresh browsers** (`frontend/src/App.tsx`):
   `localStorage.getItem('agentproof-demo') === '1'` is false when no preference is stored,
   so first-run chat transfers failed with "Connect a wallet or use demo mode". Fixed: no stored
   value now defaults to ON (a stored `'0'` still means off).
2. **Settings Save button was completely dead** (`frontend/src/pages/Settings.tsx`): the session-cap
   input had `step="0.05"` + `min="0.01"`, so valid values are 0.01/0.06/…/0.46/0.51 — the backend
   default 0.5 SOL is off-grid, the form failed HTML5 validation on load, and no submit event
   ever fired (silently). Fixed: session step `0.05` → `0.01`.
3. E2E script itself: audit status check is now case-insensitive (CSS `text-transform: capitalize`
   makes `inner_text()` return "Blocked"); Reject click scoped to the newest agent message
   (the first run false-passed by rejecting the demo's stale explainer card).

## Funding — FUNDED 2026-11-08 16:06 IST, funded path VERIFIED LIVE
- Faucet: https://faucet.solana.com, signed in with GitHub **eres45** (3.5 yrs old; eres0045 was rejected as too new earlier the same day). Airdrop **5 SOL** to the demo wallet, confirmed on-chain via `getBalance` (5,000,000,000 lamports, slot 519,992,871).
- `RUN_INTEGRATION=1 npx vitest run test/integration.test.ts` → **6/6 passed** (20.3s, real DevNet):
  - Risky 5 SOL instruction flagged AND cap-blocked, no txPreview.
  - Live **0.01 SOL demo transfer** end-to-end with on-chain receipt:
    transfer `SLx62ipDexPYFaW6V34peQ9eUq1QMT22sSmdaqKBHF2bTnTd7fWjSwYna14YR7yf8WG3MB2t3ns4BJHV3obNjse`
    (https://solscan.io/tx/SLx62ipDexPYFaW6V34peQ9eUq1QMT22sSmdaqKBHF2bTnTd7fWjSwYna14YR7yf8WG3MB2t3ns4BJHV3obNjse?cluster=devnet),
    memo receipt `2htb1Yt27HqRN54p9Y9knsrdzuZnDauNGnDfG7SZYuxgui5A2qnF8SM1mHRjvFMYSAyRdsZV7GTtrZksffcLNu4w`
    (https://solscan.io/tx/2htb1Yt27HqRN54p9Y9knsrdzuZnDauNGnDfG7SZYuxgui5A2qnF8SM1mHRjvFMYSAyRdsZV7GTtrZksffcLNu4w?cluster=devnet),
    `/api/verify` true on the real receipt and false on a tampered one.
  - APROOF SPL mint auto-created at server startup: `34GtKuVoxoLycCkZF7PULUJRH1aSfFyyaCBz33zV79K7` (1000 minted to demo wallet). Server reported balance 4.99742476 SOL at startup (5 SOL minus mint-creation fee).
- Earlier dead ends (kept for the record): `api.devnet.solana.com` RPC faucet 410 Gone; Helius no-key 401; Ankr 401; Alchemy demo key 429.

## Non-bugs noted
- The wallet-adapter CSS `@import`s DM Sans from fonts.googleapis.com; this VM's egress proxy
  blocks it (`ERR_TUNNEL_CONNECTION_FAILED` console error, graceful fallback to system fonts).
  Environmental, not an app defect; left as-is.

## Repo
https://github.com/eres0045/agentproof (public, pushed; 47 files; `backend/data/` gitignored and
verified absent from the commit; secret grep clean — no `gsk_`, no keypair JSON).

## Still open
- Phantom (non-demo) sign-and-confirm flow — untested, needs a Phantom wallet in a real browser.
- Demo video DONE + on YouTube (Unlisted, https://www.youtube.com/watch?v=fB7oH9m1Nko) + MLH Challenges submission in progress. Form closes Nov 8, 23:30 IST.
