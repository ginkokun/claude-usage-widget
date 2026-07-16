// Pure, offline helpers for a future macOS Relay Station tray submenu.
//
// This module builds config defaults, validates dashboard URLs, composes
// coordinator prompts and Codex deep links, and quotes strings for a POSIX
// shell. It never touches the network or spawns processes — that wiring
// belongs to a later card.

const os = require('os');
const path = require('path');

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
  if (typeof workDescription !== 'string' || !workDescription.trim()) {
    throw new Error('workDescription must be a non-empty string');
  }

  const lines = [
    `Work: ${workDescription.trim()}`,
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
 * Build the launch payload (prompt + deep link) for a blank/cancelled work
 * description returns null instead of a malformed prompt/link.
 *
 * @param {'codex'|'claude'} target
 * @param {string} workDescription
 * @param {string} repoPath - Absolute path to the repo.
 * @returns {{prompt: string, deepLink: string}|null}
 */
function buildLaunchPayload(target, workDescription, repoPath) {
  if (typeof workDescription !== 'string' || !workDescription.trim()) {
    return null;
  }
  const prompt = buildCoordinatorPrompt(target, workDescription);
  const deepLink = buildCodexDeepLink(prompt, repoPath);
  return { prompt, deepLink };
}

module.exports = {
  getDefaultConfig,
  isValidDashboardUrl,
  buildCoordinatorPrompt,
  buildCodexDeepLink,
  posixQuote,
  buildLaunchPayload,
};
