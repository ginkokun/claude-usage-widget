// Fleet transport (F-2): independent poll of the F-1 safe-snapshot outbox and a
// best-effort push to the fleet aggregator.
//
// This module is a PURE Node module — no Electron import, unit-testable under
// `node --test` with no live network. It is deliberately separate from, and
// never touches, src/push-to-rsm4.js: that RSM-4 usage push stays a wholly
// unrelated path.
//
// The outbox itself is produced elsewhere (agent_watch.py, F-1). A missing or
// corrupt outbox file simply means "nothing to push" — never an error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;

/**
 * Resolve the F-1 outbox path exactly like agent_watch.state_dir():
 *   $AGENT_WATCH_STATE_DIR || $XDG_STATE_HOME/relay-agent-watch || ~/.local/state/relay-agent-watch
 * then join "fleet_snapshot.json".
 *
 * @param {{env?: NodeJS.ProcessEnv, homedir?: () => string}} [opts]
 * @returns {string}
 */
function resolveOutboxPath({ env = process.env, homedir = os.homedir } = {}) {
  const base =
    env.AGENT_WATCH_STATE_DIR ||
    (env.XDG_STATE_HOME ? path.join(env.XDG_STATE_HOME, 'relay-agent-watch') : null) ||
    path.join(homedir(), '.local', 'state', 'relay-agent-watch');
  return path.join(base, 'fleet_snapshot.json');
}

/**
 * Fail-safe read + parse of the outbox file. A missing file, an unreadable
 * file, or malformed JSON all resolve to null — "nothing to push" — never a
 * thrown error.
 *
 * @param {string} outboxPath
 * @param {{fs?: typeof fs}} [opts]
 * @returns {object|null}
 */
function readFleetSnapshot(outboxPath, { fs: fsImpl = fs } = {}) {
  let raw;
  try {
    raw = fsImpl.readFileSync(outboxPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Recursively sort object keys so the same logical snapshot always serializes
 * to the same string, regardless of property insertion order.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Content hash of a snapshot for material-change detection — sha256 of the
 * canonical (key-sorted) JSON serialization.
 *
 * @param {object} snapshot
 * @returns {string} hex digest
 */
function computeContentHash(snapshot) {
  const json = JSON.stringify(canonicalize(snapshot));
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Stamp the transport-identity fields (emitter_epoch + seq, minted by the
 * widget, never by the F-1 outbox itself) onto the machine-heartbeat block of
 * a push envelope, per AGENT_OBSERVABILITY_FLEET.md §5.1a/§5.4.
 */
function buildPushEnvelope(snapshot, emitterEpoch, seq) {
  const machine = {
    ...(snapshot && typeof snapshot.machine === 'object' && snapshot.machine ? snapshot.machine : {}),
    emitter_epoch: emitterEpoch,
    seq,
  };
  const tasks = Array.isArray(snapshot && snapshot.tasks) ? snapshot.tasks : [];
  return { machine, tasks };
}

/**
 * Fire-and-forget push of a full fleet snapshot to the aggregator.
 *
 * No-op (returns false) when the URL is empty/missing — that is the OFF
 * state. Never throws: on any error it logs via the provided logger and
 * returns false. Drops on failure — there is no queue or retry buffer here;
 * the caller's next poll simply re-sends the current snapshot.
 *
 * @param {object} snapshot - parsed F-1 outbox snapshot ({machine, tasks}).
 * @param {object} opts
 * @param {string} opts.url - fleet aggregator ingest URL. Empty => feature off.
 * @param {string} opts.token - fleet_ingest bearer credential (may be empty).
 * @param {string} opts.emitterEpoch - opaque epoch minted once at widget start.
 * @param {number} opts.seq - monotonic sequence within the current epoch.
 * @param {string} [opts.platform] - process.platform, used only for log context.
 * @param {(...args: any[]) => void} [opts.log] - logger (defaults to console.error).
 * @param {typeof fetch} [opts.fetchImpl] - injectable fetch for tests.
 * @returns {Promise<boolean>} true if a POST was attempted and got a 2xx response.
 */
async function pushFleetSnapshot(snapshot, { url, token, emitterEpoch, seq, platform, log, fetchImpl } = {}) {
  const logError = typeof log === 'function' ? log : console.error;
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  const tag = platform ? `[Fleet:${platform}]` : '[Fleet]';

  if (!url || typeof url !== 'string' || !url.trim()) return false;
  if (!snapshot || typeof snapshot !== 'object') return false;

  try {
    const envelope = buildPushEnvelope(snapshot, emitterEpoch, seq);

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await doFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
    });

    if (!res || !res.ok) {
      const status = res ? res.status : 'no-response';
      logError(`${tag} Push failed: HTTP ${status}`);
      return false;
    }
    return true;
  } catch (err) {
    logError(`${tag} Push error:`, err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Fresh per-timer state for the poll/heartbeat decision below. Create one per
 * widget run (never persisted) and pass the same object into every
 * `pollFleetOutbox` call.
 */
function createPollState() {
  return { lastHash: null, lastPushAt: null };
}

/**
 * Mint the widget's transport identity: an opaque `emitter_epoch` (a fresh
 * UUID) plus a monotonic `seq` counter within it. Call this exactly ONCE per
 * widget process start — a restart calling this again yields a fresh epoch
 * and a `seq` that restarts from 1, by construction (a new counter closure).
 *
 * @returns {{emitterEpoch: string, nextSeq: () => number}}
 */
function createTransportIdentity() {
  const emitterEpoch = crypto.randomUUID();
  let seq = 0;
  return {
    emitterEpoch,
    nextSeq() {
      seq += 1;
      return seq;
    },
  };
}

/**
 * Decide whether the current snapshot content hash warrants a push: a
 * material change from the last pushed hash always does, and otherwise a
 * push is still due once `heartbeatIntervalMs` have elapsed since the last
 * push (the full-snapshot liveness heartbeat).
 *
 * @param {{lastHash: string|null, lastPushAt: number|null}} state
 * @param {string|null} currentHash
 * @param {number} now
 * @param {number} heartbeatIntervalMs
 * @returns {boolean}
 */
function shouldPush(state, currentHash, now, heartbeatIntervalMs) {
  if (currentHash == null) return false;
  if (state.lastHash === null || currentHash !== state.lastHash) return true;
  if (state.lastPushAt === null) return true;
  return now - state.lastPushAt >= heartbeatIntervalMs;
}

/**
 * One full poll tick: read the outbox, decide whether to push (material
 * change or heartbeat due), and push if so. Mutates `state` only on a
 * successful push, so a failed push is dropped and the very next tick
 * re-evaluates (and, since `state.lastHash` was not advanced, re-sends) the
 * current full snapshot — no queue, no retry buffer.
 *
 * Fully injectable (clock, fs, fetch, seq minting) so cadence and material-
 * change/heartbeat behavior can be tested offline without real timers or a
 * live network.
 *
 * @param {object} opts
 * @param {string} opts.outboxPath
 * @param {{lastHash: string|null, lastPushAt: number|null}} opts.state
 * @param {number} [opts.now]
 * @param {number} [opts.heartbeatIntervalMs]
 * @param {string} opts.url
 * @param {string} opts.token
 * @param {string} opts.emitterEpoch
 * @param {number|(() => number)} opts.nextSeq
 * @param {string} [opts.platform]
 * @param {(...args: any[]) => void} [opts.log]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {typeof fs} [opts.fs]
 * @returns {Promise<{attempted: boolean, pushed: boolean, reason?: string, hash?: string}>}
 */
async function pollFleetOutbox({
  outboxPath,
  state,
  now = Date.now(),
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  url,
  token,
  emitterEpoch,
  nextSeq,
  platform,
  log,
  fetchImpl,
  fs: fsImpl,
} = {}) {
  const snapshot = readFleetSnapshot(outboxPath, { fs: fsImpl });
  if (!snapshot) return { attempted: false, pushed: false, reason: 'no-snapshot' };

  const hash = computeContentHash(snapshot);
  if (!shouldPush(state, hash, now, heartbeatIntervalMs)) {
    return { attempted: false, pushed: false, reason: 'unchanged', hash };
  }

  const seq = typeof nextSeq === 'function' ? nextSeq() : nextSeq;
  const pushed = await pushFleetSnapshot(snapshot, { url, token, emitterEpoch, seq, platform, log, fetchImpl });
  if (pushed) {
    state.lastHash = hash;
    state.lastPushAt = now;
  }
  return { attempted: true, pushed, hash, seq };
}

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  resolveOutboxPath,
  readFleetSnapshot,
  computeContentHash,
  buildPushEnvelope,
  pushFleetSnapshot,
  createPollState,
  createTransportIdentity,
  shouldPush,
  pollFleetOutbox,
};
