const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
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
} = require('../src/push-fleet-snapshot');

// --- resolveOutboxPath -------------------------------------------------------

test('resolveOutboxPath honors AGENT_WATCH_STATE_DIR first', () => {
  const p = resolveOutboxPath({
    env: { AGENT_WATCH_STATE_DIR: '/custom/state', XDG_STATE_HOME: '/xdg/state' },
    homedir: () => '/home/someone',
  });
  assert.strictEqual(p, path.join('/custom/state', 'fleet_snapshot.json'));
});

test('resolveOutboxPath falls back to XDG_STATE_HOME/relay-agent-watch', () => {
  const p = resolveOutboxPath({
    env: { XDG_STATE_HOME: '/xdg/state' },
    homedir: () => '/home/someone',
  });
  assert.strictEqual(p, path.join('/xdg/state', 'relay-agent-watch', 'fleet_snapshot.json'));
});

test('resolveOutboxPath falls back to ~/.local/state/relay-agent-watch when neither env var is set', () => {
  const p = resolveOutboxPath({
    env: {},
    homedir: () => '/home/someone',
  });
  assert.strictEqual(
    p,
    path.join('/home/someone', '.local', 'state', 'relay-agent-watch', 'fleet_snapshot.json')
  );
});

// --- readFleetSnapshot (fail-safe) -------------------------------------------

test('readFleetSnapshot returns null on a missing file, never throws', () => {
  const fakeFs = {
    readFileSync() {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    },
  };
  assert.strictEqual(readFleetSnapshot('/does/not/exist.json', { fs: fakeFs }), null);
});

test('readFleetSnapshot returns null on an unreadable file (e.g. EACCES), never throws', () => {
  const fakeFs = {
    readFileSync() {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    },
  };
  assert.strictEqual(readFleetSnapshot('/no/access.json', { fs: fakeFs }), null);
});

test('readFleetSnapshot returns null on malformed JSON, never throws', () => {
  const fakeFs = {
    readFileSync() {
      return '{ this is not valid json';
    },
  };
  assert.strictEqual(readFleetSnapshot('/corrupt.json', { fs: fakeFs }), null);
});

test('readFleetSnapshot parses a valid snapshot', () => {
  const snapshot = { machine: { machine_id: 'abc' }, tasks: [] };
  const fakeFs = {
    readFileSync() {
      return JSON.stringify(snapshot);
    },
  };
  assert.deepStrictEqual(readFleetSnapshot('/ok.json', { fs: fakeFs }), snapshot);
});

// --- computeContentHash -------------------------------------------------------

test('computeContentHash is stable across key reordering', () => {
  const a = { machine: { machine_id: 'm1', lease_active: false }, tasks: [{ slot_id: 'W1', lifecycle: 'QUEUED' }] };
  const b = { tasks: [{ lifecycle: 'QUEUED', slot_id: 'W1' }], machine: { lease_active: false, machine_id: 'm1' } };
  assert.strictEqual(computeContentHash(a), computeContentHash(b));
});

test('computeContentHash differs on a material change', () => {
  const a = { machine: { machine_id: 'm1' }, tasks: [{ slot_id: 'W1', lifecycle: 'QUEUED' }] };
  const b = { machine: { machine_id: 'm1' }, tasks: [{ slot_id: 'W1', lifecycle: 'DISPATCHED' }] };
  assert.notStrictEqual(computeContentHash(a), computeContentHash(b));
});

// --- shouldPush (material change vs heartbeat) -------------------------------

test('shouldPush: a null/absent hash never pushes', () => {
  const state = createPollState();
  assert.strictEqual(shouldPush(state, null, 0, DEFAULT_HEARTBEAT_INTERVAL_MS), false);
});

test('shouldPush: first-ever hash (state.lastHash === null) always pushes', () => {
  const state = createPollState();
  assert.strictEqual(shouldPush(state, 'hash-1', 0, DEFAULT_HEARTBEAT_INTERVAL_MS), true);
});

test('shouldPush: a material change pushes immediately', () => {
  const state = { lastHash: 'hash-1', lastPushAt: 1000 };
  assert.strictEqual(shouldPush(state, 'hash-2', 1001, DEFAULT_HEARTBEAT_INTERVAL_MS), true);
});

test('shouldPush: an unchanged hash is suppressed until the heartbeat interval elapses', () => {
  const state = { lastHash: 'hash-1', lastPushAt: 1000 };
  // Just under the heartbeat window: suppressed.
  assert.strictEqual(
    shouldPush(state, 'hash-1', 1000 + DEFAULT_HEARTBEAT_INTERVAL_MS - 1, DEFAULT_HEARTBEAT_INTERVAL_MS),
    false
  );
  // Exactly at the heartbeat window: the heartbeat fires.
  assert.strictEqual(
    shouldPush(state, 'hash-1', 1000 + DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS),
    true
  );
});

// --- createTransportIdentity (emitter_epoch + seq) ---------------------------

test('createTransportIdentity mints a distinct emitter_epoch per call (a fresh widget restart)', () => {
  const first = createTransportIdentity();
  const second = createTransportIdentity();
  assert.notStrictEqual(first.emitterEpoch, second.emitterEpoch);
});

test('createTransportIdentity: seq is monotonic within one identity and restarts at 1 on a new one', () => {
  const first = createTransportIdentity();
  assert.strictEqual(first.nextSeq(), 1);
  assert.strictEqual(first.nextSeq(), 2);
  assert.strictEqual(first.nextSeq(), 3);

  const second = createTransportIdentity();
  assert.strictEqual(second.nextSeq(), 1);
});

// --- pushFleetSnapshot (offline, stubbed fetch) ------------------------------

test('pushFleetSnapshot: empty url is a no-op (feature OFF), never calls fetch', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true };
  };
  const result = await pushFleetSnapshot(
    { machine: {}, tasks: [] },
    { url: '', token: 'x', emitterEpoch: 'e1', seq: 1, fetchImpl }
  );
  assert.strictEqual(result, false);
  assert.strictEqual(called, false);
});

test('pushFleetSnapshot: a token adds the Authorization Bearer header', async () => {
  let capturedHeaders = null;
  const fetchImpl = async (url, init) => {
    capturedHeaders = init.headers;
    return { ok: true };
  };
  const ok = await pushFleetSnapshot(
    { machine: {}, tasks: [] },
    { url: 'https://fleet.example/v1/state', token: 'secret-token', emitterEpoch: 'e1', seq: 1, fetchImpl }
  );
  assert.strictEqual(ok, true);
  assert.strictEqual(capturedHeaders.Authorization, 'Bearer secret-token');
});

test('pushFleetSnapshot: envelope carries machine.emitter_epoch + machine.seq over the outbox machine block', async () => {
  let capturedBody = null;
  const fetchImpl = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true };
  };
  const snapshot = { machine: { machine_id: 'm-42', lease_active: true }, tasks: [{ slot_id: 'W1' }] };
  await pushFleetSnapshot(snapshot, {
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'epoch-abc',
    seq: 7,
    fetchImpl,
  });
  assert.strictEqual(capturedBody.machine.machine_id, 'm-42');
  assert.strictEqual(capturedBody.machine.lease_active, true);
  assert.strictEqual(capturedBody.machine.emitter_epoch, 'epoch-abc');
  assert.strictEqual(capturedBody.machine.seq, 7);
  assert.deepStrictEqual(capturedBody.tasks, [{ slot_id: 'W1' }]);
});

test('pushFleetSnapshot: a non-ok response is dropped (returns false), never throws', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const ok = await pushFleetSnapshot(
    { machine: {}, tasks: [] },
    { url: 'https://fleet.example/v1/state', token: '', emitterEpoch: 'e1', seq: 1, fetchImpl, log: () => {} }
  );
  assert.strictEqual(ok, false);
});

test('pushFleetSnapshot: a thrown network error is swallowed and logged, never propagated', async () => {
  const fetchImpl = async () => {
    throw new Error('network unreachable');
  };
  let loggedMessage = null;
  const ok = await pushFleetSnapshot(
    { machine: {}, tasks: [] },
    {
      url: 'https://fleet.example/v1/state',
      token: '',
      emitterEpoch: 'e1',
      seq: 1,
      fetchImpl,
      log: (...args) => {
        loggedMessage = args.join(' ');
      },
    }
  );
  assert.strictEqual(ok, false);
  assert.match(loggedMessage, /network unreachable/);
});

// --- pollFleetOutbox (offline, injected clock/fs/fetch) ----------------------

function fakeFsWith(snapshot) {
  return {
    readFileSync() {
      return JSON.stringify(snapshot);
    },
  };
}

const missingFs = {
  readFileSync() {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  },
};

test('pollFleetOutbox: a missing outbox is a no-op — attempted:false, never throws', async () => {
  const state = createPollState();
  const result = await pollFleetOutbox({
    outboxPath: '/nope/fleet_snapshot.json',
    state,
    now: 1000,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 1,
    fs: missingFs,
    fetchImpl: async () => ({ ok: true }),
  });
  assert.strictEqual(result.attempted, false);
  assert.strictEqual(result.pushed, false);
  assert.strictEqual(state.lastHash, null);
});

test('pollFleetOutbox: first tick pushes (material change from an unset baseline) and advances state', async () => {
  const snapshot = { machine: { machine_id: 'm1' }, tasks: [] };
  const state = createPollState();
  let fetchCalls = 0;
  const result = await pollFleetOutbox({
    outboxPath: '/fake/fleet_snapshot.json',
    state,
    now: 1000,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 1,
    fs: fakeFsWith(snapshot),
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
  });
  assert.strictEqual(result.attempted, true);
  assert.strictEqual(result.pushed, true);
  assert.strictEqual(fetchCalls, 1);
  assert.strictEqual(state.lastHash, computeContentHash(snapshot));
  assert.strictEqual(state.lastPushAt, 1000);
});

test('pollFleetOutbox: an unchanged snapshot within the heartbeat window is a no-op (no fetch call)', async () => {
  const snapshot = { machine: { machine_id: 'm1' }, tasks: [] };
  const state = { lastHash: computeContentHash(snapshot), lastPushAt: 1000 };
  let fetchCalls = 0;
  const result = await pollFleetOutbox({
    outboxPath: '/fake/fleet_snapshot.json',
    state,
    now: 1000 + DEFAULT_HEARTBEAT_INTERVAL_MS - 1,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 99,
    fs: fakeFsWith(snapshot),
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
  });
  assert.strictEqual(result.attempted, false);
  assert.strictEqual(result.pushed, false);
  assert.strictEqual(fetchCalls, 0);
});

test('pollFleetOutbox: the ~30s heartbeat still fires on an unchanged snapshot once due', async () => {
  const snapshot = { machine: { machine_id: 'm1' }, tasks: [] };
  const hash = computeContentHash(snapshot);
  const state = { lastHash: hash, lastPushAt: 1000 };
  let fetchCalls = 0;
  const result = await pollFleetOutbox({
    outboxPath: '/fake/fleet_snapshot.json',
    state,
    now: 1000 + DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 2,
    fs: fakeFsWith(snapshot),
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
  });
  assert.strictEqual(result.attempted, true);
  assert.strictEqual(result.pushed, true);
  assert.strictEqual(fetchCalls, 1);
  assert.strictEqual(state.lastHash, hash);
  assert.strictEqual(state.lastPushAt, 1000 + DEFAULT_HEARTBEAT_INTERVAL_MS);
});

test('pollFleetOutbox: a FAILED push does not advance state, so the next tick re-sends the same snapshot', async () => {
  const snapshot = { machine: { machine_id: 'm1' }, tasks: [] };
  const state = createPollState();
  let fetchCalls = 0;

  // First tick: push fails (non-ok response). State must NOT advance.
  const first = await pollFleetOutbox({
    outboxPath: '/fake/fleet_snapshot.json',
    state,
    now: 1000,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 1,
    fs: fakeFsWith(snapshot),
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: false, status: 503 };
    },
    log: () => {},
  });
  assert.strictEqual(first.attempted, true);
  assert.strictEqual(first.pushed, false);
  assert.strictEqual(state.lastHash, null);
  assert.strictEqual(state.lastPushAt, null);

  // Second tick, well within the heartbeat window, snapshot unchanged: because
  // state was never advanced, the current full snapshot is re-sent — a drop,
  // never a queue/retry buffer.
  const second = await pollFleetOutbox({
    outboxPath: '/fake/fleet_snapshot.json',
    state,
    now: 1005,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 2,
    fs: fakeFsWith(snapshot),
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: true };
    },
    log: () => {},
  });
  assert.strictEqual(second.attempted, true);
  assert.strictEqual(second.pushed, true);
  assert.strictEqual(fetchCalls, 2);
  assert.strictEqual(state.lastHash, computeContentHash(snapshot));
  assert.strictEqual(state.lastPushAt, 1005);
});

test('pollFleetOutbox: a thrown fetch error is treated as a failed/dropped push, never throws out of pollFleetOutbox', async () => {
  const snapshot = { machine: { machine_id: 'm1' }, tasks: [] };
  const state = createPollState();
  const result = await pollFleetOutbox({
    outboxPath: '/fake/fleet_snapshot.json',
    state,
    now: 1000,
    url: 'https://fleet.example/v1/state',
    token: '',
    emitterEpoch: 'e1',
    nextSeq: () => 1,
    fs: fakeFsWith(snapshot),
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
    log: () => {},
  });
  assert.strictEqual(result.pushed, false);
  assert.strictEqual(state.lastHash, null);
});

// --- buildPushEnvelope --------------------------------------------------------

test('buildPushEnvelope preserves the outbox tasks array and stamps transport identity on the machine block only', () => {
  const snapshot = { machine: { machine_id: 'm1', lease_active: false }, tasks: [{ slot_id: 'W1' }] };
  const envelope = buildPushEnvelope(snapshot, 'epoch-1', 5);
  assert.strictEqual(envelope.machine.machine_id, 'm1');
  assert.strictEqual(envelope.machine.emitter_epoch, 'epoch-1');
  assert.strictEqual(envelope.machine.seq, 5);
  assert.deepStrictEqual(envelope.tasks, [{ slot_id: 'W1' }]);
});

test('buildPushEnvelope defaults to an empty machine/tasks shape on a malformed snapshot', () => {
  const envelope = buildPushEnvelope({}, 'epoch-1', 1);
  assert.deepStrictEqual(envelope.tasks, []);
  assert.strictEqual(envelope.machine.emitter_epoch, 'epoch-1');
  assert.strictEqual(envelope.machine.seq, 1);
});

// --- RSM-4 path stays untouched -----------------------------------------------

test('the RSM-4 push module contract is untouched (still exports pushUsageToRSM4)', () => {
  const rsm4 = require('../src/push-to-rsm4');
  assert.strictEqual(typeof rsm4.pushUsageToRSM4, 'function');
});
