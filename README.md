# AgentProof — an AI agent that acts on Solana, explains itself before you sign, and proves what it did after

MLH Solana Hackathon (AI track), Nov 6–8, 2026. Online, DevNet only.

> Status: built and verified end to end. Backend 47 unit tests, frontend 11
> tests, Playwright E2E 16/16 green — see `verification/`.
> **Funded 2026-11-08: demo wallet holds 5 SOL on DevNet (via the Solana
> faucet); funded integration tests 6/6 green — live 0.01 SOL transfer,
> on-chain memo receipt, `/api/verify` true on the real receipt and false on
> a tampered one, and the risky 5 SOL instruction cap-blocked as designed.**
> See `shared/CONTRACT.md` for the backend↔frontend API contract.

## What it is

Chat with an AI agent that executes real Solana actions on DevNet — SOL transfers,
SPL token transfers, balance/history lookups, and explaining any transaction
signature. Before anything is signed, the agent shows a plain-English
explanation plus deterministic risk flags, and you Confirm or Reject.
Every executed action is receipted on-chain with a Memo transaction, and
anyone can verify the receipt hash against the stored record.

## Why Solana only

Sub-cent fees make one memo receipt per action affordable, and fast finality
makes the demo instant. This would be impractical on a chain where each
receipt costs dollars and minutes.

## Trust boundaries (honest)

- The pre-sign explainer is advisory, not a guarantee — it can miss a risk.
- Spending caps are enforced in the backend (off-chain). The receipt log is
  on-chain and verifiable.
- The demo wallet is a server-held DevNet keypair holding demo SOL only.
  A production version would use an on-chain escrow program or multisig.

## Run it

```bash
# backend (needs GROQ_API_KEY for the LLM; see backend/.env.example)
cd backend && npm install && npm run dev
# frontend
cd frontend && npm install && npm run dev
```

Demo: open the app, press "Run seeded demo" — three scripted commands run the
wow path (balance → transfer with explainer + confirm + receipt → risky
instruction blocked by the cap).

## How it differs from The Hive / Solana Agent Kit

The Hive proved the NL-to-transaction chatbot ($60k, Jan 2025) and Agent Kit
ships the actions as a toolkit. AgentProof builds on that base: it adds the
pre-sign security explanation and the verifiable on-chain receipt log — the
two things the chatbot alone does not do.
