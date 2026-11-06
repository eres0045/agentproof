#!/usr/bin/env python3
"""Launch the AgentProof backend with a Groq API key from the Secure Vault.

Fetches a dynamic-credential surrogate for ``custom.groq`` via authd and
spawns ``npm run start`` (node dist/server.js) with the surrogate as
``GROQ_API_KEY`` in the child environment. The surrogate is replaced with
the real key on approved egress by Sentinel/authd.

The surrogate/key is NEVER printed, logged, or written to disk by this script.
If dist/ is missing, the backend is built first (``npm run build``).
"""

from __future__ import annotations

import os
import subprocess
import sys

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")

from dynamic_credentials import dynamic_credential_entry  # noqa: E402


def main() -> int:
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        entry = dynamic_credential_entry("custom.groq")
    except Exception as exc:  # noqa: BLE001 - report and stop, never continue keyless silently
        print(f"[run-backend] ERROR: could not fetch Groq credential surrogate: {exc}", file=sys.stderr)
        print("[run-backend] The backend can still start, but LLM intent parsing will fall back to regex.", file=sys.stderr)
        entry = None

    env = os.environ.copy()
    if entry is not None:
        env["GROQ_API_KEY"] = str(entry["surrogate"]).strip()

    dist_server = os.path.join(backend_dir, "dist", "server.js")
    if not os.path.exists(dist_server):
        print("[run-backend] dist/ missing — building backend first...")
        subprocess.run(["npm", "run", "build"], cwd=backend_dir, check=True, env=env)

    print("[run-backend] starting AgentProof backend (node dist/server.js)...")
    result = subprocess.run(["npm", "run", "start"], cwd=backend_dir, env=env)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
