const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  DEFAULT_PERMISSION_MODE,
  SESSION_NAME_PATTERN,
  getClaudeExecutableCandidates,
  resolveClaudeExecutable,
  buildSessionName,
  buildClaudeBackgroundLaunchArgs,
  parseAgentsJson,
  findLaunchedSession,
} = require('../src/claude-code-launch.js');

test('getClaudeExecutableCandidates derives the native-install path from home and includes Homebrew paths', () => {
  const candidates = getClaudeExecutableCandidates('/Users/alice');
  assert.deepEqual(candidates, [
    '/Users/alice/.local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]);
});

test('getClaudeExecutableCandidates rejects a non-absolute home dir', () => {
  assert.throws(() => getClaudeExecutableCandidates('alice'));
});

test('resolveClaudeExecutable returns the first candidate that exists', () => {
  const candidates = ['/a/claude', '/b/claude', '/c/claude'];
  const exists = (p) => p === '/b/claude';
  assert.equal(resolveClaudeExecutable(candidates, exists), '/b/claude');
});

test('resolveClaudeExecutable returns null when nothing exists', () => {
  const candidates = ['/a/claude', '/b/claude'];
  assert.equal(resolveClaudeExecutable(candidates, () => false), null);
});

test('resolveClaudeExecutable checks candidates in order (first match wins)', () => {
  const seen = [];
  const exists = (p) => {
    seen.push(p);
    return p === '/a/claude';
  };
  resolveClaudeExecutable(['/a/claude', '/b/claude'], exists);
  assert.deepEqual(seen, ['/a/claude']);
});

test('buildSessionName slugifies the work description and prefixes it', () => {
  assert.equal(buildSessionName('Fix the tray menu bug'), 'relay-claude-fix-the-tray-menu-bug');
  assert.equal(buildSessionName('  Add F-2 support!! '), 'relay-claude-add-f-2-support');
});

test('buildSessionName falls back to a fixed name when the slug is empty', () => {
  assert.equal(buildSessionName('!!! ??? ###'), 'relay-claude-coordinator');
  assert.equal(buildSessionName(''), 'relay-claude-coordinator');
  assert.equal(buildSessionName(undefined), 'relay-claude-coordinator');
});

test('buildSessionName truncates long descriptions and stays within the safe charset', () => {
  const name = buildSessionName('x'.repeat(200));
  assert.ok(name.length <= 64);
  assert.match(name, SESSION_NAME_PATTERN);
});

test('buildSessionName output always matches SESSION_NAME_PATTERN', () => {
  const cases = ['Normal case', 'émoji 🎉 test', '---', 'A', 'a'.repeat(500)];
  for (const c of cases) {
    assert.match(buildSessionName(c), SESSION_NAME_PATTERN, `failed for: ${c}`);
  }
});

test('buildClaudeBackgroundLaunchArgs builds the expected argv with defaults', () => {
  const args = buildClaudeBackgroundLaunchArgs({ prompt: 'Work: do the thing', sessionName: 'relay-claude-do-the-thing' });
  assert.deepEqual(args, [
    '--bg',
    '--model', DEFAULT_MODEL,
    '--effort', DEFAULT_EFFORT,
    '--permission-mode', DEFAULT_PERMISSION_MODE,
    '--name', 'relay-claude-do-the-thing',
    'Work: do the thing',
  ]);
});

test('buildClaudeBackgroundLaunchArgs honors explicit overrides', () => {
  const args = buildClaudeBackgroundLaunchArgs({
    prompt: 'do it',
    sessionName: 'relay-claude-x',
    model: 'sonnet',
    effort: 'medium',
    permissionMode: 'acceptEdits',
  });
  assert.deepEqual(args, [
    '--bg',
    '--model', 'sonnet',
    '--effort', 'medium',
    '--permission-mode', 'acceptEdits',
    '--name', 'relay-claude-x',
    'do it',
  ]);
});

test('buildClaudeBackgroundLaunchArgs rejects a blank prompt', () => {
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: '', sessionName: 'relay-claude-x' }));
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: '   ', sessionName: 'relay-claude-x' }));
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ sessionName: 'relay-claude-x' }));
});

test('buildClaudeBackgroundLaunchArgs rejects a session name outside the safe pattern', () => {
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: 'do it', sessionName: '' }));
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: 'do it', sessionName: '-leading-dash' }));
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: 'do it', sessionName: 'has spaces' }));
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: 'do it', sessionName: 'has;semicolon' }));
  assert.throws(() => buildClaudeBackgroundLaunchArgs({ prompt: 'do it', sessionName: '$(rm -rf ~)' }));
});

test('buildClaudeBackgroundLaunchArgs never lets prompt content be treated as a flag', () => {
  // A prompt starting with "--" must still land as the trailing positional
  // argv item, never merged into the flag list ahead of it.
  const args = buildClaudeBackgroundLaunchArgs({ prompt: '--dangerously-skip-permissions', sessionName: 'relay-claude-x' });
  assert.equal(args[args.length - 1], '--dangerously-skip-permissions');
  assert.equal(args.filter((a) => a === '--dangerously-skip-permissions').length, 1);
});

test('parseAgentsJson parses a well-formed JSON array', () => {
  const stdout = JSON.stringify([{ name: 'a', sessionId: '1' }]);
  assert.deepEqual(parseAgentsJson(stdout), [{ name: 'a', sessionId: '1' }]);
});

test('parseAgentsJson returns [] for malformed JSON, empty string, or a non-array value', () => {
  assert.deepEqual(parseAgentsJson('not json'), []);
  assert.deepEqual(parseAgentsJson(''), []);
  assert.deepEqual(parseAgentsJson('{"not":"an array"}'), []);
});

test('findLaunchedSession finds the entry by name', () => {
  const sessions = [
    { name: 'other', sessionId: 'x', startedAt: 100 },
    { name: 'relay-claude-do-thing', sessionId: 'abc', pid: 123, startedAt: 200 },
  ];
  const found = findLaunchedSession(sessions, 'relay-claude-do-thing');
  assert.equal(found.sessionId, 'abc');
  assert.equal(found.pid, 123);
});

test('findLaunchedSession returns null when no entry matches', () => {
  assert.equal(findLaunchedSession([{ name: 'other' }], 'relay-claude-x'), null);
  assert.equal(findLaunchedSession([], 'relay-claude-x'), null);
});

test('findLaunchedSession picks the most recently started match when there are stale duplicates', () => {
  const sessions = [
    { name: 'relay-claude-x', sessionId: 'old', startedAt: 100 },
    { name: 'relay-claude-x', sessionId: 'new', startedAt: 200 },
  ];
  assert.equal(findLaunchedSession(sessions, 'relay-claude-x').sessionId, 'new');
});

test('findLaunchedSession handles a non-array input gracefully', () => {
  assert.equal(findLaunchedSession(null, 'relay-claude-x'), null);
  assert.equal(findLaunchedSession(undefined, 'relay-claude-x'), null);
});
