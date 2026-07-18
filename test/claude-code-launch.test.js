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
  parseBgLaunchStdout,
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

test('buildSessionName slugifies the work description, prefixes it, and appends the suffix', () => {
  assert.equal(buildSessionName('Fix the tray menu bug', 'ab12cd34'), 'relay-claude-fix-the-tray-menu-bug-ab12cd34');
  assert.equal(buildSessionName('  Add F-2 support!! ', 'ab12cd34'), 'relay-claude-add-f-2-support-ab12cd34');
});

test('buildSessionName falls back to a fixed base when the slug is empty (ASCII punctuation)', () => {
  assert.equal(buildSessionName('!!! ??? ###', 'ab12cd34'), 'relay-claude-coordinator-ab12cd34');
  assert.equal(buildSessionName('', 'ab12cd34'), 'relay-claude-coordinator-ab12cd34');
  assert.equal(buildSessionName(undefined, 'ab12cd34'), 'relay-claude-coordinator-ab12cd34');
});

test('buildSessionName distinguishes non-Latin work descriptions via the suffix, not the slug', () => {
  // The slugifier only keeps [a-z0-9], so Cyrillic (and CJK, emoji, ...)
  // descriptions all collapse to the same empty slug/base — the suffix is
  // what actually keeps two Russian-language missions apart.
  const first = buildSessionName('Почини баг в трее', 'aaaaaaaa');
  const second = buildSessionName('Добавь настройки флота', 'bbbbbbbb');
  assert.equal(first, 'relay-claude-coordinator-aaaaaaaa');
  assert.equal(second, 'relay-claude-coordinator-bbbbbbbb');
  assert.notEqual(first, second);
});

test('buildSessionName gives two concurrent identical descriptions distinct names via distinct suffixes', () => {
  const a = buildSessionName('Fix the same bug', 'aaaaaaaa');
  const b = buildSessionName('Fix the same bug', 'bbbbbbbb');
  assert.notEqual(a, b);
});

test('buildSessionName truncates the slug/base — never the suffix — to stay within the safe charset', () => {
  const name = buildSessionName('x'.repeat(200), 'deadbeef');
  assert.ok(name.length <= 64);
  assert.match(name, SESSION_NAME_PATTERN);
  assert.ok(name.endsWith('-deadbeef'));
});

test('buildSessionName output always matches SESSION_NAME_PATTERN', () => {
  const cases = ['Normal case', 'émoji 🎉 test', '---', 'A', 'a'.repeat(500), 'Русский текст'];
  for (const c of cases) {
    assert.match(buildSessionName(c, 'ab12cd34'), SESSION_NAME_PATTERN, `failed for: ${c}`);
  }
});

test('buildSessionName rejects a missing or malformed uniqueSuffix', () => {
  assert.throws(() => buildSessionName('do work', ''));
  assert.throws(() => buildSessionName('do work', undefined));
  assert.throws(() => buildSessionName('do work', 'ab')); // too short
  assert.throws(() => buildSessionName('do work', 'has spaces'));
  assert.throws(() => buildSessionName('do work', '--injected'));
});

test('buildClaudeBackgroundLaunchArgs builds the expected argv with defaults', () => {
  const args = buildClaudeBackgroundLaunchArgs({ prompt: 'Work: do the thing', sessionName: 'relay-claude-do-the-thing' });
  assert.deepEqual(args, [
    '--bg',
    '--model', DEFAULT_MODEL,
    '--effort', DEFAULT_EFFORT,
    '--permission-mode', DEFAULT_PERMISSION_MODE,
    '--name', 'relay-claude-do-the-thing',
    '--',
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
    '--',
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
  // A prompt starting with "-" must always land after a "--" end-of-options
  // separator, so the CLI's own argv parser reads it as literal text, never
  // as a flag it happens to match.
  const args = buildClaudeBackgroundLaunchArgs({ prompt: '--dangerously-skip-permissions', sessionName: 'relay-claude-x' });
  assert.equal(args[args.length - 1], '--dangerously-skip-permissions');
  assert.equal(args[args.length - 2], '--');
  assert.equal(args.filter((a) => a === '--dangerously-skip-permissions').length, 1);
});

test('buildClaudeBackgroundLaunchArgs always separates flags from the prompt with "--"', () => {
  const prompts = ['-x', '--model', '--', '---weird', 'normal text'];
  for (const prompt of prompts) {
    const args = buildClaudeBackgroundLaunchArgs({ prompt, sessionName: 'relay-claude-x' });
    assert.equal(args[args.length - 2], '--', `expected "--" right before the prompt for: ${prompt}`);
    assert.equal(args[args.length - 1], prompt);
    assert.equal(args.length, 11);
  }
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

test('parseBgLaunchStdout parses the plain-text confirmation line with an id and a name', () => {
  const stdout = [
    'backgrounded · 7bfd7dd7 · relay-claude-fix-the-tray-menu-bug-ab12cd34',
    '  claude agents               list sessions',
    '  claude attach 7bfd7dd7      open in this terminal',
    '  claude logs 7bfd7dd7        show recent output',
    '  claude stop 7bfd7dd7        stop this session',
    '',
  ].join('\n');
  assert.deepEqual(parseBgLaunchStdout(stdout), {
    shortId: '7bfd7dd7',
    name: 'relay-claude-fix-the-tray-menu-bug-ab12cd34',
  });
});

test('parseBgLaunchStdout parses the id-only form (no name given)', () => {
  const stdout = 'backgrounded · a1b2c3d4\n  claude agents               list sessions\n';
  assert.deepEqual(parseBgLaunchStdout(stdout), { shortId: 'a1b2c3d4', name: null });
});

test('parseBgLaunchStdout strips ANSI color codes before matching', () => {
  const stdout = '\x1b[36mbackgrounded · \x1b[36m7bfd7dd7\x1b[39m · relay-claude-x-ab12cd34\x1b[39m\n';
  assert.deepEqual(parseBgLaunchStdout(stdout), { shortId: '7bfd7dd7', name: 'relay-claude-x-ab12cd34' });
});

test('parseBgLaunchStdout finds the confirmation line even if other output precedes it', () => {
  const stdout = 'some unrelated daemon status line\n\nbackgrounded · deadbeef · relay-claude-x-ab12cd34\n';
  assert.deepEqual(parseBgLaunchStdout(stdout), { shortId: 'deadbeef', name: 'relay-claude-x-ab12cd34' });
});

test('parseBgLaunchStdout returns null for unrecognized output instead of throwing', () => {
  assert.equal(parseBgLaunchStdout(''), null);
  assert.equal(parseBgLaunchStdout('something else entirely\n'), null);
  assert.equal(parseBgLaunchStdout('backgrounding is not the same word\n'), null);
});
