import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the browser-independent protocol boundary with Node's built-in runner.
const source = readFileSync(new URL('../lib/grgworld.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { WorldState, WorldClient, worldAddress, parseScene, mapStatus, mapCaptureAge } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const scene = (stream_id = 'a') => ({ protocol: 1, stream_id, bodies: ['world', 'Mongo/trunk', 'Kiwi/trunk'], meshes: [], geoms: [], grgs: [{name: 'Mongo', body: 1}, {name: 'Kiwi', body: 2}], world: { name: 'Office', bounds: [-3, -2, 3, 2] } });
const frame = (sequence = 1, sim_time = 0, stream_id = 'a') => ({ protocol: 1, stream_id, sequence, sim_time, bodies: Array.from({length: 3}, () => [0, 0, 0, 1, 0, 0, 0]), grgs: ['Mongo', 'Kiwi'].map(name => ({ name, activity: 'look_around', chain: null, battery: .8, fallen: false })) });

test('valid shared scene includes every body once; invalid geometry is rejected', () => {
  assert.equal(parseScene(scene()).bodies.length, 3);
  assert.throws(() => parseScene({ ...scene(), geoms: [{mesh: 3, body: 1, pos: [0,0,0], quat: [1,0,0,0]}] }));
});

test('first zero-time frame is live; repeated or stalled frames cannot keep Live', () => {
  const s = new WorldState(); s.setScene(scene()); s.connected = true;
  assert.equal(s.acceptFrame(frame(), 100), 'accepted');
  assert.equal(s.connection(200), 'live');
  assert.equal(s.acceptFrame(frame(), 2000), 'ignored');
  assert.equal(s.acceptFrame(frame(2, 0), 2200), 'accepted');
  assert.equal(s.connection(2201), 'stale');
  assert.equal(s.acceptFrame(frame(3, .1), 2300), 'accepted');
  assert.equal(s.connection(2300), 'live');
  s.connected = false;
  assert.equal(s.connection(2301), 'disconnected');
  assert.equal(s.frame.sequence, 3); // final pose remains available, never extrapolated
});

test('reordered or malformed poses do not replace the last good frame', () => {
  const s = new WorldState(); s.setScene(scene());
  s.acceptFrame(frame(4, 1), 0);
  assert.equal(s.acceptFrame(frame(3, 2), 100), 'ignored');
  assert.equal(s.acceptFrame(frame(5, .9), 100), 'ignored');
  const malformed = frame(5, 2); malformed.bodies[1][0] = NaN;
  assert.equal(s.acceptFrame(malformed, 100), 'ignored');
  assert.equal(s.frame.sequence, 4);
});

test('new stream clears scene, poses, and maps before replacement is accepted', () => {
  const s = new WorldState(); s.setScene(scene()); s.acceptFrame(frame(), 0);
  s.acceptMaps({protocol: 1, stream_id: 'a', maps: {}, diagnostics: {enabled: false}}, 0);
  assert.equal(s.acceptFrame(frame(1, 0, 'b'), 10), 'restart');
  assert.equal(s.scene, null); assert.equal(s.frame, null); assert.equal(s.maps, null);
  s.setScene(scene('b'));
  assert.equal(s.acceptFrame(frame(1, 0, 'b'), 20), 'accepted');
});

test('maps preserve disabled and unverified distinctions and also detect restart', () => {
  const s = new WorldState(); s.setScene(scene());
  assert.equal(s.acceptMaps({protocol: 1, stream_id: 'a', maps: {}, diagnostics: {enabled: false}}, 0), 'accepted');
  assert.equal(s.maps.diagnostics.enabled, false);
  assert.match(mapStatus({tracking: true, still: true, notes: [{kind: 'resumed_unverified'}]}), /unverified/i);
  assert.match(mapStatus({tracking: true, still: true, notes: [{kind: 'resumed_unverified'}, {kind: 'relocalized'}]}), /confirmed/i);
  assert.match(mapStatus({tracking: false, notes: []}), /lost/i);
  assert.equal(s.acceptMaps({protocol: 1, stream_id: 'b', maps: {}, diagnostics: {enabled: true}}, 1), 'restart');
  assert.equal(s.scene, null);
});

test('world address remains separate from lab and rejects paths or credentials', () => {
  assert.equal(worldAddress('', 'http:').http, 'http://127.0.0.1:8789');
  assert.equal(worldAddress('?lab=example.com:9999', 'http:').ws, 'ws://127.0.0.1:8789/ws');
  assert.equal(worldAddress('?world=localhost:8789', 'https:').ws, 'wss://localhost:8789/ws');
  assert.throws(() => worldAddress('?world=user:password@localhost:8789', 'http:'));
  assert.throws(() => worldAddress('?world=localhost:8789/path', 'http:'));
});

test('cached map HTTP responses cannot hide stale capture times; pending maps remain valid', () => {
  const s = new WorldState(); s.setScene(scene());
  const map = {captured_at: null, tracked_pose: [0,0,0], map_from_odom: null, grid: null, still: false, tracking: true, n_submaps: 0, n_loops: 0, windows: 0, notes: [], samples: {accepted: 0, admitted: 0}};
  const maps = {protocol: 1, stream_id: 'a', maps: {Mongo: map}, diagnostics: {enabled: true}};
  assert.equal(s.acceptMaps(maps, 0), 'accepted');
  assert.equal(mapCaptureAge(map, 10), null);
  map.captured_at = 1;
  map.grid = {width: 2, height: 2, cell: .04, origin: [-1,-1], log_odds: [0, -100, 100, 0]};
  assert.equal(s.acceptMaps(maps, 9000), 'accepted');
  assert.equal(mapCaptureAge(s.maps.maps.Mongo, 10), 9);
});

test('transport only receives poses and requests maps while the panel is open', async () => {
  const requested = [];
  const oldFetch = globalThis.fetch, oldSocket = globalThis.WebSocket;
  let socket;
  globalThis.fetch = async url => {
    requested.push(String(url));
    return {ok: true, json: async () => String(url).endsWith('/scene') ? scene() : {protocol: 1, stream_id: 'a', maps: {}, diagnostics: {enabled: false}}};
  };
  globalThis.WebSocket = class {
    // Test driver retains the created socket to deliver server events.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    constructor() { socket = this; }
    close() { this.onclose?.(); }
    send() { assert.fail('Observer must never send a WebSocket command'); }
  };
  const client = new WorldClient(worldAddress('', 'http:'));
  try {
    client.start(); await new Promise(resolve => setTimeout(resolve, 0));
    socket.onopen(); socket.onmessage({data: JSON.stringify(frame())});
    assert.equal(client.state.connection(), 'live');
    assert.deepEqual(requested, ['http://127.0.0.1:8789/scene']);
    client.showMaps(true); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(requested.at(-1), 'http://127.0.0.1:8789/maps');
    client.showMaps(false);
    assert.equal(client.state.maps.diagnostics.enabled, false);
  } finally { client.stop(); globalThis.fetch = oldFetch; globalThis.WebSocket = oldSocket; }
});
