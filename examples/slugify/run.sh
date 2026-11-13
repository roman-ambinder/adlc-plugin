#!/usr/bin/env bash
# End-to-end walkthrough of one small feature ("add a slugify utility") through every adlc stage.
#
# It runs the real adlc CLI and the real hook scripts. Model work (the analyst, the developer,
# the reviewer) is replaced by fixed file content, and hook events are fed to the hook scripts
# exactly as Claude Code would send them. That makes the run deterministic and needs no model access.
#
# Usage: examples/slugify/run.sh [workdir]   (default: a new temporary directory)
#        EXPORT=1 examples/slugify/run.sh    also copies the resulting .agent-lifecycle/ to examples/slugify/artifacts/
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/../../plugins/adlc" && pwd)"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd -P)"
cd "$WORK"

adlc() { ADLC_ROOT="$WORK" node "$PLUGIN/bin/adlc" "$@"; }
hook() { printf '%s' "$2" | CLAUDE_PROJECT_DIR="$WORK" node "$PLUGIN/hooks/$1.js"; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }
say() { printf '\n== %s\n' "$*"; }

say "0. A small repository"
git init -q -b main
git config user.email e2e@example.invalid
git config user.name "adlc e2e"
cat > package.json <<'EOF'
{ "name": "slugify-demo", "version": "1.0.0", "private": true, "scripts": { "test": "node --test" } }
EOF
git add package.json && git commit -qm "initial commit"

say "1. Start (small change: discover and design skipped with a recorded reason)"
adlc start "Add slugify utility" --small --parallel-mode auto

say "2. Specify (analyst writes measurable acceptance criteria)"
adlc stage start specify
cat > .agent-lifecycle/requirements.md <<'EOF'
# Requirements

## Problem

Page titles need URL-safe identifiers; the project has no helper for this.

## Users

Developers building URLs from user-provided titles.

## Constraints

No new dependencies. Node 18+.

## Success criteria

Titles convert to stable, readable slugs.

## Acceptance criteria

- AC-1: slugify lowercases text and joins words with single hyphens; verified by node --test test/slugify.test.js
- AC-2: slugify removes characters other than a-z, 0-9 and hyphens, and trims leading and trailing hyphens; verified by node --test test/slugify.test.js
- AC-3: slugify throws a TypeError for non-string input; verified by node --test test/slugify.test.js
EOF
adlc stage complete specify

say "3. Plan (one task with explicit files and checks; execution plan computed)"
adlc stage start plan
mkdir -p .agent-lifecycle/tmp
cat > .agent-lifecycle/tmp/tasks.json <<'EOF'
[
  {
    "title": "Implement slugify with tests",
    "goal": "Add src/slugify.js exporting slugify(text) and tests covering AC-1..AC-3",
    "files": ["src/slugify.js", "test/slugify.test.js"],
    "reads": ["package.json"],
    "ac": ["AC-1", "AC-2", "AC-3"],
    "checks": ["node --test test/slugify.test.js"],
    "size": "S"
  }
]
EOF
adlc task add --file .agent-lifecycle/tmp/tasks.json
adlc exec plan
adlc stage complete plan

say "4. Approval (the user runs /adlc:approve plan; here the script plays the user)"
if adlc stage start build 2>/dev/null; then echo "ERROR: build started without approval" >&2; exit 1; fi
echo "build refused without approval, as expected"
adlc approve plan --note "e2e: user reviewed requirements, plan and packet"
adlc stage start build

say "5. Build (dispatch T1, worker claims, guard scopes its writes)"
LEASE="$(adlc dispatch start T1 --session e2e-session --json | field lease)"
echo "lease: $LEASE"
AGENT='"agent_id":"agent-e2e-1","agent_type":"adlc:developer","cwd":"'"$WORK"'"'
hook guard '{"hook_event_name":"PreToolUse","tool_name":"Bash",'"$AGENT"',"tool_input":{"command":"adlc worker claim T1 --lease '"$LEASE"'"}}'
adlc worker claim T1 --lease "$LEASE"

OUT="$(hook guard '{"hook_event_name":"PreToolUse","tool_name":"Write",'"$AGENT"',"tool_input":{"file_path":"'"$WORK"'/README.md","content":"x"}}')"
echo "$OUT" | grep -q '"permissionDecision":"deny"' && echo "guard denied out-of-scope write to README.md, as expected"
OUT="$(hook guard '{"hook_event_name":"PreToolUse","tool_name":"Bash",'"$AGENT"',"tool_input":{"command":"git commit -am wip"}}')"
echo "$OUT" | grep -q '"permissionDecision":"deny"' && echo "guard denied git for the worker, as expected"

mkdir -p src test
cat > src/slugify.js <<'EOF'
'use strict';

function slugify(text) {
  if (typeof text !== 'string') throw new TypeError('slugify expects a string');
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
EOF
cat > test/slugify.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../src/slugify');

test('AC-1: lowercases and joins words with single hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Many   spaces here'), 'many-spaces-here');
});

test('AC-2: removes other characters and trims hyphens', () => {
  assert.equal(slugify('  ¡Hola, Mundo! 2026 '), 'hola-mundo-2026');
  assert.equal(slugify('--a--'), 'a');
});

test('AC-3: rejects non-string input', () => {
  assert.throws(() => slugify(42), TypeError);
});
EOF
for f in src/slugify.js test/slugify.test.js; do
  hook audit '{"hook_event_name":"PostToolUse","tool_name":"Write",'"$AGENT"',"tool_input":{"file_path":"'"$WORK/$f"'"}}'
done

EVIDENCE="$(adlc run --stage build --task T1 --json -- "node --test test/slugify.test.js" | field file)"
echo "worker evidence: $EVIDENCE"
cat > .agent-lifecycle/tmp/handoff-T1.json <<EOF
{
  "task": "T1",
  "status": "done",
  "workspace": "$WORK",
  "branch": null,
  "files_changed": ["src/slugify.js", "test/slugify.test.js"],
  "summary": "Added slugify(text) with tests for AC-1..AC-3.",
  "checks": [{ "cmd": "node --test test/slugify.test.js", "exit": 0, "evidence": "$EVIDENCE" }],
  "interface_changes": ["new module src/slugify.js exporting slugify(text: string): string"],
  "blockers": [],
  "integration_notes": "No dependencies added.",
  "out_of_scope": []
}
EOF
adlc worker handoff T1 --file .agent-lifecycle/tmp/handoff-T1.json
hook subagent-stop '{"hook_event_name":"SubagentStop","agent_id":"agent-e2e-1","agent_type":"adlc:developer","last_assistant_message":"T1 done; checks pass."}'

say "6. Integrate (coordinator checks ownership and evidence, runs cross-task checks)"
adlc integrate check T1
adlc run --stage build -- "node --test test/slugify.test.js"
adlc integrate done T1
adlc stage complete build

say "7. Verify (full suite through adlc run)"
adlc stage start verify
adlc run --stage verify -- "npm test"
adlc stage complete verify

say "8. Review (reviewer report recorded; no blocking findings)"
adlc stage start review
cat > .agent-lifecycle/tmp/review.md <<'EOF'
# Review: Add slugify utility

Reviewer: adlc:reviewer · Scope: src/slugify.js, test/slugify.test.js

## Blocking findings

None.

## Optional improvements

- [O1] src/slugify.js:6 — non-ASCII letters (é, ñ) are dropped rather than transliterated. Acceptable for AC-2; consider `normalize('NFKD')` later.

## Requirement coverage

- AC-1: covered by test "AC-1" (evidence in test-results/).
- AC-2: covered by test "AC-2".
- AC-3: covered by test "AC-3".

## Verification notes

Read both files; ran the test file through adlc run. Nothing left unverified.
EOF
adlc review add --file .agent-lifecycle/tmp/review.md --blocking 0 --optional 1
adlc stage complete review

say "9. Release (traceability, release notes, user approval)"
adlc stage start release
adlc trace
cat > .agent-lifecycle/release.md <<'EOF'
# Release

## Summary of changes

- New `src/slugify.js` exporting `slugify(text)`.
- Tests in `test/slugify.test.js` covering AC-1..AC-3.

## Acceptance criteria status

All criteria have passing evidence; see traceability.md.

## Migration

None.

## Deployment steps

No deployment process found in the repository. The change ships with the next package release.

## Rollback steps

Revert the commit that adds `src/slugify.js` and `test/slugify.test.js`; nothing else depends on it.

## Known issues and unverified claims

- Non-ASCII letters are dropped, not transliterated (review O1).
EOF
adlc approve release --note "e2e: user reviewed release notes"
adlc stage complete release

say "10. Final status"
adlc status
adlc next

if [ "${EXPORT:-}" = "1" ]; then
  DEST="$HERE/artifacts"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  (cd "$WORK" && tar -cf - --exclude='.agent-lifecycle/tmp' --exclude='.agent-lifecycle/.lock' .agent-lifecycle src test package.json) | (cd "$DEST" && tar -xf -)
  # Replace the machine-specific workdir path so exported artifacts contain no local paths.
  node -e '
    const fs = require("fs"), path = require("path");
    const [dest, work] = process.argv.slice(1);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      const t = fs.readFileSync(p, "utf8");
      if (t.includes(work)) fs.writeFileSync(p, t.split(work).join("/path/to/demo-repo"));
    });
    walk(dest);' "$DEST" "$WORK"
  echo "exported artifacts to $DEST"
fi
echo "e2e workdir: $WORK"
