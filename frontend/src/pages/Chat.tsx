import { useRef, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { api, shortenAddress, type ChatResponse, type ConfirmResponse } from '../lib/api'
import { signTxPreview, solscanTxUrl } from '../lib/solana'
import ExplainerCard from '../components/ExplainerCard'

interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text?: string
  response?: ChatResponse
  confirmResult?: ConfirmResponse
  confirmError?: string
  decided?: boolean
}

interface Props {
  demo: boolean
}

let msgCounter = 0
function nextId(prefix: string): string {
  msgCounter += 1
  return `${prefix}_${Date.now()}_${msgCounter}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Render a read-only result (balance / history / explain) nicely. */
function ReadOnlyResult({ response }: { response: ChatResponse }) {
  const result = (response.result ?? {}) as Record<string, unknown>
  const balance = result.balanceSol ?? result.balance
  const history = Array.isArray(result.history)
    ? (result.history as Record<string, unknown>[])
    : Array.isArray(result.transactions)
      ? (result.transactions as Record<string, unknown>[])
      : null
  return (
    <div className="readonly-result">
      <p>{response.summary}</p>
      {typeof balance === 'number' && (
        <p className="balance-big">
          {balance} <span>SOL</span>
        </p>
      )}
      {history && history.length > 0 && (
        <ul className="history-list">
          {history.map((item, i) => {
            const sig = String(item.signature ?? item.tx ?? item.id ?? '')
            const label = String(
              item.summary ?? item.type ?? item.memo ?? item.description ?? sig,
            )
            return (
              <li key={sig || i}>
                {sig ? (
                  <a href={solscanTxUrl(sig)} target="_blank" rel="noreferrer">
                    {shortenAddress(sig, 8, 8)}
                  </a>
                ) : (
                  label
                )}
                {item.amountSol !== undefined && <span> — {String(item.amountSol)} SOL</span>}
                {item.amount !== undefined && <span> — {String(item.amount)}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {history && history.length === 0 && <p className="muted">No transactions found.</p>}
      {response.explanation && <p>{response.explanation}</p>}
      {Object.keys(result).length > 0 && balance === undefined && !history && (
        <pre className="json-block">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  )
}

export default function Chat({ demo }: Props) {
  const { publicKey, signTransaction } = useWallet()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [demoRunning, setDemoRunning] = useState(false)
  const [demoStatus, setDemoStatus] = useState('')
  const [seedInfo, setSeedInfo] = useState<{ wallet: string; balance: number } | null>(null)
  const [sendError, setSendError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const updateMessage = (id: string, patch: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const scrollDown = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  /** Send one message; returns the chat response (if any). */
  async function sendMessage(
    text: string,
    opts?: { autoConfirm?: boolean; forceDemo?: boolean },
  ): Promise<ChatResponse | null> {
    const useDemo = opts?.forceDemo ?? demo
    const userMsg: ChatMessage = { id: nextId('u'), role: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    setSendError('')
    scrollDown()
    try {
      const res = await api.chat(text, {
        wallet: useDemo ? undefined : publicKey?.toBase58(),
        demo: useDemo ? true : undefined,
      })
      const agentMsg: ChatMessage = { id: nextId('a'), role: 'agent', response: res }
      setMessages((prev) => [...prev, agentMsg])
      scrollDown()
      if (opts?.autoConfirm && res.intent === 'transfer_sol' && !res.blocked && res.actionId) {
        // Visible pause so judges see the explainer before it confirms itself.
        await sleep(2000)
        await confirmAction(agentMsg.id, res, useDemo)
      }
      return res
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat request failed'
      setSendError(msg)
      setMessages((prev) => [
        ...prev,
        { id: nextId('a'), role: 'agent', text: `Error: ${msg}` },
      ])
      return null
    }
  }

  async function confirmAction(messageId: string, res: ChatResponse, useDemo = demo) {
    if (!res.actionId) return
    updateMessage(messageId, { confirmError: undefined })
    try {
      let signedTx: string | undefined
      if (!useDemo) {
        if (!res.txPreview) throw new Error('No transaction preview to sign.')
        if (!signTransaction) throw new Error('No wallet connected — connect Phantom or switch on Demo wallet.')
        signedTx = await signTxPreview(res.txPreview, { signTransaction })
      }
      // Demo mode: no signedTx — the server signs with the demo wallet.
      const result = await api.confirm(res.actionId, signedTx)
      updateMessage(messageId, { confirmResult: result, decided: true })
    } catch (err) {
      updateMessage(messageId, {
        confirmError: err instanceof Error ? err.message : 'Confirmation failed',
      })
    }
    scrollDown()
  }

  async function rejectAction(messageId: string, res: ChatResponse) {
    if (!res.actionId) return
    try {
      await api.reject(res.actionId)
      updateMessage(messageId, { decided: true })
    } catch (err) {
      updateMessage(messageId, {
        confirmError: err instanceof Error ? err.message : 'Reject failed',
      })
    }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || busy || demoRunning) return
    setInput('')
    setBusy(true)
    try {
      await sendMessage(text)
    } finally {
      setBusy(false)
    }
  }

  async function runSeededDemo() {
    if (demoRunning || busy) return
    setDemoRunning(true)
    setDemoStatus('Fetching seeded demo…')
    try {
      const seed = await api.demoSeed()
      setSeedInfo({ wallet: seed.demoWallet, balance: seed.demoBalanceSol })
      for (const [i, cmd] of seed.commands.entries()) {
        setDemoStatus(`Step ${i + 1} of ${seed.commands.length}: ${cmd.label}`)
        // The seeded demo always runs against the server demo wallet so it
        // works with zero typing and no Phantom connected.
        await sendMessage(cmd.message, { autoConfirm: i === 1, forceDemo: true })
        await sleep(1200)
      }
      setDemoStatus('Seeded demo complete — check the Audit Log to verify the receipt.')
    } catch (err) {
      setDemoStatus(`Seeded demo failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDemoRunning(false)
    }
  }

  return (
    <div className="chat-page">
      <div className="chat-toolbar">
        <button className="btn btn-primary" onClick={runSeededDemo} disabled={demoRunning || busy}>
          {demoRunning ? 'Running seeded demo…' : '▶ Run seeded demo'}
        </button>
        <span className="muted small">
          {demo
            ? 'Demo wallet ON — the server signs with DevNet demo SOL.'
            : publicKey
              ? `Signing with Phantom ${shortenAddress(publicKey.toBase58())}`
              : 'No wallet connected — turn on Demo wallet or connect Phantom to sign.'}
        </span>
        {seedInfo && (
          <span className="muted small">
            Demo wallet{' '}
            <a
              href={`https://solscan.io/account/${seedInfo.wallet}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              {shortenAddress(seedInfo.wallet)}
            </a>{' '}
            · {seedInfo.balance} SOL
          </span>
        )}
      </div>
      {demoStatus && <p className="demo-status">{demoStatus}</p>}
      {sendError && <p className="error-banner">{sendError}</p>}

      <div className="message-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <p>
              Ask AgentProof to do something on Solana DevNet — for example{' '}
              <em>“What is my balance?”</em> or <em>“Send 0.05 SOL to …”</em>.
            </p>
            <p className="muted small">
              Transfers always stop at an explainer card first. Nothing is signed until you
              press Confirm.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            {m.role === 'user' ? (
              <div className="bubble bubble-user">{m.text}</div>
            ) : (
              <div className="bubble bubble-agent">
                {m.response ? (
                  <>
                    {m.response.blocked ? (
                      <div className="blocked-banner" role="alert">
                        <strong>
                          Blocked: {m.response.blockReason ?? 'above your cap'}
                        </strong>
                        <p>{m.response.summary}</p>
                      </div>
                    ) : m.response.intent === 'transfer_sol' && m.response.requiresConfirm ? (
                      <ExplainerCard
                        response={m.response}
                        busy={busy}
                        onConfirm={() => confirmAction(m.id, m.response!)}
                        onReject={() => rejectAction(m.id, m.response!)}
                      />
                    ) : m.response.intent === 'unknown' ? (
                      <p>{m.response.summary}</p>
                    ) : (
                      <ReadOnlyResult response={m.response} />
                    )}
                    {m.confirmResult && (
                      <div className="confirm-result success">
                        <strong>Executed ✓</strong>
                        <p>
                          Tx:{' '}
                          <a href={m.confirmResult.solscan.tx} target="_blank" rel="noreferrer">
                            {shortenAddress(m.confirmResult.signature, 8, 8)}
                          </a>
                        </p>
                        <p>
                          Receipt memo:{' '}
                          <a href={m.confirmResult.solscan.memo} target="_blank" rel="noreferrer">
                            {shortenAddress(m.confirmResult.memoSignature, 8, 8)}
                          </a>
                        </p>
                      </div>
                    )}
                    {m.decided && !m.confirmResult && (
                      <p className="muted small">Rejected — nothing was signed or sent.</p>
                    )}
                    {m.confirmError && <p className="error-banner">{m.confirmError}</p>}
                  </>
                ) : (
                  <p>{m.text}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask AgentProof… e.g. Send 0.05 SOL to <address>"
          disabled={busy || demoRunning}
          aria-label="Message AgentProof"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || demoRunning || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
