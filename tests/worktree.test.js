'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PLUGIN, tmpdir, cli, hook, ok, writeFile, toBuild, TASK, lib } = require('./helpers');

const wt = lib('worktree');

function sh(cwd, cmd) {
  const r = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

// adlc run from a directory without ADLC_ROOT, the way a worker in a worktree runs it.
function cliFrom(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_') || k.startsWith('ADLC_')) delete env[k];
  return spawnSync(process.execPath, [path.join(PLUGIN, 'bin', 'adlc'), ...args], { cwd, encoding: 'utf8', env });
}

function repo({ baseRef = 'head', ignore = true } = {}) {
  const root = tmpdir();
  sh(root, 'git init -q -b main && git config user.email t@example.invalid && git config user.name t');
  writeFile(root, 'package.json', '{"name":"demo","private":true}\n');
  if (ignore) writeFile(root, '.gitignore', '.claude/worktrees/\n');
  if (baseRef) writeFile(root, '.claude/settings.json', JSON.stringify({ worktree: { baseRef } }));
  sh(root, 'git add -A && git commit -qm init');
  return root;
}

const TWO = [
  TASK({ title: 'A', files: ['src/a.js'], checks: ['test -f src/a.js'] }),
  TASK({ title: 'B', files: ['src/b.js'], checks: ['test -f src/b.js'] }),
];

test('worktree preconditions are reported and auto falls back to shared', () => {
  const root = repo({ baseRef: null, ignore: false });
  writeFile(root, 'dirty.txt', 'x');
  const p = wt.worktreeProblems(root);
  assert.ok(p.some((x) => /worktree\.baseRef/.test(x)));
  assert.ok(p.some((x) => /not git-ignored/.test(x)));
  assert.ok(p.some((x) => /uncommitted changes .*dirty\.txt/.test(x)));
  assert.deepEqual(wt.worktreeProblems(tmpdir()), ['not a git repository with at least one commit']);
  fs.unlinkSync(path.join(root, 'dirty.txt'));
  toBuild(root, TWO, { mode: 'auto' });
  const s = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(s.execution.mode, 'shared');
  assert.match(s.execution.reasons[1], /worktree mode unavailable/);
});

test('linkedWorktree finds the main checkout from inside a worktree', () => {
  const root = repo();
  sh(root, 'git worktree add -q -b wt-x .claude/worktrees/x HEAD');
  const inside = path.join(root, '.claude/worktrees/x');
  fs.mkdirSync(path.join(inside, 'deep'), { recursive: true });
  assert.deepEqual(wt.linkedWorktree(path.join(inside, 'deep')), { worktreeRoot: fs.realpathSync(inside), mainRoot: root });
  assert.equal(wt.linkedWorktree(root), null);
});

test('worktree mode: isolated workers, scoped writes, approved commit and merge, merge-gated integration', () => {
  const root = repo();
  toBuild(root, TWO, { mode: 'auto' });
  const s = JSON.parse(ok(cli(root, ['status', '--json'])));
  assert.equal(s.execution.mode, 'worktree');
  assert.match(s.execution.reasons[1], /own git worktree/);
  // Commit adlc state so the worktrees carry a stale copy; workers must still use the main checkout's state.
  sh(root, 'git add -A && git commit -qm "adlc plan approved"');

  const d1 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's', '--json'])));
  const d2 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T2', '--session', 's', '--json'])));
  assert.equal(d1.agent, 'adlc:developer-worktree');
  assert.equal(d1.packet, path.join(root, '.agent-lifecycle/packets/T1.md'));

  const workers = [['T1', d1.lease, 'a1', 'src/a.js'], ['T2', d2.lease, 'a2', 'src/b.js']].map(([task, lease, agent, file]) => {
    // What the platform does for `isolation: worktree` with baseRef "head".
    sh(root, `git worktree add -q -b wt-${task} .claude/worktrees/${task} HEAD`);
    const ws = path.join(root, '.claude/worktrees', task);
    return { task, lease, file, ws, who: { agent_id: agent, agent_type: 'adlc:developer-worktree', cwd: ws } };
  });

  for (const w of workers) {
    const claim = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `adlc worker claim ${w.task} --lease ${w.lease}` }, ...w.who };
    hook('guard', claim, root);
    const out = ok(cliFrom(w.ws, ['worker', 'claim', w.task, '--lease', w.lease]));
    assert.match(out, new RegExp(`packet: ${root.replace(/[/.]/g, '\\$&')}/\\.agent-lifecycle/packets/${w.task}\\.md`), 'state comes from the main checkout');
  }

  const [w1, w2] = workers;
  const write = (w, abs) => ({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: abs, content: 'x' }, ...w.who });
  const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null);
  assert.equal(decision(hook('guard', write(w1, path.join(w1.ws, 'src/a.js')), root)), null, 'own file in own worktree');
  assert.equal(decision(hook('guard', write(w1, path.join(root, 'src/a.js')), root)), 'deny', 'main checkout is off limits');
  assert.equal(decision(hook('guard', write(w1, path.join(w2.ws, 'src/a.js')), root)), 'deny', "another worker's worktree is off limits");
  assert.equal(decision(hook('guard', write(w1, path.join(w1.ws, 'src/b.js')), root)), 'deny', "another task's file");
  assert.equal(decision(hook('guard', write(w1, path.join(w1.ws, '.agent-lifecycle/state.json')), root)), 'deny', 'stale state copy is protected');

  for (const w of workers) {
    writeFile(w.ws, w.file, `// ${w.task}\n`);
    hook('audit', { ...write(w, path.join(w.ws, w.file)), hook_event_name: 'PostToolUse' }, root);
    const ev = JSON.parse(ok(cliFrom(w.ws, ['run', '--stage', 'build', '--task', w.task, '--json', '--', `test -f ${w.file}`])));
    assert.equal(ev.exit, 0);
    assert.ok(fs.existsSync(path.join(root, '.agent-lifecycle', ev.file)), 'evidence lands in the main checkout');
    writeFile(w.ws, `.agent-lifecycle/tmp/handoff-${w.task}.json`, JSON.stringify({
      task: w.task, status: 'done', workspace: w.ws, branch: null, files_changed: [w.file], summary: 'done',
      checks: [{ cmd: `test -f ${w.file}`, exit: 0, evidence: ev.file }], interface_changes: [], blockers: [], integration_notes: '', out_of_scope: [],
    }));
    ok(cliFrom(w.ws, ['worker', 'handoff', w.task, '--file', `.agent-lifecycle/tmp/handoff-${w.task}.json`]));
    hook('subagent-stop', { hook_event_name: 'SubagentStop', ...w.who }, root);
  }
  const writes = fs.readFileSync(path.join(root, '.agent-lifecycle/runs/writes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(writes.map((x) => [x.path, x.workspace]), [['src/a.js', fs.realpathSync(w1.ws)], ['src/b.js', fs.realpathSync(w2.ws)]]);

  for (const w of workers) {
    const check = JSON.parse(ok(cli(root, ['integrate', 'check', w.task, '--json'])));
    assert.deepEqual(check.problems, []);
    assert.equal(check.branch, `wt-${w.task}`);
    assert.equal(check.commands.length, 3);
    assert.match(check.commands[1], /git -C '.*' commit -m 'adlc\(T\d\): [AB]'/);
    const early = cli(root, ['integrate', 'done', w.task]);
    assert.equal(early.status, 2);
    assert.match(early.stderr, /not committed yet/);
    sh(root, check.commands[0]); sh(root, check.commands[1]);
    assert.match(cli(root, ['integrate', 'done', w.task]).stderr, /is not merged into the current branch/);
    sh(root, check.commands[2]); // the user approves each exact command
    // a later check (for example from a new session) sees the merge and points at the next step instead of failing
    const again = JSON.parse(ok(cli(root, ['integrate', 'check', w.task, '--json'])));
    assert.deepEqual(again.problems, []);
    assert.deepEqual(again.commands, []);
    assert.match(again.warnings.join('\n'), /already committed and merged/);
    const nx = JSON.parse(ok(cli(root, ['next', '--json'])));
    assert.match(nx.in_flight.find((x) => x.id === w.task).next, /adlc integrate done/);
    ok(cli(root, ['run', '--stage', 'build', '--', 'test -f src/a.js']));
    if (w.task === 'T2') ok(cli(root, ['run', '--stage', 'build', '--', 'test -f src/b.js']));
    ok(cli(root, ['integrate', 'done', w.task]));
  }
  assert.ok(fs.existsSync(path.join(root, 'src/a.js')) && fs.existsSync(path.join(root, 'src/b.js')));
  ok(cli(root, ['stage', 'complete', 'build']));
});

test('worktree mode refuses dispatch while the main checkout has uncommitted changes', () => {
  const root = repo();
  toBuild(root, TWO, { mode: 'auto' });
  writeFile(root, 'notes.txt', 'x');
  const r = cli(root, ['dispatch', 'check', 'T1']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /worktree mode precondition: uncommitted changes .*notes\.txt/);
});

test('integration rejects worktree changes outside the task', () => {
  const root = repo();
  toBuild(root, TWO, { mode: 'auto' });
  const d1 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's', '--json'])));
  sh(root, 'git worktree add -q -b wt-T1 .claude/worktrees/T1 HEAD');
  const ws = path.join(root, '.claude/worktrees/T1');
  writeFile(ws, 'src/a.js', 'x');
  writeFile(ws, 'README.md', 'sneaky');
  const earlier = new Date(Date.now() - 5000);
  fs.utimesSync(path.join(ws, 'README.md'), earlier, earlier);
  const ev = JSON.parse(ok(cliFrom(ws, ['run', '--stage', 'build', '--task', 'T1', '--json', '--', 'test -f src/a.js'])));
  writeFile(ws, '.agent-lifecycle/tmp/h.json', JSON.stringify({
    task: 'T1', status: 'done', workspace: ws, branch: null, files_changed: ['src/a.js'], summary: 'done',
    checks: [{ cmd: 'test -f src/a.js', exit: 0, evidence: ev.file }], interface_changes: [], blockers: [], integration_notes: '', out_of_scope: [],
  }));
  ok(cliFrom(ws, ['worker', 'handoff', 'T1', '--file', '.agent-lifecycle/tmp/h.json']));
  ok(cli(root, ['lease', 'stopped', d1.lease, 'test']));
  const r = cli(root, ['integrate', 'check', 'T1']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /outside T1's writable set: README\.md/);
});

test('worktree integration leaves out files a check run wrote and still requires a commit of the task change', () => {
  const root = repo();
  toBuild(root, TWO, { mode: 'auto' });
  const d1 = JSON.parse(ok(cli(root, ['dispatch', 'start', 'T1', '--session', 's', '--json'])));
  sh(root, 'git worktree add -q -b wt-T1 .claude/worktrees/T1 HEAD');
  const ws = path.join(root, '.claude/worktrees/T1');
  writeFile(ws, 'src/a.js', 'x');
  // the check itself writes coverage output, as `pretest` scripts do
  const ev = JSON.parse(ok(cliFrom(ws, ['run', '--stage', 'build', '--task', 'T1', '--json', '--', 'test -f src/a.js && mkdir -p coverage && echo x > coverage/lcov.info'])));
  ok(cliFrom(ws, ['run', '--stage', 'build', '--task', 'T1', '--', 'test -f src/a.js']));
  writeFile(ws, '.agent-lifecycle/tmp/h.json', JSON.stringify({
    task: 'T1', status: 'done', workspace: ws, branch: null, files_changed: ['src/a.js'], summary: 'done',
    checks: [{ cmd: ev.cmd, exit: 0, evidence: ev.file }], interface_changes: [], blockers: [], integration_notes: '', out_of_scope: [],
  }));
  ok(cliFrom(ws, ['worker', 'handoff', 'T1', '--file', '.agent-lifecycle/tmp/h.json']));
  ok(cli(root, ['lease', 'stopped', d1.lease, 'test']));
  const out = JSON.parse(ok(cli(root, ['integrate', 'check', 'T1', '--json'])));
  assert.deepEqual(out.problems, []);
  assert.ok(out.warnings.some((w) => /left out of the commit.*coverage\/lcov\.info/.test(w)));
  assert.ok(out.commands[0].includes('src/a.js') && !out.commands[0].includes('coverage'), out.commands[0]);
});
