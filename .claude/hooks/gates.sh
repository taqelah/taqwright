#!/usr/bin/env bash
# Stop hook: run the project's CI gates (format → lint → build+test) when a turn
# finishes, mirroring CLAUDE.md's pre-push gates. Exits 2 on failure so Claude is
# prompted to fix before stopping; exits 0 (skip) on chat-only turns.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Loop guard: if this Stop was already triggered by a prior gate block, don't
# re-block (avoids an unfixable failure looping forever).
payload="$(cat)"
case "$payload" in *'"stop_hook_active":true'*) exit 0 ;; esac

# Skip when nothing the gates care about changed — no rebuild/test on Q&A turns.
changed="$(git status --porcelain -- src test eslint.config.js .prettierrc.json tsconfig.json package.json 2>/dev/null)"
[ -z "$changed" ] && exit 0

run() { echo "▶ $*" >&2; if ! "$@" >&2; then echo "✖ gate failed: $*" >&2; exit 2; fi; }
run npm run format:check
run npm run lint
run npm test
echo "✓ all gates passed" >&2
