'use strict';
const fs = require('node:fs');
const path = require('node:path');
const st = require('./state');
const userIntent = require('./userintent');
const stages = require('./stages');
const tasks = require('./tasks');
const packets = require('./packets');
const exec = require('./exec');
const gates = require('./gates');
const evidence = require('./evidence');
const dispatch = require('./dispatch');
const integrate = require('./integrate');
const rules = require('./rules');
const { appendLine, atomicWrite } = require('./fsutil');
const { AdlcError, EXIT, usage, rule } = require('./errors');
const { redact } = require('./redact');

const BOOL = new Set(['small', 'json', 'exclusive', 'force', 'help']);

const HELP = `usage: adlc <command> [args]
  start "<title>" [--type feature|bugfix] [--small] [--approval-gates plan,release|none]
        [--parallel-mode auto|worktree|shared|sequential] [--max-parallel N]
        [--max-repair-attempts N] [--max-tasks-per-run N] [--serial-globs a,b]
  status [--json]          next [--json]
  stage start|complete <stage>
  skip <stage> <reason>    unblock <note> [--task T]          (user-only)
  task add --file <json>   task update <T> --file <json>   task list [--json]
  task next                task block <T> <reason>         task repair <T> [note]
  contract add --file <json>    packet render [T]    exec plan
  gate check <plan|release>     hash <plan|release>  approve <plan|release> [--note text]   (approve: user-only)
  run --stage <stage> [--task T] [--exclusive] -- <command...>
  review add --file <md> [--blocking N --optional N]  (counts are read from the report)    trace
  dispatch check <T>   dispatch ready [--json]   dispatch start <T> [--session id]
  worker claim <T> --lease <L>   worker handoff <T> --file <json>
  integrate check <T>  integrate done <T>
  lease stopped <L> <note>   lease lost <L> <note>
  handoff <note>   archive [--force] (user-only)   init
exit codes: 0 ok, 1 usage, 2 rule violation, 3 concurrent modification, 4 not initialised,
            5 command failed (evidence recorded), 70 internal error`;

function parse(argv) {
  const pos = [];
  const flags = {};
  let rest = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOL.has(key)) {
        flags[key] = true;
        continue;
      }
      const val = argv[i + 1];
      if (val === undefined) throw usage(`--${key} needs a value`);
      flags[key] = val;
      i += 1;
    } else {
      pos.push(a);
    }
  }
  return { pos, flags, rest };
}

function need(value, message) {
  if (value === undefined || value === null || value === true || value === '') throw usage(message);
  return value;
}

function readJsonFile(file) {
  need(file, '--file <path> is required');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw usage(`cannot read JSON from ${file}: ${err.message}`);
  }
}

function record(root, entry) {
  appendLine(st.paths(root).approvals, { ...entry, ts: st.now() });
}

function bulletList(title, items) {
  return items.length ? `${title}\n${items.map((x) => `- ${x}`).join('\n')}` : '';
}

function statusObj(root, s) {
  const cur = stages.current(s);
  const building = s.stages.build.status === 'in_progress';
  return {
    change: s.change,
    stage: cur,
    stage_status: cur === 'done' ? 'done' : s.stages[cur].status,
    stages: Object.fromEntries(st.STAGES.map((x) => [x, s.stages[x].status])),
    gates: Object.fromEntries(gates.GATES.map((g) => [g, gates.check(root, s, g)])),
    execution: { mode: s.execution.mode, requested: s.execution.resolved_from, max_parallel: s.execution.max_parallel, reasons: s.execution.reasons },
    tasks: s.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, attempts: t.attempts, max_attempts: t.max_attempts, size: t.size, blocker: t.blocker || null })),
    leases: dispatch.activeLeases(s),
    ready: building ? dispatch.readyToDispatch(root, s).map((t) => t.id) : [],
    blocker: s.blocker,
    budget: s.budget,
    metrics: s.metrics,
    next: stages.nextAction(s),
  };
}

function statusText(o) {
  const lines = [
    `Change ${o.change.id}: ${o.change.title} (${o.change.type})`,
    `Stage: ${o.stage}${o.stage === 'done' ? '' : ` (${o.stage_status})`}`,
    `Stages: ${Object.entries(o.stages).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    `Gates: ${Object.entries(o.gates).map(([k, v]) => `${k} ${v.ok ? 'ok' : 'NEEDED'} (${v.reason})`).join('; ')}`,
    `Execution: ${o.execution.mode || 'not planned'} (requested ${o.execution.requested}, max parallel ${o.execution.max_parallel})`,
    'Tasks:',
    ...(o.tasks.length ? o.tasks.map((t) => `  ${t.id} ${t.status.padEnd(10)} attempts ${t.attempts}/${t.max_attempts} size ${t.size}  ${t.title}${t.blocker ? `  [blocked: ${t.blocker}]` : ''}`) : ['  none']),
    `Active workers: ${o.leases.length ? o.leases.map((l) => `${l.task} (${l.lease})`).join(', ') : 'none'}`,
    `Ready to dispatch: ${o.ready.length ? o.ready.join(', ') : 'none'}`,
    `Blocker: ${o.blocker || 'none'}`,
    `Budget: ${o.budget.tasks_this_run}/${o.budget.max_tasks_per_run} tasks this run; retries ${o.metrics.retries}; integration failures ${o.metrics.integration_failures}`,
    `Next: ${o.next.action} ${o.next.stage}`,
  ];
  return lines.join('\n');
}

const handlers = {
  init({ root }) {
    return { text: `initialised ${st.init(root).dir}` };
  },

  start({ root, pos, flags }) {
    // flag > CLAUDE_PLUGIN_OPTION_<NAME> > default. A flag still holding an unsubstituted ${user_config.*} placeholder
    // (plugin settings not applied by the host) or an empty value is treated as not given.
    const opt = (flag) => {
      const v = flags[flag];
      if (typeof v === 'string' && v !== '' && !v.includes('${user_config')) return v;
      const e = process.env[`CLAUDE_PLUGIN_OPTION_${flag.replace(/-/g, '_').toUpperCase()}`];
      return e === undefined || e === '' ? undefined : e;
    };
    const title = need(pos.slice(1).join(' '), 'usage: adlc start "<title>" [--type feature|bugfix] [--small]');
    const config = {
      approval_gates: opt('approval-gates'),
      parallel_mode: opt('parallel-mode'),
      max_parallel: opt('max-parallel'),
      max_repair_attempts: opt('max-repair-attempts'),
      max_tasks_per_run: opt('max-tasks-per-run'),
      serial_globs: opt('serial-globs'),
    };
    const s = st.newState({ title, type: flags.type || 'feature', small: Boolean(flags.small), config });
    s.stage = stages.current(s);
    // Fewer gates than plan,release is the user's decision: it must come from their own /adlc:start (flag or plugin setting).
    const gatesKey = userIntent.gatesKey(s.config.approval_gates);
    const intent = gatesKey === userIntent.FULL_GATES ? null : userIntent.find(root, 'start', gatesKey, `with approval gates reduced to "${gatesKey}"`);
    st.create(root, s);
    if (intent) userIntent.consume(root, intent);
    for (const [stage, v] of Object.entries(s.stages)) {
      if (v.status === 'skipped') record(root, { type: 'skip', change: s.change.id, stage, reason: v.reason, actor: 'user' });
    }
    return { obj: { change: s.change, stage: s.stage }, text: `started ${s.change.id}; next: adlc stage start ${s.stage}` };
  },

  status({ root }) {
    const o = statusObj(root, st.load(root));
    return { obj: o, text: statusText(o) };
  },

  next({ root }) {
    const s = st.load(root);
    const n = stages.nextAction(s);
    const o = { ...n };
    if (n.action === 'start') o.problems = rules.startProblems(root, s, n.stage);
    if (n.action === 'continue') o.complete_problems = rules.completeProblems(root, s, n.stage);
    if (n.stage === 'build' && n.action === 'continue') {
      o.ready = dispatch.readyToDispatch(root, s).map((t) => t.id);
      // What the coordinator does next with each task in flight, so a new session does not repeat a finished step.
      const nextFor = (t) => {
        if (t.status === 'dispatched') return `when its worker has returned: adlc integrate check ${t.id}`;
        const prefix = s.execution.mode === 'worktree' ? `once the commit and merge commands printed by \`adlc integrate check ${t.id}\` have run: ` : '';
        return `${prefix}run the cross-task checks with adlc run --stage build, then adlc integrate done ${t.id}`;
      };
      o.in_flight = s.tasks.filter((t) => ['dispatched', 'returned'].includes(t.status)).map((t) => ({ id: t.id, status: t.status, next: nextFor(t) }));
    }
    const text = [
      `${n.action} ${n.stage}${n.blocker ? `: ${n.blocker}` : ''}`,
      bulletList('Cannot start yet:', o.problems || []),
      bulletList('Before completing this stage:', o.complete_problems || []),
      o.ready ? `Ready to dispatch: ${o.ready.join(', ') || 'none'}` : '',
      o.in_flight && o.in_flight.length ? `In flight:\n${o.in_flight.map((t) => `- ${t.id} (${t.status}): ${t.next}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return { obj: o, text };
  },

  stage({ root, pos }) {
    const [, sub, name] = pos;
    need(name, 'usage: adlc stage start|complete <stage>');
    if (sub === 'start') {
      return st.mutate(root, (s) => {
        const started = stages.startStage(s, name, { preconditions: (x) => rules.startProblems(root, s, x) });
        return { text: started ? `${name} started` : `${name} already in progress` };
      });
    }
    if (sub === 'complete') {
      return st.mutate(root, (s) => {
        const next = stages.completeStage(s, name, { preconditions: (x) => rules.completeProblems(root, s, x) });
        return { text: `${name} completed; next: ${next}` };
      });
    }
    throw usage('usage: adlc stage start|complete <stage>');
  },

  skip({ root, pos }) {
    const stage = need(pos[1], 'usage: adlc skip <stage> <reason>');
    const reason = need(pos.slice(2).join(' '), 'a skip reason is required: adlc skip <stage> <reason>');
    const intent = userIntent.find(root, 'skip', stage);
    const change = st.mutate(root, (s) => {
      stages.skipStage(s, stage, reason);
      return s.change.id;
    });
    userIntent.consume(root, intent);
    record(root, { type: 'skip', change, stage, reason, actor: 'user' });
    return { text: `${stage} skipped: ${reason}` };
  },

  unblock({ root, pos, flags }) {
    const note = need(pos.slice(1).join(' '), 'usage: adlc unblock <note> [--task T]');
    const intent = userIntent.find(root, 'unblock');
    const change = st.mutate(root, (s) => {
      s.blocker = null;
      if (flags.task) tasks.unblockTask(s, flags.task);
      return s.change.id;
    });
    userIntent.consume(root, intent);
    record(root, { type: 'unblock', change, task: flags.task || null, note, actor: 'user' });
    return { text: `unblocked${flags.task ? ` ${flags.task}` : ''}` };
  },

  task({ root, pos, flags }) {
    const sub = pos[1];
    if (sub === 'add') {
      const input = readJsonFile(flags.file);
      const items = Array.isArray(input) ? input : [input];
      return st.mutate(root, (s) => {
        const added = items.map((i) => tasks.addTask(s, i));
        return { obj: added, text: `added ${added.map((t) => t.id).join(', ')}` };
      });
    }
    if (sub === 'update') {
      const id = need(pos[2], 'usage: adlc task update <T> --file <json>');
      const patch = readJsonFile(flags.file);
      return st.mutate(root, (s) => ({ obj: tasks.updateTask(s, id, patch), text: `updated ${id}` }));
    }
    if (sub === 'list') {
      const s = st.load(root);
      return { obj: s.tasks, text: s.tasks.map((t) => `${t.id} ${t.status.padEnd(10)} ${t.title}`).join('\n') || 'no tasks' };
    }
    if (sub === 'next') {
      const s = st.load(root);
      const t = tasks.readyTasks(s)[0] || null;
      return { obj: t, text: t ? `${t.id} ${t.title}` : 'no ready task' };
    }
    if (sub === 'block') {
      const id = need(pos[2], 'usage: adlc task block <T> <reason>');
      const reason = need(pos.slice(3).join(' '), 'a block reason is required');
      return st.mutate(root, (s) => {
        tasks.blockTask(s, id, reason);
        return { text: `${id} blocked` };
      });
    }
    if (sub === 'repair') {
      const id = need(pos[2], 'usage: adlc task repair <T> [note]');
      const note = pos.slice(3).join(' ');
      return st.mutate(root, (s) => {
        const t = tasks.getTask(s, id);
        const lease = dispatch.leaseFor(s, id);
        if (lease && lease.status === 'active') {
          if (!dispatch.hasStopped(root, lease)) {
            throw rule(`${lease.lease} has no stop record; the worker may still be running. Inspect it, then use adlc lease stopped|lost ${lease.lease} "<note>"`);
          }
          dispatch.endLease(lease, 'stopped');
        }
        if (t.status === 'returned') s.metrics.integration_failures += 1;
        const reopen = t.status === 'integrated' && ['verify', 'review', 'release', 'done'].includes(stages.current(s));
        const result = tasks.repairTask(s, id, note);
        if (reopen) stages.reopenBuild(s);
        return { text: `${id} -> ${result} (attempt ${t.attempts}/${t.max_attempts})${reopen ? '; build reopened' : ''}${result === 'blocked' ? `\n${s.blocker}` : ''}` };
      });
    }
    throw usage('usage: adlc task add|update|list|next|block|repair');
  },

  contract({ root, pos, flags }) {
    if (pos[1] !== 'add') throw usage('usage: adlc contract add --file <json>');
    const input = readJsonFile(flags.file);
    const items = Array.isArray(input) ? input : [input];
    return st.mutate(root, (s) => {
      const added = items.map((c) => tasks.addContract(s, c));
      return { obj: added, text: `added ${added.map((c) => c.id).join(', ')}` };
    });
  },

  packet({ root, pos }) {
    if (pos[1] !== 'render') throw usage('usage: adlc packet render [T]');
    const s = st.load(root);
    const files = packets.writePackets(root, s, pos[2] ? [pos[2]] : undefined);
    return { obj: files, text: files.map((f) => path.relative(root, f)).join('\n') || 'no tasks' };
  },

  exec({ root, pos }) {
    if (pos[1] !== 'plan') throw usage('usage: adlc exec plan');
    return st.mutate(root, (s) => {
      const e = exec.planExecution(root, s);
      packets.writePackets(root, s);
      return { obj: e, text: `mode ${e.mode} (${e.reasons.join('; ')})\nwaves: ${e.waves.map((w) => w.join('+')).join(' | ') || 'none'}` };
    });
  },

  gate({ root, pos }) {
    if (pos[1] !== 'check') throw usage('usage: adlc gate check <plan|release>');
    const gate = need(pos[2], 'usage: adlc gate check <plan|release>');
    const r = gates.check(root, st.load(root), gate);
    return { obj: r, text: `${gate}: ${r.ok ? 'ok' : 'NOT OK'} — ${r.reason}`, exit: r.ok ? EXIT.OK : EXIT.RULE };
  },

  hash({ root, pos }) {
    const gate = need(pos[1], 'usage: adlc hash <plan|release>');
    const h = gates.gateHash(root, st.load(root), gate);
    return { obj: { gate, hash: h }, text: h };
  },

  approve({ root, pos, flags }) {
    const gate = need(pos[1], 'usage: adlc approve <plan|release> [--note text]');
    if (!gates.GATES.includes(gate)) throw usage(`unknown gate "${gate}" (gates: ${gates.GATES.join(', ')})`);
    const intent = userIntent.find(root, 'approve', gate);
    const s = st.load(root);
    // The approval covers what the user saw when they typed the command, not what the files hold now.
    if (intent.hash !== gates.gateHash(root, s, gate)) {
      throw rule(`the files covered by the ${gate} gate changed after the user typed /adlc:approve ${gate} (or no hash was recorded with it). Do not edit them between the prompt and the approval; ask the user to review and type /adlc:approve ${gate} again`);
    }
    const rec = gates.approve(root, s, gate, typeof flags.note === 'string' ? flags.note : '');
    userIntent.consume(root, intent);
    return { obj: rec, text: `approved ${gate} (hash ${rec.hash.slice(0, 12)})` };
  },

  run({ root, flags, rest }) {
    const s = st.load(root);
    if (flags.task) tasks.getTask(s, flags.task);
    const exclusive = Boolean(flags.exclusive) || s.execution.mode === 'shared';
    const r = evidence.run(root, { stage: flags.stage, task: flags.task || null, cmd: rest, cwd: process.cwd(), exclusive });
    return { obj: r, text: `evidence: ${r.file} exit=${r.exit}${r.exit ? ' (FAILED)' : ''}`, exit: r.exit === 0 ? EXIT.OK : EXIT.CMD_FAILED };
  },

  review({ root, pos, flags }) {
    if (pos[1] !== 'add') throw usage('usage: adlc review add --file <md>');
    const src = need(flags.file, '--file <md> is required');
    const body = fs.readFileSync(src, 'utf8');
    // The counts come from the report itself; the optional flags only cross-check them.
    const counted = rules.reviewCounts(body);
    if (counted.problems.length) throw rule(`cannot count the findings in ${src}:\n- ${counted.problems.join('\n- ')}\nAsk the reviewer for a report in the templates/review.md format; do not rewrite it yourself`);
    const { blocking, optional } = counted;
    for (const [flag, n] of [['blocking', blocking], ['optional', optional]]) {
      if (flags[flag] !== undefined && Number(flags[flag]) !== n) throw rule(`--${flag} ${flags[flag]} does not match the report, which lists ${n} ${flag} finding(s)`);
    }
    return st.mutate(root, (s) => {
      if (s.stages.review.status !== 'in_progress') throw rule('reviews can be recorded only while the review stage is in progress');
      const ts = st.now();
      const name = `reviews/${ts.replace(/\D/g, '').slice(0, 14)}.md`;
      const header = `<!-- adlc-review ${JSON.stringify({ change: s.change.id, blocking, optional, ts })} -->\n`;
      atomicWrite(path.join(st.paths(root).dir, name), header + redact(body), st.paths(root).tmp);
      s.reviews.push({ file: name, blocking, optional, ts });
      return { obj: s.reviews[s.reviews.length - 1], text: `recorded ${name}: ${blocking} blocking, ${optional} optional` };
    });
  },

  trace({ root }) {
    const s = st.load(root);
    const rows = rules.trace(root, s);
    const f = path.join(st.paths(root).dir, 'traceability.md');
    atomicWrite(f, rules.renderTrace(rows), st.paths(root).tmp);
    const missing = rows.filter((r) => !r.evidence.length).map((r) => r.ac);
    return { obj: rows, text: `wrote .agent-lifecycle/traceability.md (${rows.length} criteria${missing.length ? `; no evidence for ${missing.join(', ')}` : ''})` };
  },

  dispatch({ root, pos, flags }) {
    const sub = pos[1];
    if (sub === 'check') {
      const id = need(pos[2], 'usage: adlc dispatch check <T>');
      const problems = dispatch.checkDispatch(root, st.load(root), id);
      return { obj: { task: id, ok: !problems.length, problems }, text: problems.length ? `${id} not dispatchable:\n- ${problems.join('\n- ')}` : `${id} ready to dispatch`, exit: problems.length ? EXIT.RULE : EXIT.OK };
    }
    if (sub === 'ready') {
      const ids = dispatch.readyToDispatch(root, st.load(root)).map((t) => t.id);
      return { obj: ids, text: ids.join('\n') || 'none' };
    }
    if (sub === 'start') {
      const id = need(pos[2], 'usage: adlc dispatch start <T> [--session id]');
      const session = typeof flags.session === 'string' && !flags.session.includes('${') ? flags.session : 'unknown';
      return st.mutate(root, (s) => {
        const lease = dispatch.startDispatch(root, s, id, { session });
        const packet = packets.packetPath(root, id);
        const agent = s.execution.mode === 'worktree' ? 'adlc:developer-worktree' : 'adlc:developer';
        return { obj: { ...lease, packet, agent }, text: `dispatched ${id} lease ${lease.lease}\npacket: ${packet}\nworker agent: ${agent}` };
      });
    }
    throw usage('usage: adlc dispatch check|ready|start');
  },

  worker({ root, pos, flags }) {
    const sub = pos[1];
    const id = need(pos[2], 'usage: adlc worker claim|handoff <T> ...');
    const s = st.load(root);
    if (sub === 'claim') {
      const leaseId = need(flags.lease, '--lease <L> is required');
      const lease = s.leases.find((l) => l.lease === leaseId);
      if (!lease || lease.task !== id || lease.status !== 'active') throw rule(`lease ${leaseId} is not an active lease for ${id}; stop and report this to the coordinator`);
      const t = tasks.getTask(s, id);
      const o = { task: id, lease: leaseId, packet: packets.packetPath(root, id), state_root: root, files: t.files, checks: t.checks };
      return { obj: o, text: `claimed ${id} (${leaseId})\npacket: ${o.packet}\nwritable files (relative to your working directory): ${t.files.join(', ')}\nchecks: ${t.checks.join(' ; ')}` };
    }
    if (sub === 'handoff') {
      const f = integrate.submitHandoff(root, s, id, readJsonFile(flags.file));
      return { obj: { file: path.relative(root, f) }, text: `handoff stored: ${path.relative(root, f)}` };
    }
    throw usage('usage: adlc worker claim|handoff');
  },

  integrate({ root, pos }) {
    const sub = pos[1];
    const id = need(pos[2], 'usage: adlc integrate check|done <T>');
    if (sub === 'check') {
      return st.mutate(root, (s) => {
        const r = integrate.integrateCheck(root, s, id);
        if (r.ok) integrate.recordReturned(s, id, r);
        const text = [
          r.ok ? `${id} passed the integration check` : `${id} failed the integration check:`,
          ...r.problems.map((x) => `- ${x}`),
          ...r.warnings.map((x) => `warning: ${x}`),
          r.ok && r.commands && r.commands.length ? `next: ask the user to approve and run these exact commands (commit in the worktree, then merge into the current branch):\n${r.commands.map((c) => `  ${c}`).join('\n')}` : '',
          r.ok ? `${r.commands && r.commands.length ? 'then' : 'next:'} run each cross-task check with adlc run --stage build -- "<cmd>", then adlc integrate done ${id}:\n${r.cross_checks.map((c) => `  ${c}`).join('\n')}` : '',
        ].filter(Boolean).join('\n');
        return { obj: r, text, exit: r.ok ? EXIT.OK : EXIT.RULE };
      });
    }
    if (sub === 'done') {
      return st.mutate(root, (s) => {
        integrate.integrateDone(root, s, id);
        return { text: `${id} integrated` };
      });
    }
    throw usage('usage: adlc integrate check|done <T>');
  },

  lease({ root, pos }) {
    const sub = pos[1];
    const leaseId = need(pos[2], 'usage: adlc lease stopped|lost <L> <note>');
    const note = pos.slice(3).join(' ');
    if (sub === 'stopped') return st.mutate(root, (s) => ({ obj: dispatch.confirmStopped(root, s, leaseId, note), text: `${leaseId} confirmed stopped` }));
    if (sub === 'lost') return st.mutate(root, (s) => ({ text: `${leaseId} lost; task is now ${dispatch.markLost(s, leaseId, note)}` }));
    throw usage('usage: adlc lease stopped|lost <L> <note>');
  },

  handoff({ root, pos }) {
    const note = need(pos.slice(1).join(' '), 'usage: adlc handoff "<note>"');
    st.load(root);
    appendLine(path.join(st.paths(root).dir, 'handoff.md'), `\n## ${st.now()}\n\n${redact(note)}`);
    return { text: 'handoff note appended' };
  },

  archive({ root, flags }) {
    const s = st.load(root);
    if (stages.current(s) !== 'done' && !flags.force) throw rule(`change ${s.change.id} is not done (stage ${stages.current(s)}); use --force to archive anyway`);
    // Archiving removes state.json, which switches the hooks off: only the user decides that.
    userIntent.consume(root, userIntent.find(root, 'archive'));
    const p = st.paths(root);
    const dest = path.join(p.dir, 'archive', s.change.id);
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(p.dir)) {
      if (['archive', '.gitignore', '.lock', '.check.lock'].includes(name)) continue;
      fs.renameSync(path.join(p.dir, name), path.join(dest, name));
    }
    return { text: `archived to .agent-lifecycle/archive/${s.change.id}` };
  },
};

function main(argv) {
  try {
    const parsed = parse(argv);
    const cmd = parsed.pos[0];
    if (!cmd || cmd === 'help' || parsed.flags.help) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    const handler = handlers[cmd];
    if (!handler) throw usage(`unknown command "${cmd}"\n${HELP}`);
    const out = handler({ root: st.findRoot(), ...parsed }) || {};
    if (parsed.flags.json && out.obj !== undefined) process.stdout.write(`${JSON.stringify(out.obj, null, 2)}\n`);
    else if (out.text) process.stdout.write(`${out.text}\n`);
    process.exitCode = out.exit || 0;
  } catch (err) {
    if (err instanceof AdlcError) {
      process.stderr.write(`adlc: ${err.message}\n`);
      process.exitCode = err.exitCode;
    } else {
      process.stderr.write(`adlc: internal error: ${err && err.stack ? err.stack : err}\n`);
      process.exitCode = 70;
    }
  }
}

module.exports = { main, parse, statusObj };
