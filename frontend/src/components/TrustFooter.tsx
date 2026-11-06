/** Trust-boundary footer shown on every page. */
export default function TrustFooter() {
  return (
    <footer className="trust-footer">
      <p>
        Trust boundaries: the pre-sign explainer is advisory, not a guarantee — it can miss a
        risk. The demo wallet is server-held DevNet SOL only. Spending caps are enforced in
        the backend (off-chain); receipts are verified on-chain.
      </p>
    </footer>
  )
}
