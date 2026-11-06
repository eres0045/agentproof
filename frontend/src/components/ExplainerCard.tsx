import type { ChatResponse } from '../lib/api'
import { shortenAddress } from '../lib/api'
import { solscanAccountUrl } from '../lib/solana'

const SEVERITY_CLASS: Record<string, string> = {
  low: 'flag-low',
  medium: 'flag-medium',
  high: 'flag-high',
}

interface Props {
  response: ChatResponse
  busy: boolean
  onConfirm: () => void
  onReject: () => void
}

/**
 * Pre-sign explainer card: plain-English explanation, risk flags with
 * severity colours, amount/recipient, and Confirm / Reject buttons.
 * Nothing here executes anything — Confirm is what triggers signing.
 */
export default function ExplainerCard({ response, busy, onConfirm, onReject }: Props) {
  const flags = response.riskFlags ?? []
  return (
    <div className="explainer" data-testid="explainer-card">
      <div className="explainer-head">
        <span className="explainer-title">Before you sign — check this</span>
        <span className="badge badge-pending">Requires confirm</span>
      </div>

      <p className="explainer-summary">{response.summary}</p>
      {response.explanation && <p className="explainer-text">{response.explanation}</p>}

      <dl className="explainer-facts">
        {typeof response.amountSol === 'number' && (
          <>
            <dt>Amount</dt>
            <dd>
              <strong>{response.amountSol} SOL</strong>
            </dd>
          </>
        )}
        {response.to && (
          <>
            <dt>Recipient</dt>
            <dd>
              <a href={solscanAccountUrl(response.to)} target="_blank" rel="noreferrer">
                {shortenAddress(response.to, 6, 6)}
              </a>{' '}
              <span className="muted">({response.to})</span>
            </dd>
          </>
        )}
      </dl>

      {flags.length > 0 && (
        <div className="flags">
          <div className="flags-title">Risk flags</div>
          <ul>
            {flags.map((f) => (
              <li key={f.code} className={`flag ${SEVERITY_CLASS[f.severity] ?? 'flag-low'}`}>
                <span className="flag-code">{f.code}</span>
                <span className="flag-severity">{f.severity}</span>
                <span className="flag-detail">{f.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {flags.length === 0 && <p className="muted">No risk flags raised.</p>}

      <p className="muted small">
        The explainer is advisory, not a guarantee — it can miss a risk. Check the recipient
        and amount yourself before confirming.
      </p>

      <div className="explainer-actions">
        <button className="btn btn-confirm" onClick={onConfirm} disabled={busy}>
          {busy ? 'Confirming…' : 'Confirm & sign'}
        </button>
        <button className="btn btn-reject" onClick={onReject} disabled={busy}>
          Reject
        </button>
      </div>
    </div>
  )
}
