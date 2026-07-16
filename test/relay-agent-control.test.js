const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  WORK_DESCRIPTION_MAX_CHARS,
  getDefaultConfig,
  isValidDashboardUrl,
  buildCoordinatorPrompt,
  buildCodexDeepLink,
  posixQuote,
  buildLaunchPayload,
  buildMonitorCommand,
} = require('../src/relay-agent-control.js');

test('getDefaultConfig derives relaystation_main from a supplied home path', () => {
  const config = getDefaultConfig('/Users/someoneelse');
  assert.equal(
    config.relaystationMain,
    path.join('/Users/someoneelse', 'Documents', 'Codex', 'repos', 'relaystation_main')
  );
  assert.equal(config.dashboardUrl, '');
});

test('getDefaultConfig never hardcodes a username across different homes', () => {
  const a = getDefaultConfig('/Users/alice');
  const b = getDefaultConfig('/Users/bob');
  assert.notEqual(a.relaystationMain, b.relaystationMain);
  assert.ok(a.relaystationMain.includes('alice'));
  assert.ok(b.relaystationMain.includes('bob'));
});

test('isValidDashboardUrl accepts blank (disabled) and http/https', () => {
  assert.equal(isValidDashboardUrl(''), true);
  assert.equal(isValidDashboardUrl('http://localhost:3000'), true);
  assert.equal(isValidDashboardUrl('https://example.com/dash'), true);
});

test('isValidDashboardUrl rejects bad schemes and malformed URLs', () => {
  assert.equal(isValidDashboardUrl('javascript:alert(1)'), false);
  assert.equal(isValidDashboardUrl('file:///etc/passwd'), false);
  assert.equal(isValidDashboardUrl('not a url'), false);
});

test('buildCoordinatorPrompt states autonomous execution and mandatory verification', () => {
  const prompt = buildCoordinatorPrompt('codex', 'Add a settings toggle for X');
  assert.match(prompt, /no human approval is expected/i);
  assert.match(prompt, /claude agents implement/i);
  assert.match(prompt, /docs, changelog, tests, deployment, and smoke verification/i);
  assert.match(prompt, /conserve tokens/i);
  assert.match(prompt, /narrow/i);
  assert.match(prompt, /bounded/i);
});

test('buildCoordinatorPrompt defaults claude target to Opus with high effort', () => {
  const codexPrompt = buildCoordinatorPrompt('codex', 'Do work');
  const claudePrompt = buildCoordinatorPrompt('claude', 'Do work');
  assert.doesNotMatch(codexPrompt, /Opus/);
  assert.match(claudePrompt, /Opus/);
  assert.match(claudePrompt, /high/i);
});

test('buildCoordinatorPrompt rejects blank work description', () => {
  assert.throws(() => buildCoordinatorPrompt('codex', ''));
  assert.throws(() => buildCoordinatorPrompt('codex', '   '));
});

test('buildCoordinatorPrompt accepts exactly WORK_DESCRIPTION_MAX_CHARS but rejects one over', () => {
  const atLimit = 'x'.repeat(WORK_DESCRIPTION_MAX_CHARS);
  const overLimit = 'x'.repeat(WORK_DESCRIPTION_MAX_CHARS + 1);
  assert.doesNotThrow(() => buildCoordinatorPrompt('codex', atLimit));
  assert.throws(() => buildCoordinatorPrompt('codex', overLimit));
});

test('buildCodexDeepLink uses codex://threads/new with encoded prompt and absolute path', () => {
  const prompt = 'Fix the "widget" & make it fast\nsecond line';
  const repoPath = '/Users/tester/Documents/Codex/repos/relaystation_main';
  const link = buildCodexDeepLink(prompt, repoPath);

  assert.match(link, /^codex:\/\/threads\/new\?/);

  const url = new URL(link);
  assert.equal(url.protocol, 'codex:');
  assert.equal(url.hostname, 'threads');
  assert.equal(url.pathname, '/new');
  assert.equal(url.searchParams.get('prompt'), prompt);
  assert.equal(url.searchParams.get('path'), repoPath);
});

test('buildCodexDeepLink rejects non-absolute paths and blank prompts', () => {
  assert.throws(() => buildCodexDeepLink('do work', 'relative/path'));
  assert.throws(() => buildCodexDeepLink('', '/absolute/path'));
  assert.throws(() => buildCodexDeepLink('   ', '/absolute/path'));
});

test('posixQuote handles spaces and embedded apostrophes safely', () => {
  assert.equal(posixQuote('simple'), "'simple'");
  assert.equal(posixQuote('has spaces'), "'has spaces'");
  assert.equal(posixQuote("it's a test"), "'it'\\''s a test'");
});

test('buildLaunchPayload returns null for blank/cancelled work description', () => {
  assert.equal(buildLaunchPayload('codex', '', '/some/repo'), null);
  assert.equal(buildLaunchPayload('codex', '   ', '/some/repo'), null);
  assert.equal(buildLaunchPayload('codex', undefined, '/some/repo'), null);
});

test('buildLaunchPayload returns null for an over-limit trimmed description', () => {
  const overLimit = 'x'.repeat(WORK_DESCRIPTION_MAX_CHARS + 1);
  assert.equal(buildLaunchPayload('codex', overLimit, '/some/repo'), null);
  assert.equal(buildLaunchPayload('claude', overLimit, '/some/repo'), null);
});

test('buildLaunchPayload accepts an exactly-at-limit description', () => {
  const atLimit = 'x'.repeat(WORK_DESCRIPTION_MAX_CHARS);
  const payload = buildLaunchPayload('codex', atLimit, '/some/repo');
  assert.notEqual(payload, null);
});

test('buildLaunchPayload returns {prompt, deepLink} for codex target', () => {
  const repoPath = '/Users/tester/Documents/Codex/repos/relaystation_main';
  const payload = buildLaunchPayload('codex', 'Implement the tray submenu', repoPath);
  assert.notEqual(payload, null);
  assert.match(payload.prompt, /Implement the tray submenu/);
  const url = new URL(payload.deepLink);
  assert.equal(url.searchParams.get('prompt'), payload.prompt);
  assert.equal(url.searchParams.get('path'), repoPath);
});

test('buildLaunchPayload returns only {prompt} for claude target (no deepLink)', () => {
  const payload = buildLaunchPayload('claude', 'Implement the tray submenu', '/some/repo');
  assert.notEqual(payload, null);
  assert.match(payload.prompt, /Implement the tray submenu/);
  assert.equal('deepLink' in payload, false);
  assert.deepEqual(Object.keys(payload), ['prompt']);
});

test('buildMonitorCommand builds a POSIX-safe command with the python3 interpreter', () => {
  const cmd = buildMonitorCommand('/Users/tester/Documents/Codex/repos/relaystation_main');
  assert.equal(
    cmd,
    "'/usr/bin/python3' '/Users/tester/Documents/Codex/repos/relaystation_main/scripts/agent_watch.py' 'watch'"
  );
});

test('buildMonitorCommand quotes spaces and apostrophes in the repo path', () => {
  const cmd = buildMonitorCommand("/Users/tester/My Repo's Path");
  assert.match(cmd, /'\/Users\/tester\/My Repo'\\''s Path\/scripts\/agent_watch\.py'/);
});

test('buildMonitorCommand rejects non-absolute repo paths', () => {
  assert.throws(() => buildMonitorCommand('relative/path'));
});
