#!/usr/bin/env node
'use strict';
// PostToolUse: records file writes (for ownership checks) and approved risky commands. Never blocks.
const path = require('node:path');
const { WRITE_TOOLS, readStdin, lifecycle, locate } = require('./common');
const { USER_ONLY, riskyKind } = require('./patterns');
const { appendLine } = require('../lib/fsutil');
const { redact } = require('../lib/redact');

function main() {
  const input = readStdin();
  const ctx = lifecycle(input);
  if (!ctx) return;
  try {
    const ti = input.tool_input || {};
    const base = { ts: new Date().toISOString(), agent_id: input.agent_id || null, agent_type: input.agent_type || null };
    if (input.tool_name === 'Bash') {
      const cmd = String(ti.command || '');
      const kind = USER_ONLY.test(cmd) ? 'user-only adlc action' : riskyKind(cmd, 'strict');
      if (kind) appendLine(path.join(ctx.runs, 'audit.jsonl'), { ...base, kind, cmd: redact(cmd).slice(0, 2000) });
    } else if (WRITE_TOOLS.includes(input.tool_name)) {
      const target = ti.file_path || ti.notebook_path;
      if (target) {
        const where = locate(ctx, input, target);
        appendLine(path.join(ctx.runs, 'writes.jsonl'), { ...base, tool: input.tool_name, path: where.path, workspace: where.workspace });
      }
    }
  } catch (err) {
    process.stderr.write(`adlc audit: ${err.message}\n`);
  }
}

if (require.main === module) main();
