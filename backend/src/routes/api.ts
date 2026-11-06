import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  APROOF_DECIMALS,
  buildMemoTransaction,
  buildSolTransfer,
  buildTokenTransfer,
  deserializeSignedTx,
  explainTransaction,
  fetchOnChainMemo,
  getBalanceSol,
  getHistory,
  getPayeeTxCount,
  getSlot,
  programIdsOf,
  sendAndConfirm,
  serializeSigned,
} from '../lib/solana';
import { DEMO_RECIPIENT_ALIAS, explainAction, isValidAddress, parseIntent } from '../lib/groq';
import { checkCaps } from '../lib/caps';
import { evaluateRiskFlags, shortAddr } from '../lib/risks';
import { canonicalRecordJson, memoTextFor, receiptHashFor } from '../lib/receipt';
import { ensureFunded, ensureMint, getDemoKeypair, getDemoRecipientPubkey } from '../lib/demoWallet';
import { Store, type ActionRecord } from '../lib/store';

export interface ApiContext {
  conn: Connection;
  store: Store;
}

const SOLSCAN_TX = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;

function newActionId(): string {
  return `act_${randomBytes(4).toString('hex')}`;
}

/** Express 5 types req.params values as string | string[] — normalise. */
function paramId(req: Request): string {
  const v = req.params.id;
  return Array.isArray(v) ? v[0] : v;
}

function publicSummary(rec: ActionRecord): Record<string, unknown> {
  return {
    id: rec.id,
    intent: rec.intent,
    summary: rec.summary,
    status: rec.status,
    amountSol: rec.amountSol,
    to: rec.to,
    signature: rec.signature,
    memoSignature: rec.memoSignature,
    receiptHash: rec.receiptHash,
    createdAt: rec.createdAt,
  };
}

export function registerApiRoutes(app: Express, ctx: ApiContext): void {
  const { conn, store } = ctx;

  // GET /api/health
  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      const demoWallet = getDemoKeypair().publicKey;
      const [slot, demoBalanceSol] = await Promise.all([
        getSlot(conn),
        getBalanceSol(conn, demoWallet),
      ]);
      res.json({ ok: true, slot, demoWallet: demoWallet.toBase58(), demoBalanceSol });
    } catch (err) {
      res.status(503).json({ error: `DevNet unreachable: ${(err as Error).message}` });
    }
  });

  // POST /api/chat
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { message, wallet, demo } = (req.body ?? {}) as {
      message?: unknown;
      wallet?: unknown;
      demo?: unknown;
    };
    if (typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const demoMode = demo === true;
    const userWallet = typeof wallet === 'string' && isValidAddress(wallet) ? wallet : undefined;

    try {
      const parsed = await parseIntent(message);
      const createdAt = new Date().toISOString();
      const id = newActionId();

      // ---- Read-only intents: execute immediately, log, no receipt memo. ----
      if (parsed.intent === 'balance' || parsed.intent === 'history' || parsed.intent === 'explain_tx') {
        const record: ActionRecord = {
          id, intent: parsed.intent, summary: '', status: 'executed', createdAt,
          demo: demoMode, wallet: userWallet,
        };
        try {
          if (parsed.intent === 'balance') {
            const address = new PublicKey(userWallet ?? getDemoKeypair().publicKey.toBase58());
            const balanceSol = await getBalanceSol(conn, address);
            record.summary = `Balance of ${shortAddr(address.toBase58())}: ${balanceSol} SOL`;
            record.result = { address: address.toBase58(), balanceSol, balanceLamports: Math.round(balanceSol * LAMPORTS_PER_SOL) };
          } else if (parsed.intent === 'history') {
            const address = new PublicKey(userWallet ?? getDemoKeypair().publicKey.toBase58());
            const transactions = await getHistory(conn, address, 10);
            record.summary = `${transactions.length} recent transaction(s) for ${shortAddr(address.toBase58())}`;
            record.result = { address: address.toBase58(), count: transactions.length, transactions };
          } else {
            if (!parsed.signature) {
              res.json({
                intent: 'unknown',
                summary: 'Which transaction should I explain? Paste a transaction signature.',
                requiresConfirm: false,
              });
              return;
            }
            const explained = await explainTransaction(conn, parsed.signature);
            record.summary = `Transaction ${shortAddr(parsed.signature)}: ${explained.success ? 'succeeded' : 'failed'}, fee ${explained.feeSol} SOL`;
            record.result = explained;
            record.explanation =
              `This transaction ${explained.success ? 'succeeded' : 'failed on-chain'} ` +
              `(slot ${explained.slot}, fee ${explained.feeSol} SOL). ` +
              `Programs involved: ${explained.programs.join(', ') || 'none'}.` +
              (explained.memo ? ` Memo: "${explained.memo}".` : '');
          }
        } catch (err) {
          record.status = 'failed';
          record.summary = `Lookup failed: ${(err as Error).message}`;
          store.upsert(record);
          res.status(502).json({ error: record.summary });
          return;
        }
        store.upsert(record);
        res.json({
          actionId: id, intent: record.intent, summary: record.summary,
          explanation: record.explanation, result: record.result, requiresConfirm: false,
        });
        return;
      }

      // ---- Unknown intent ----
      if (parsed.intent === 'unknown') {
        res.json({
          intent: 'unknown',
          summary: parsed.question ?? 'I could not understand that. Try asking me to send SOL, check a balance, show history, or explain a transaction.',
          requiresConfirm: false,
        });
        return;
      }

      // ---- Transfer intents ----
      const isToken = parsed.intent === 'transfer_token';
      const amount = parsed.amountSol;
      let toAddress: string | undefined;
      if (parsed.to === DEMO_RECIPIENT_ALIAS) {
        toAddress = getDemoRecipientPubkey().toBase58();
      } else if (parsed.to && isValidAddress(parsed.to)) {
        toAddress = parsed.to;
      }
      if (amount === undefined || !toAddress) {
        const missing = amount === undefined ? 'how much' : 'who to send it to';
        res.json({
          intent: 'unknown',
          summary: `Almost there — I need to know ${missing}. For example: "Send 0.05 SOL to Alice".`,
          requiresConfirm: false,
        });
        return;
      }

      const amountSol = isToken ? undefined : amount;
      const tokenAmount = isToken ? amount : undefined;
      const sender = demoMode
        ? getDemoKeypair().publicKey
        : userWallet
          ? new PublicKey(userWallet)
          : null;
      if (!sender) {
        res.status(400).json({ error: 'Connect a wallet or use demo mode to send a transfer.' });
        return;
      }

      const limits = store.getLimits();
      const sessionSpent = store.sessionSpentSol();

      // Build the unsigned transaction (needed for preview + program ids).
      let tx: Transaction;
      let mint: string | undefined;
      if (isToken) {
        const mintRes = await ensureMint(conn, getDemoKeypair(), store.getMint());
        if (!mintRes.mint) {
          res.status(502).json({ error: mintRes.error ?? 'APROOF mint unavailable' });
          return;
        }
        mint = mintRes.mint;
        if (mintRes.created) store.setMint(mint);
        const built = await buildTokenTransfer(
          conn, sender, new PublicKey(mint), sender, new PublicKey(toAddress),
          Math.round(amount * 10 ** APROOF_DECIMALS),
        );
        tx = built.tx;
      } else {
        tx = await buildSolTransfer(conn, sender, new PublicKey(toAddress), Math.round(amount * LAMPORTS_PER_SOL));
      }

      // Deterministic risk flags (code, not LLM).
      const payeeTxCount = await getPayeeTxCount(conn, new PublicKey(toAddress));
      const riskFlags = evaluateRiskFlags({
        amountSol,
        to: toAddress,
        perTxCap: limits.perTxCapSol,
        seenPayees: store.seenPayees(),
        payeeTxCount,
        programIds: programIdsOf(tx),
      });

      // Caps: blocked transfers get NO txPreview and are logged as blocked.
      const capCheck = checkCaps({
        amountSol,
        perTxCapSol: limits.perTxCapSol,
        sessionCapSol: limits.sessionCapSol,
        sessionSpentSol: sessionSpent,
      });
      const unit = isToken ? 'APROOF' : 'SOL';
      const summary = `Send ${amount} ${unit} to ${shortAddr(toAddress)}`;
      if (capCheck.blocked) {
        const record: ActionRecord = {
          id, intent: parsed.intent, summary, riskFlags, amountSol, tokenAmount, mint,
          to: toAddress, status: 'blocked', createdAt, demo: demoMode, wallet: userWallet,
          blockReason: capCheck.blockReason,
        };
        store.upsert(record);
        res.json({
          actionId: id, intent: parsed.intent, summary, riskFlags,
          blocked: true, blockReason: capCheck.blockReason, requiresConfirm: false,
          amountSol, to: toAddress,
        });
        return;
      }

      const txPreview = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
      const explanation = await explainAction({
        intent: parsed.intent, amountSol, tokenAmount, to: toAddress,
        from: sender.toBase58(), riskFlags,
        perTxCapSol: limits.perTxCapSol, sessionCapSol: limits.sessionCapSol, sessionSpentSol: sessionSpent,
      });
      const record: ActionRecord = {
        id, intent: parsed.intent, summary, explanation, riskFlags,
        amountSol, tokenAmount, mint, to: toAddress, status: 'pending',
        createdAt, demo: demoMode, wallet: userWallet,
      };
      store.upsert(record);
      res.json({
        actionId: id, intent: parsed.intent, summary, explanation, riskFlags,
        txPreview, requiresConfirm: true, amountSol, to: toAddress, blocked: false,
      });
    } catch (err) {
      console.error('[chat] error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/confirm
  app.post('/api/confirm', async (req: Request, res: Response) => {
    const { actionId, signedTx } = (req.body ?? {}) as { actionId?: unknown; signedTx?: unknown };
    if (typeof actionId !== 'string') {
      res.status(400).json({ error: 'actionId is required' });
      return;
    }
    const record = store.get(actionId);
    if (!record) {
      res.status(404).json({ error: `unknown action ${actionId}` });
      return;
    }
    if (record.status !== 'pending') {
      res.status(400).json({ error: `action is ${record.status}, cannot confirm` });
      return;
    }
    if (!record.to) {
      res.status(400).json({ error: 'action has no destination' });
      return;
    }
    try {
      let signature: string;
      if (typeof signedTx === 'string' && signedTx.length > 0) {
        const tx = deserializeSignedTx(signedTx);
        signature = await sendAndConfirm(conn, serializeSigned(tx));
      } else if (record.demo) {
        // Demo path: server signs with the demo keypair and sends.
        const demoKeypair = getDemoKeypair();
        let tx: Transaction;
        if (record.intent === 'transfer_token') {
          if (!record.mint || record.tokenAmount === undefined) {
            throw new Error('token transfer record is missing mint/amount');
          }
          const built = await buildTokenTransfer(
            conn, demoKeypair.publicKey, new PublicKey(record.mint),
            demoKeypair.publicKey, new PublicKey(record.to),
            Math.round(record.tokenAmount * 10 ** APROOF_DECIMALS),
          );
          tx = built.tx;
        } else {
          tx = await buildSolTransfer(
            conn, demoKeypair.publicKey, new PublicKey(record.to),
            Math.round((record.amountSol ?? 0) * LAMPORTS_PER_SOL),
          );
        }
        tx.sign(demoKeypair);
        signature = await sendAndConfirm(conn, tx.serialize());
      } else {
        res.status(400).json({ error: 'no signature provided' });
        return;
      }

      // Receipt: canonical record JSON -> sha256 -> memo tx signed by the
      // demo (receipt) keypair, AFTER the transfer confirms.
      const fields = {
        id: record.id, intent: record.intent, summary: record.summary,
        amountSol: record.amountSol, to: record.to, signature, createdAt: record.createdAt,
      };
      const recordJson = canonicalRecordJson(fields);
      const receiptHash = receiptHashFor(fields);
      const memoText = memoTextFor(record.id, receiptHash);
      const memoTx = await buildMemoTransaction(conn, getDemoKeypair(), memoText);
      const memoSignature = await sendAndConfirm(conn, memoTx.serialize());

      store.update(record.id, {
        status: 'executed', signature, memoSignature, receiptHash, recordJson,
      });
      res.json({
        actionId: record.id, status: 'executed', signature, memoSignature,
        solscan: { tx: SOLSCAN_TX(signature), memo: SOLSCAN_TX(memoSignature) },
      });
    } catch (err) {
      console.error('[confirm] error:', err);
      store.update(record.id, { status: 'failed' });
      res.status(502).json({ error: `confirm failed: ${(err as Error).message}` });
    }
  });

  // POST /api/reject
  app.post('/api/reject', (req: Request, res: Response) => {
    const { actionId } = (req.body ?? {}) as { actionId?: unknown };
    if (typeof actionId !== 'string') {
      res.status(400).json({ error: 'actionId is required' });
      return;
    }
    const record = store.get(actionId);
    if (!record) {
      res.status(404).json({ error: `unknown action ${actionId}` });
      return;
    }
    store.update(actionId, { status: 'rejected' });
    res.json({ actionId, status: 'rejected' });
  });

  // GET /api/actions
  app.get('/api/actions', (_req: Request, res: Response) => {
    res.json({ actions: store.getAll().map(publicSummary) });
  });

  // GET /api/actions/:id
  app.get('/api/actions/:id', (req: Request, res: Response) => {
    const record = store.get(paramId(req));
    if (!record) {
      res.status(404).json({ error: `unknown action ${paramId(req)}` });
      return;
    }
    res.json(record);
  });

  // POST /api/verify/:id
  app.post('/api/verify/:id', async (req: Request, res: Response) => {
    // Re-read from disk: verify is the integrity check, so it must see the
    // freshest stored record — a tampered db.json must verify FALSE.
    store.reload();
    const record = store.get(paramId(req));
    if (!record) {
      res.status(404).json({ error: `unknown action ${paramId(req)}` });
      return;
    }
    // Recompute from the record's fields (not the stored recordJson) so a
    // tampered record verifies FALSE.
    const expectedHash = receiptHashFor({
      id: record.id, intent: record.intent, summary: record.summary,
      amountSol: record.amountSol, to: record.to,
      signature: record.signature, createdAt: record.createdAt,
    });
    if (!record.memoSignature) {
      res.json({ verified: false, expectedHash, onChainHash: null, memoSignature: null });
      return;
    }
    try {
      const onChain = await fetchOnChainMemo(conn, record.memoSignature);
      const onChainHash = onChain?.hash ?? null;
      const verified = onChain !== null && onChain.actionId === record.id && onChainHash === expectedHash;
      res.json({ verified, expectedHash, onChainHash, memoSignature: record.memoSignature });
    } catch (err) {
      res.status(502).json({ error: `verify failed: ${(err as Error).message}` });
    }
  });

  // GET /api/limits
  app.get('/api/limits', (_req: Request, res: Response) => {
    const limits = store.getLimits();
    res.json({ ...limits, sessionSpentSol: store.sessionSpentSol() });
  });

  // POST /api/limits
  app.post('/api/limits', (req: Request, res: Response) => {
    const { perTxCapSol, sessionCapSol } = (req.body ?? {}) as {
      perTxCapSol?: unknown;
      sessionCapSol?: unknown;
    };
    const patch: Partial<{ perTxCapSol: number; sessionCapSol: number }> = {};
    if (perTxCapSol !== undefined) {
      if (typeof perTxCapSol !== 'number' || !Number.isFinite(perTxCapSol) || perTxCapSol <= 0 || perTxCapSol > 1) {
        res.status(400).json({ error: 'perTxCapSol must be a number > 0 and ≤ 1' });
        return;
      }
      patch.perTxCapSol = perTxCapSol;
    }
    if (sessionCapSol !== undefined) {
      if (typeof sessionCapSol !== 'number' || !Number.isFinite(sessionCapSol) || sessionCapSol <= 0) {
        res.status(400).json({ error: 'sessionCapSol must be a number > 0' });
        return;
      }
      patch.sessionCapSol = sessionCapSol;
    }
    const limits = store.setLimits(patch);
    res.json({ ...limits, sessionSpentSol: store.sessionSpentSol() });
  });

  // GET /api/demo/seed
  app.get('/api/demo/seed', async (_req: Request, res: Response) => {
    try {
      const demoKeypair = getDemoKeypair();
      const fund = await ensureFunded(conn, demoKeypair);
      if (fund.error) {
        console.error(`[seed] demo wallet funding problem: ${fund.error}`);
      }
      const fresh = Keypair.generate().publicKey.toBase58();
      const commands = [
        { label: 'Check demo wallet balance', message: 'What is the balance of the demo wallet?' },
        { label: 'Send 0.05 SOL to Alice (with explainer)', message: 'Send 0.05 SOL to Alice' },
        { label: 'Risky: send 5 SOL to a fresh address', message: `Send 5 SOL to ${fresh}` },
      ];
      res.json({
        commands,
        demoWallet: demoKeypair.publicKey.toBase58(),
        demoBalanceSol: fund.balanceSol,
        funded: fund.funded,
        ...(fund.error ? { fundingError: fund.error } : {}),
      });
    } catch (err) {
      res.status(502).json({ error: `seed failed: ${(err as Error).message}` });
    }
  });
}
