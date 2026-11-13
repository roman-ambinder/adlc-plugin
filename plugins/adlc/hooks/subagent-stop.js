#!/usr/bin/env node
'use strict';
// SubagentStop: the authoritative "worker has stopped" signal used to release leases.
const path = require('node:path');
const { readStdin, lifecycle, readBindings } = require('./common');
const { appendLine } = require('../lib/fsutil');
const { redact } = require('../lib/redact');

function main() {
  const input = readStdin();
  const ctx = lifecycle(input);
  if (!ctx || !input.agent_id) return;
  try {
    const b = readBindings(ctx)[input.agent_id] || {};
    appendLine(path.join(ctx.runs, 'stops.jsonl'), {
      ts: new Date().toISOString(),
      agent_id: input.agent_id,
      agent_type: input.agent_type || null,
      task: b.task || null,
      lease: b.lease || null,
      excerpt: redact(String(input.last_assistant_message || '')).slice(0, 500),
    });
  } catch (err) {
    process.stderr.write(`adlc subagent-stop: ${err.message}\n`);
  }
}

if (require.main === module) main();
