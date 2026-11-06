import { useEffect, useState } from 'react'
import { api, type Limits } from '../lib/api'

export default function Settings() {
  const [limits, setLimits] = useState<Limits | null>(null)
  const [perTx, setPerTx] = useState('')
  const [session, setSession] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await api.limits()
      setLimits(res)
      setPerTx(String(res.perTxCapSol))
      setSession(String(res.sessionCapSol))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load limits')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const perTxCapSol = parseFloat(perTx)
    const sessionCapSol = parseFloat(session)
    if (Number.isNaN(perTxCapSol) || Number.isNaN(sessionCapSol)) {
      setError('Enter valid numbers for both caps.')
      return
    }
    if (perTxCapSol > 1) {
      setError('Per-transaction cap must be ≤ 1 SOL.')
      return
    }
    if (perTxCapSol <= 0 || sessionCapSol <= 0) {
      setError('Caps must be greater than 0.')
      return
    }
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const res = await api.updateLimits({ perTxCapSol, sessionCapSol })
      setLimits(res)
      setSaved('Caps updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save limits')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <h2>Settings — spending caps</h2>
      {error && <p className="error-banner">{error}</p>}
      {loading && <p className="muted">Loading limits…</p>}
      {limits && (
        <>
          <div className="limits-summary">
            <div className="limit-stat">
              <span className="limit-label">Per-transaction cap</span>
              <strong data-testid="per-tx-cap">{limits.perTxCapSol} SOL</strong>
            </div>
            <div className="limit-stat">
              <span className="limit-label">Session cap</span>
              <strong data-testid="session-cap">{limits.sessionCapSol} SOL</strong>
            </div>
            <div className="limit-stat">
              <span className="limit-label">Session spent</span>
              <strong data-testid="session-spent">{limits.sessionSpentSol} SOL</strong>
            </div>
            <div className="limit-stat">
              <span className="limit-label">Session remaining</span>
              <strong>
                {Math.max(0, limits.sessionCapSol - limits.sessionSpentSol).toFixed(4)} SOL
              </strong>
            </div>
          </div>

          <form className="limits-form" onSubmit={handleSave}>
            <label>
              Per-transaction cap (SOL, max 1)
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={perTx}
                onChange={(e) => setPerTx(e.target.value)}
                aria-label="Per-transaction cap in SOL"
              />
            </label>
            <label>
              Session cap (SOL)
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={session}
                onChange={(e) => setSession(e.target.value)}
                aria-label="Session cap in SOL"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save caps'}
            </button>
            {saved && <span className="verify-ok">{saved}</span>}
          </form>
        </>
      )}
      <p className="muted small">
        Caps are enforced in the backend (off-chain). Receipts are verified on-chain.
      </p>
    </div>
  )
}
