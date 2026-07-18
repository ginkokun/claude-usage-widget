// Pure, offline helpers for launching a native Claude Code background session
// from the Relay Station tray submenu.
//
// This module only builds argv arrays, candidate paths, and parses JSON text
// that the caller already has in hand. It never touches the filesystem,
// spawns a process, or makes a network call — that wiring (execFile, fs
// existence checks) lives in main.js, which injects the effectful bits
// (existsSync, execFile output) into these functions as plain arguments.

const path = require('path');

/** Default model/effort/permission-mode for the Claude coordinator session. */
const DEFAULT_MODEL = 'opus';
const DEFAULT_EFFORT = 'high';
const DEFAULT_PERMISSION_MODE = 'auto';

/** Session names are passed as a single argv item, but are kept to a safe, boring charset regardless. */
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Deterministic, ordered list of absolute paths where the Claude Code CLI
 * may be installed on macOS. A Finder-launched Electron app inherits a bare
 * launchd PATH (no shell rc files sourced), so PATH lookup is not reliable —
 * every candidate here is an explicit absolute path.
 *
 * @param {string} homeDir - Absolute path to the current user's home directory.
 * @returns {string[]}
 */
function getClaudeExecutableCandidates(homeDir) {
  if (typeof homeDir !== 'string' || !path.isAbsolute(homeDir)) {
    throw new Error('homeDir must be an absolute path');
  }
  return [
    path.join(homeDir, '.local', 'bin', 'claude'), // native install script (curl | bash) default
    '/opt/homebrew/bin/claude', // Homebrew, Apple Silicon
    '/usr/local/bin/claude', // Homebrew (Intel) / npm global default prefix
  ];
}

/**
 * Pick the first candidate that exists on disk. The existence check itself
 * is injected so this function stays a pure, offline decision given its
 * inputs — main.js passes fs.existsSync in production and a fake in tests.
 *
 * @param {string[]} candidates - Absolute paths, checked in order.
 * @param {(candidate: string) => boolean} existsFn
 * @returns {string|null}
 */
function resolveClaudeExecutable(candidates, existsFn) {
  if (!Array.isArray(candidates) || typeof existsFn !== 'function') {
    throw new Error('candidates must be an array and existsFn a function');
  }
  for (const candidate of candidates) {
    if (existsFn(candidate)) return candidate;
  }
  return null;
}

/**
 * Derive a safe, useful session name from the work description: lowercase,
 * non-alphanumeric runs collapsed to a single dash, trimmed, truncated, and
 * prefixed so it reads clearly in `claude agents` / the /resume picker.
 * Falls back to a fixed name when the description slugifies to nothing
 * (e.g. all-emoji or all-punctuation input).
 *
 * @param {string} workDescription
 * @returns {string}
 */
function buildSessionName(workDescription) {
  const trimmed = typeof workDescription === 'string' ? workDescription.trim() : '';
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const name = slug ? `relay-claude-${slug}` : 'relay-claude-coordinator';
  return name.slice(0, 64);
}

/**
 * Build the argv array (no shell involved — this is passed straight to
 * execFile) that dispatches the coordinator prompt as a new Claude Code
 * background session: given model/effort/permission-mode, a display name,
 * and the prompt as the initial message. A `--` end-of-options separator
 * precedes the prompt so a work description starting with "-" (e.g.
 * "--dangerously-skip-permissions") is always read as literal prompt text,
 * never reinterpreted as a CLI flag by the argv parser.
 *
 * @param {object} options
 * @param {string} options.prompt - Non-blank coordinator prompt.
 * @param {string} options.sessionName - Must match SESSION_NAME_PATTERN.
 * @param {string} [options.model]
 * @param {string} [options.effort]
 * @param {string} [options.permissionMode]
 * @returns {string[]}
 */
function buildClaudeBackgroundLaunchArgs(options) {
  const {
    prompt,
    sessionName,
    model = DEFAULT_MODEL,
    effort = DEFAULT_EFFORT,
    permissionMode = DEFAULT_PERMISSION_MODE,
  } = options || {};

  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt must be a non-empty string');
  }
  if (typeof sessionName !== 'string' || !SESSION_NAME_PATTERN.test(sessionName)) {
    throw new Error('sessionName must match SESSION_NAME_PATTERN');
  }

  return [
    '--bg',
    '--model', model,
    '--effort', effort,
    '--permission-mode', permissionMode,
    '--name', sessionName,
    '--', // end-of-options: the prompt is user-controlled and may start with "-"
    prompt,
  ];
}

/**
 * Parse the stdout of `claude agents --json`. Returns an empty array for
 * anything that isn't a JSON array (missing CLI feature, empty output,
 * malformed text) instead of throwing — session-identity lookup is a
 * best-effort confirmation step, never a reason to report failure.
 *
 * @param {string} stdout
 * @returns {Array<object>}
 */
function parseAgentsJson(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Find the most recently started session matching a given display name in
 * a `claude agents --json` listing (there could be a stale entry from an
 * earlier run with the same name).
 *
 * @param {Array<object>} sessions
 * @param {string} sessionName
 * @returns {object|null}
 */
function findLaunchedSession(sessions, sessionName) {
  if (!Array.isArray(sessions)) return null;
  const matches = sessions.filter((entry) => entry && entry.name === sessionName);
  if (!matches.length) return null;
  return matches.reduce((latest, entry) => (
    !latest || (entry.startedAt || 0) > (latest.startedAt || 0) ? entry : latest
  ), null);
}

module.exports = {
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
};
