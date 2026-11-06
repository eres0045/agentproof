import { useEffect, useState } from 'react'
import { api, shortenAddress, type ActionRecord } from '../lib/api'
import { solscanTxUrl } from '../lib/solana'

export default function Audit() {
  const [actions, setActions] = useState<ActionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [verifyState, setVerifyState] = useState<Record<string, 'checking' | 'ok' | 'bad' | 'error'>>({})
  const [verifyDetail, setVerifyDetail] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.actions()
      setActions(res.actions)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load actions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function verify(id: string) {
    setVerifyState((prev) => ({ ...prev, [id]: 'checking' }))
    try {
      const res = await api.verify(id)
      setVerifyState((prev) => ({ ...prev, [id]: res.verified ? 'ok' : 'bad' }))
      setVerifyDetail((prev) => ({
        ...prev,
        [id]: res.verified
          ? `Verified on-chain — hash ${res.onChainHash.slice(0, 16)}… matches the stored record.`
          : `MISMATCH — record tampered. Expected ${res.expectedHash.slice(0, 16)}…, on-chain ${res.onChainHash.slice(0, 16)}….`,
      }))
    } catch (err) {
      setVerifyState((prev) => ({ ...prev, [id]: 'error' }))
      setVerifyDetail((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'Verification failed',
      }))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Audit Log</h2>
        <button className="btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>
      <p className="muted">
        Every action the agent parsed — executed, rejected, blocked, or failed. Each executed
        action has an on-chain memo receipt; Verify recomputes the record hash and compares it
        with the memo on DevNet.
      </p>
      {error && <p className="error-banner">{error}</p>}
      {loading && <p className="muted">Loading actions…</p>}
      {!loading && actions.length === 0 && <p className="muted">No actions yet. Run a chat or the seeded demo first.</p>}
      <div className="audit-list">
        {actions.map((a) => (
          <article key={a.id} className="audit-card">
            <div className="audit-top">
              <span className="audit-intent">{a.intent}</span>
              <span className={`badge badge-${a.status}`}>{a.status}</span>
            </div>
            <p className="audit-summary">{a.summary}</p>
            <dl className="audit-facts">
              {typeof a.amountSol === 'number' && (
                <>
                  <dt>Amount</dt>
                  <dd>{a.amountSol} SOL</dd>
                </>
              )}
              {a.to && (
                <>
                  <dt>To</dt>
                  <dd>{shortenAddress(a.to, 6, 6)}</dd>
                </>
              )}
              <dt>Created</dt>
              <dd>{new Date(a.createdAt).toLocaleString()}</dd>
              {a.receiptHash && (
                <>
                  <dt>Receipt hash</dt>
                  <dd className="mono">{shortenAddress(a.receiptHash, 10, 10)}</dd>
                </>
              )}
            </dl>
            <div className="audit-links">
              {a.signature && (
                <a href={solscanTxUrl(a.signature)} target="_blank" rel="noreferrer">
                  Tx ↗
                </a>
              )}
              {a.memoSignature && (
                <a href={solscanTxUrl(a.memoSignature)} target="_blank" rel="noreferrer">
                  Memo receipt ↗
                </a>
              )}
              <button
                className="btn btn-small"
                onClick={() => void verify(a.id)}
                disabled={verifyState[a.id] === 'checking' || a.status !== 'executed'}
                title={a.status !== 'executed' ? 'Only executed actions have an on-chain memo receipt' : undefined}
              >
                {verifyState[a.id] === 'checking' ? 'Verifying…' : 'Verify'}
              </button>
            </div>
            {verifyState[a.id] === 'ok' && (
              <p className="verify-ok" role="status">✓ Verified on-chain</p>
            )}
            {verifyState[a.id] === 'bad' && (
              <p className="verify-bad" role="alert">✕ MISMATCH — record tampered</p>
            )}
            {verifyDetail[a.id] && <p className="muted small">{verifyDetail[a.id]}</p>}
          </article>
        ))}
      </div>
    </div>
  )
}
