const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { configPath, readConfig, writeConfig, generateCollisionKey } = require('../src/fleet-config');

function tempStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-config-test-'));
}

function opts(stateDir) {
  return { env: { AGENT_WATCH_STATE_DIR: stateDir } };
}

// --- configPath ---------------------------------------------------------

test('configPath sits beside the F-2 outbox in the same state dir', () => {
  const stateDir = tempStateDir();
  const p = configPath(opts(stateDir));
  assert.strictEqual(p, path.join(stateDir, 'fleet_config.json'));
});

// --- write -> read round-trip -------------------------------------------

test('write -> read round-trip returns the written key id, never the raw key', () => {
  const stateDir = tempStateDir();
  writeConfig({ collision_key: 'a'.repeat(64), collision_key_id: 'team-alpha' }, opts(stateDir));
  const config = readConfig(opts(stateDir));
  assert.strictEqual(config.collision_key_id, 'team-alpha');
  assert.strictEqual(config.hasKey, true);
  assert.strictEqual(config.fleet_collision_key, undefined);
  assert.strictEqual(config.collision_key, undefined);
});

test('readConfig never exposes the raw collision key anywhere on the returned object', () => {
  const stateDir = tempStateDir();
  writeConfig({ collision_key: 'secret-key-value' }, opts(stateDir));
  const config = readConfig(opts(stateDir));
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes('secret-key-value'));
});

// --- machine_id preserved on rewrite -------------------------------------

test('machine_id set by agent_watch is preserved across a widget rewrite', () => {
  const stateDir = tempStateDir();
  const filePath = path.join(stateDir, 'fleet_config.json');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      fleet_collision_key: 'existing-key',
      collision_key_id: 'id-1',
      machine_id: 'minted-by-agent-watch-123',
    })
  );

  writeConfig({ collision_key_id: 'id-2' }, opts(stateDir));

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(raw.machine_id, 'minted-by-agent-watch-123');
  const config = readConfig(opts(stateDir));
  assert.strictEqual(config.machine_id, 'minted-by-agent-watch-123');
});

// --- blank collision_key on rewrite keeps the existing key ---------------

test('blank collision_key on rewrite keeps the existing stored key', () => {
  const stateDir = tempStateDir();
  writeConfig({ collision_key: 'first-key-value' }, opts(stateDir));
  writeConfig({ collision_key: '' }, opts(stateDir));

  const filePath = path.join(stateDir, 'fleet_config.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.strictEqual(raw.fleet_collision_key, 'first-key-value');

  const config = readConfig(opts(stateDir));
  assert.strictEqual(config.hasKey, true);
});

// --- generateCollisionKey -------------------------------------------------

test('generateCollisionKey returns 64 hex chars', () => {
  const key = generateCollisionKey();
  assert.strictEqual(key.length, 64);
  assert.match(key, /^[0-9a-f]{64}$/);
});

test('missing config file yields a sensible empty default', () => {
  const stateDir = tempStateDir();
  const config = readConfig(opts(stateDir));
  assert.deepStrictEqual(config, {
    collision_key_id: '',
    machine_id: null,
    hasKey: false,
  });
});
