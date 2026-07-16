// Pure, offline helpers for a future macOS Relay Station tray submenu.
//
// This module builds config defaults, validates dashboard URLs, composes
// coordinator prompts and Codex deep links, and quotes strings for a POSIX
// shell. It never touches the network or spawns processes — that wiring
// belongs to a later card.

const os = require('os');
const path = require('path');

/** Maximum accepted length (after trimming) of a work description. */
const WORK_DESCRIPTION_MAX_CHARS = 2000;

/**
 * Default tray config. relaystation_main is always derived from the current
 * user's home directory — never hardcoded — so this works for any user.
 *
 * @param {string} [home] - Home directory override (defaults to os.homedir()).
 * @returns {{relaystationMain: string, dashboardUrl: string}}
 */
function getDefaultConfig(home) {
  const homeDir = home || os.homedir();
  return {
    relaystationMain: path.join(homeDir, 'Documents', 'Codex', 'repos', 'relaystation_main'),
    dashboardUrl: '',
  };
}

/**
 * Validate a dashboard URL. Blank means the dashboard link is disabled.
 * Only http:/https: schemes are accepted; anything else (javascript:,
 * file:, malformed strings) is rejected.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isValidDashboardUrl(url) {
  if (url == null || url === '') return true;
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Compose the coordinator prompt sent to a Codex or Claude agent, given a
 * bounded work description. Always states: no human approval is expected
 * during execution, Claude agents implement while the coordinator reviews,
 * docs/changelog/tests/deployment/smoke verification are mandatory, and
 * cards/turns should stay narrow to conserve tokens.
 *
 * @param {'codex'|'claude'} target
 * @param {string} workDescription - Non-empty, bounded description of the work.
 * @returns {string}
 */
function buildCoordinatorPrompt(target, workDescription) {
  if (target !== 'codex' && target !== 'claude') {
    throw new Error(`Unsupported coordinator target: ${target}`);
  }
  const trimmed = typeof workDescription === 'string' ? workDescription.trim() : '';
  if (!trimmed) {
    throw new Error('workDescription must be a non-empty string');
  }
  if (trimmed.length > WORK_DESCRIPTION_MAX_CHARS) {
    throw new Error(`workDescription must be at most ${WORK_DESCRIPTION_MAX_CHARS} characters`);
  }

  const lines = [
    `Work: ${trimmed}`,
    '',
    'No human approval is expected during execution: proceed autonomously through the work.',
    'Claude agents implement the changes while the coordinator reviews the results.',
    'Docs, changelog, tests, deployment, and smoke verification are mandatory before this is done.',
    'Conserve tokens: keep cards narrow in scope and turns bounded.',
  ];

  if (target === 'claude') {
    lines.push('Coordinator model: Opus, effort: high.');
  }

  return lines.join('\n');
}

/**
 * Build the official Codex deep link (codex://threads/new) carrying the
 * encoded prompt and the absolute repo path as query parameters.
 *
 * @param {string} prompt - Non-blank prompt text.
 * @param {string} repoPath - Absolute path to the repo.
 * @returns {string}
 */
function buildCodexDeepLink(prompt, repoPath) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt must be a non-empty string');
  }
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) {
    throw new Error('repoPath must be an absolute path');
  }

  const url = new URL('codex://threads/new');
  url.searchParams.set('prompt', prompt);
  url.searchParams.set('path', repoPath);
  return url.toString();
}

/**
 * Quote a string as a single POSIX shell argument, safe for spaces and
 * embedded apostrophes. Does not execute anything — pure string helper for
 * a later launcher-generation card.
 *
 * @param {string} value
 * @returns {string}
 */
function posixQuote(value) {
  const str = String(value);
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the launch payload for a coordinator target. Returns null (instead
 * of a malformed prompt/link) for a blank/cancelled or over-limit work
 * description. The Codex payload includes a deepLink; the Claude payload
 * only carries the prompt, since it is launched by copy/paste, not a link.
 *
 * @param {'codex'|'claude'} target
 * @param {string} workDescription
 * @param {string} [repoPath] - Absolute path to the repo (required for codex).
 * @returns {{prompt: string, deepLink: string}|{prompt: string}|null}
 */
function buildLaunchPayload(target, workDescription, repoPath) {
  const trimmed = typeof workDescription === 'string' ? workDescription.trim() : '';
  if (!trimmed || trimmed.length > WORK_DESCRIPTION_MAX_CHARS) {
    return null;
  }
  const prompt = buildCoordinatorPrompt(target, trimmed);

  if (target === 'codex') {
    const deepLink = buildCodexDeepLink(prompt, repoPath);
    return { prompt, deepLink };
  }
  return { prompt };
}

/**
 * Build the pure command string for launching the agent watch monitor in a
 * terminal, quoting the interpreter and script path/argument POSIX-safely.
 *
 * @param {string} repoPath - Absolute path to the repo.
 * @returns {string}
 */
function buildMonitorCommand(repoPath) {
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) {
    throw new Error('repoPath must be an absolute path');
  }
  const scriptPath = path.join(repoPath, 'scripts', 'agent_watch.py');
  return [posixQuote('/usr/bin/python3'), posixQuote(scriptPath), posixQuote('watch')].join(' ');
}

module.exports = {
  WORK_DESCRIPTION_MAX_CHARS,
  getDefaultConfig,
  isValidDashboardUrl,
  buildCoordinatorPrompt,
  buildCodexDeepLink,
  posixQuote,
  buildLaunchPayload,
  buildMonitorCommand,
};
