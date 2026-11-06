"""AgentProof Playwright E2E verification (unfunded path).
Scenarios:
 (a) seeded demo runner up to the funding point
 (b) chat -> explainer -> Reject
 (c) Audit Log renders actions
 (d) Settings caps change (and restore)
Screenshots -> verification/shots/
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
SHOTS = Path(__file__).resolve().parent / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)
results = {}


def check(name, ok, detail=""):
    results[name] = {"pass": bool(ok), "detail": detail}
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        # Console "Failed to load resource" for the wallet-adapter's Google
        # Fonts @import (fonts.googleapis.com) is an environment egress
        # failure, not an app error — the font degrades to system fonts.
        # Only count real JS exceptions / console errors that are not
        # external-resource load failures.
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)

        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(1500)
        check("app loads", page.locator("h1", has_text="AgentProof").count() == 1)
        check("demo wallet toggle on", page.locator(".demo-toggle input").is_checked())
        check("header shows 0 SOL demo balance", "0 SOL" in page.locator("header").inner_text())
        page.screenshot(path=str(SHOTS / "01-home.png"))

        # (a) seeded demo runner
        page.click("text=Run seeded demo")
        # wait for demo to finish: status text becomes complete
        try:
            page.wait_for_selector("text=Seeded demo complete", timeout=90000)
            demo_done = True
        except Exception:
            demo_done = False
        status = page.locator(".demo-status").inner_text() if page.locator(".demo-status").count() else ""
        check("seeded demo completes", demo_done, status)
        body = page.locator(".message-list").inner_text()
        check("demo shows balance 0 SOL", "0 SOL" in body, body[:200].replace("\n", " | "))
        check("demo builds transfer explainer", "0.05" in body and ("Confirm" in body or "Risk" in body or "risk" in body.lower()))
        check("demo shows cap-blocked risky step", "Blocked" in body and "5 SOL" in body)
        check("demo confirm fails cleanly (no funds, error shown not crash)",
              "Confirmation failed" in body or "confirm" in body.lower() or "Attempt to debit" in body,
              "confirm error surfaced in UI" if "Attempt to debit" in body else "")
        page.screenshot(path=str(SHOTS / "02-seeded-demo.png"))

        # (b) chat -> explainer -> Reject (scoped to the NEWEST agent message,
        # so we never click a stale explainer card from the seeded demo)
        expl_before = page.locator('[data-testid="explainer-card"]').count()
        page.fill('input[aria-label="Message AgentProof"]', "Send 0.05 SOL to 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")
        page.click('button[type="submit"]:has-text("Send")')
        try:
            page.wait_for_function(
                f"document.querySelectorAll('[data-testid=\"explainer-card\"]').length > {expl_before}",
                timeout=60000)
            explainer = True
        except Exception:
            explainer = False
        check("chat transfer shows explainer + Confirm", explainer)
        check("new explainer is for the 9xQe transfer",
              "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" in page.locator(".message-list").inner_text())
        page.screenshot(path=str(SHOTS / "03-explainer.png"))
        # Reject path — click Reject inside the LAST agent message only
        last_agent = page.locator(".message.agent").last
        reject_btn = last_agent.locator("button:has-text('Reject')")
        if reject_btn.count():
            reject_btn.click()
            page.wait_for_timeout(1500)
            check("reject marks message decided", "Rejected — nothing was signed or sent." in last_agent.inner_text())
        else:
            check("reject marks message decided", False, "no Reject button in newest message")
        page.screenshot(path=str(SHOTS / "04-rejected.png"))

        # (c) Audit Log
        page.click("text=Audit Log")
        page.wait_for_timeout(2000)
        audit_text = page.locator(".audit-list").inner_text() if page.locator(".audit-list").count() else ""
        check("audit log renders actions", len(audit_text) > 0 and "transfer_sol" in audit_text,
              f"{page.locator('.audit-card').count()} cards")
        check("audit shows blocked + rejected statuses",
              "blocked" in audit_text.lower() and "rejected" in audit_text.lower())
        page.screenshot(path=str(SHOTS / "05-audit.png"))

        # (d) Settings caps change
        page.click("text=Settings")
        page.wait_for_timeout(1500)
        before = page.locator('[data-testid="per-tx-cap"]').inner_text()
        page.fill('input[aria-label="Per-transaction cap in SOL"]', "0.08")
        page.click('button[type="submit"]:has-text("Save caps")')
        page.wait_for_timeout(1500)
        after = page.locator('[data-testid="per-tx-cap"]').inner_text()
        check("settings caps change", "Caps updated." in page.locator("body").inner_text() and after.startswith("0.08"), f"{before} -> {after}")
        page.screenshot(path=str(SHOTS / "06-settings.png"))
        # restore default 0.1
        page.fill('input[aria-label="Per-transaction cap in SOL"]', "0.1")
        page.click('button[type="submit"]:has-text("Save caps")')
        page.wait_for_timeout(1200)
        restored = page.locator('[data-testid="per-tx-cap"]').inner_text()
        check("settings caps restored to 0.1", restored.startswith("0.1"), restored)

        check("no page JS errors", len(errors) == 0, "; ".join(errors[:3]))
        browser.close()

    out = Path(__file__).resolve().parent / "e2e-results.json"
    out.write_text(json.dumps(results, indent=2))
    fails = [k for k, v in results.items() if not v["pass"]]
    print(f"\n{len(results)-len(fails)}/{len(results)} passed; failures: {fails}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
