// Read-only grgworld protocol. Deliberately independent of the lab command client.
export type Vec3 = [number, number, number];
export interface WorldScene {
  protocol: 1; stream_id: string;
  bodies: string[];
  meshes: { v: number[]; f: number[] }[];
  geoms: { mesh: number; body: number; pos: Vec3; quat: [number, number, number, number]; mat?: string; rgba?: [number, number, number, number] }[];
  grgs: { name: string; body: number }[];
  world: { name: string; bounds: [number, number, number, number] };
}
export interface GrgStatus { name: string; activity: string; chain: string | null; battery: number; fallen: boolean }
export interface WorldFrame {
  protocol: 1; stream_id: string; sequence: number; sim_time: number;
  bodies: number[][]; grgs: GrgStatus[];
}
export interface MapSnapshot {
  captured_at: number | null; tracked_pose: Vec3;
  grid: { width: number; height: number; cell: number; origin: [number, number]; log_odds: number[] } | null;
  map_from_odom: { version: number; pose: Vec3 | null } | null;
  still: boolean; tracking: boolean; n_submaps: number; n_loops: number; windows: number;
  samples: { accepted: number; admitted: number };
  notes: { kind: string; t?: number }[];
}
export interface WorldMaps {
  protocol: 1; stream_id: string; maps: Record<string, MapSnapshot>;
  diagnostics: { enabled: boolean; queue_dropped?: number; error?: string | null };
}
export type Connection = 'connecting' | 'waiting' | 'live' | 'stale' | 'disconnected';
const STALE_MS = 2000;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v: unknown, size?: number): v is number[] => Array.isArray(v) && (size === undefined || v.length === size) && v.every(n => typeof n === 'number' && Number.isFinite(n));
const index = (v: unknown, size: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < size;
const envelope = (v: unknown): v is Record<string, unknown> => record(v) && v.protocol === 1 && typeof v.stream_id === 'string' && v.stream_id.length > 0;

export function worldAddress(search: string, protocol: string) {
  const host = new URLSearchParams(search).get('world') || '127.0.0.1:8789';
  const url = new URL(`${protocol === 'https:' ? 'https:' : 'http:'}//${host}`);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || host.includes('/')) throw new Error('Use ?world=host:port for the world address.');
  return { http: url.origin, ws: `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`, host: url.host };
}

export function parseScene(value: unknown): WorldScene {
  if (!envelope(value) || !Array.isArray(value.bodies) || !value.bodies.every(x => typeof x === 'string') ||
      !Array.isArray(value.meshes) || !Array.isArray(value.geoms) || !Array.isArray(value.grgs) || !record(value.world) ||
      typeof value.world.name !== 'string' || !numbers(value.world.bounds, 4) ||
      value.world.bounds[0] >= value.world.bounds[2] || value.world.bounds[1] >= value.world.bounds[3]) throw new Error('Invalid world scene.');
  const meshes = value.meshes;
  for (const m of meshes) {
    if (!record(m) || !numbers(m.v) || m.v.length % 3 || !numbers(m.f) || m.f.length % 3 || !m.f.every(i => index(i, (m.v as number[]).length / 3))) throw new Error('Invalid scene mesh.');
  }
  for (const g of value.geoms) {
    if (!record(g) || !index(g.mesh, meshes.length) || !index(g.body, value.bodies.length) || !numbers(g.pos, 3) || !numbers(g.quat, 4) || (g.rgba !== undefined && !numbers(g.rgba, 4))) throw new Error('Invalid scene geometry.');
  }
  const names = new Set<string>();
  for (const g of value.grgs) {
    if (!record(g) || typeof g.name !== 'string' || names.has(g.name) || !index(g.body, value.bodies.length)) throw new Error('Invalid world roster.');
    names.add(g.name);
  }
  return value as unknown as WorldScene;
}

function validFrame(v: Record<string, unknown>, scene: WorldScene): boolean {
  return Number.isSafeInteger(v.sequence) && (v.sequence as number) >= 0 && typeof v.sim_time === 'number' && Number.isFinite(v.sim_time) && v.sim_time >= 0 &&
    Array.isArray(v.bodies) && v.bodies.length === scene.bodies.length && v.bodies.every(p => numbers(p, 7) && Math.hypot(...p.slice(3)) > .1) &&
    Array.isArray(v.grgs) && v.grgs.length === scene.grgs.length && scene.grgs.every(g => (v.grgs as unknown[]).filter(s => record(s) && s.name === g.name).length === 1) &&
    v.grgs.every(g => record(g) && typeof g.name === 'string' && typeof g.activity === 'string' && (g.chain === null || typeof g.chain === 'string') && typeof g.battery === 'number' && Number.isFinite(g.battery) && g.battery >= 0 && g.battery <= 1 && typeof g.fallen === 'boolean');
}

function validMap(v: unknown): v is MapSnapshot {
  if (!record(v) || !(v.captured_at === null || typeof v.captured_at === 'number' && Number.isFinite(v.captured_at)) || !numbers(v.tracked_pose, 3) || typeof v.still !== 'boolean' || typeof v.tracking !== 'boolean' || !Array.isArray(v.notes) || !v.notes.every(n => record(n) && typeof n.kind === 'string') || !record(v.samples) || !Number.isSafeInteger(v.samples.accepted) || !Number.isSafeInteger(v.samples.admitted) || ![v.n_submaps, v.n_loops, v.windows].every(n => Number.isSafeInteger(n) && (n as number) >= 0)) return false;
  if (v.grid === null) return true;
  const g = v.grid;
  return record(g) && Number.isSafeInteger(g.width) && Number.isSafeInteger(g.height) && (g.width as number) > 0 && (g.height as number) > 0 && (g.width as number) * (g.height as number) <= 4_000_000 && typeof g.cell === 'number' && Number.isFinite(g.cell) && g.cell > 0 && numbers(g.origin, 2) && numbers(g.log_odds, (g.width as number) * (g.height as number));
}

/** State transitions are separate from transport so restart/staleness rules are testable. */
export class WorldState {
  scene: WorldScene | null = null;
  frame: WorldFrame | null = null;
  maps: WorldMaps | null = null;
  connected = false;
  connecting = true;
  receivedAt = -Infinity;
  advancedAt = -Infinity;
  mapsAt = -Infinity;
  error: string | null = null;
  mapError: string | null = null;

  clear() {
    this.scene = null; this.frame = null; this.maps = null;
    this.receivedAt = this.advancedAt = this.mapsAt = -Infinity;
    this.connected = false; this.connecting = true; this.error = null; this.mapError = null;
  }
  setScene(value: unknown) { this.clear(); this.scene = parseScene(value); }
  acceptFrame(value: unknown, now = Date.now()): 'accepted' | 'ignored' | 'restart' {
    if (!envelope(value) || !this.scene) return 'ignored';
    if (value.stream_id !== this.scene.stream_id) { this.clear(); return 'restart'; }
    if (!validFrame(value, this.scene)) return 'ignored';
    const f = value as unknown as WorldFrame;
    if (this.frame && (f.sequence <= this.frame.sequence || f.sim_time < this.frame.sim_time)) return 'ignored';
    if (!this.frame || f.sim_time > this.frame.sim_time) this.advancedAt = now;
    this.frame = f; this.receivedAt = now; this.error = null;
    return 'accepted';
  }
  acceptMaps(value: unknown, now = Date.now()): 'accepted' | 'ignored' | 'restart' {
    if (!envelope(value) || !this.scene) return 'ignored';
    if (value.stream_id !== this.scene.stream_id) { this.clear(); return 'restart'; }
    if (!record(value.maps) || !record(value.diagnostics) || typeof value.diagnostics.enabled !== 'boolean' || !Object.values(value.maps).every(validMap)) return 'ignored';
    this.maps = value as unknown as WorldMaps; this.mapsAt = now; this.mapError = null;
    return 'accepted';
  }
  connection(now = Date.now()): Connection {
    if (!this.connected) return this.connecting && !this.frame ? 'connecting' : 'disconnected';
    if (!this.frame) return 'waiting';
    return now - this.receivedAt > STALE_MS || now - this.advancedAt > STALE_MS ? 'stale' : 'live';
  }
}

/** `tracking` can resume without a verified match; never label that as confirmed. */
export function mapStatus(map: Pick<MapSnapshot, 'tracking' | 'still' | 'notes'>): string {
  if (!map.tracking) return 'Tracking lost';
  const outcome = [...map.notes].reverse().find(n => n.kind === 'relocalized' || n.kind === 'resumed_unverified');
  if (outcome?.kind === 'resumed_unverified') return 'Resumed · location unverified';
  if (outcome?.kind === 'relocalized') return 'Relocalization confirmed';
  return map.still ? 'Still · gathering evidence' : 'Following odometry';
}

export function mapCaptureAge(map: Pick<MapSnapshot, 'captured_at'>, simTime: number | undefined): number | null {
  return map.captured_at !== null && map.captured_at >= 0 && simTime !== undefined ? Math.max(0, simTime - map.captured_at) : null;
}

// Match grgworld/scripts/mapping_scenario.py's evidence legend and the
// mapping_evaluation occupied-cell threshold (>150 fixed-point log odds).
export const MAP_COLORS = {
  unknown: [37, 55, 67], free: [188, 206, 214], weak: [163, 145, 95], occupied: [83, 217, 174],
} as const;

export function mapCellColor(logOdds: number) {
  return logOdds > 150 ? MAP_COLORS.occupied : logOdds > 0 ? MAP_COLORS.weak : logOdds < 0 ? MAP_COLORS.free : MAP_COLORS.unknown;
}

/** GETs and a receive-only WebSocket. No reset, drive, or policy command exists here. */
export class WorldClient {
  readonly state = new WorldState();
  private socket: WebSocket | null = null;
  private abort: AbortController | null = null;
  private mapAbort: AbortController | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private mapTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private generation = 0;
  private mapsWanted = false;
  constructor(readonly address: ReturnType<typeof worldAddress>) {}

  start() { this.stopped = false; void this.connect(); }
  stop() {
    this.stopped = true; this.generation++;
    this.abort?.abort(); this.mapAbort?.abort(); this.socket?.close();
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.mapTimer) clearTimeout(this.mapTimer);
    this.state.connected = false;
  }
  showMaps(wanted: boolean) {
    this.mapsWanted = wanted;
    if (!wanted) { this.mapAbort?.abort(); if (this.mapTimer) clearTimeout(this.mapTimer); }
    else if (this.state.scene && !this.mapAbort) void this.pollMaps(this.generation);
  }
  private async connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.socket?.close(); this.abort?.abort(); this.mapAbort?.abort();
    if (this.mapTimer) clearTimeout(this.mapTimer);
    this.abort = new AbortController(); this.mapAbort = null;
    this.state.connected = false; this.state.connecting = true;
    try {
      const response = await fetch(`${this.address.http}/scene`, { cache: 'no-store', signal: this.abort.signal });
      if (!response.ok) throw new Error(`World scene returned HTTP ${response.status}.`);
      const value: unknown = await response.json();
      if (this.stopped || generation !== this.generation) return;
      const scene = parseScene(value);
      if (scene.stream_id !== this.state.scene?.stream_id) this.state.setScene(scene);
      const ws = new WebSocket(this.address.ws); this.socket = ws;
      ws.onopen = () => { if (generation === this.generation && !this.stopped) { this.state.connected = true; this.state.connecting = false; } };
      ws.onmessage = event => {
        if (generation !== this.generation || this.stopped) return;
        try {
          const result = this.state.acceptFrame(JSON.parse(event.data));
          if (result === 'restart') void this.connect();
        } catch { this.state.error = 'A world frame could not be read.'; }
      };
      ws.onerror = () => { if (generation === this.generation) this.state.error = 'World connection interrupted.'; };
      ws.onclose = () => { if (generation === this.generation && !this.stopped) this.retry(); };
      if (this.mapsWanted) void this.pollMaps(generation);
    } catch (error) {
      if (generation !== this.generation || this.stopped) return;
      this.state.error = error instanceof Error ? error.message : 'World connection unavailable.';
      this.retry();
    }
  }
  private retry() {
    this.state.connected = false; this.state.connecting = false;
    this.state.receivedAt = -Infinity;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => void this.connect(), 1500);
  }
  private async pollMaps(generation: number) {
    if (this.stopped || !this.mapsWanted || generation !== this.generation) return;
    const abort = new AbortController(); this.mapAbort = abort;
    try {
      const response = await fetch(`${this.address.http}/maps`, { cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error(`Maps returned HTTP ${response.status}.`);
      const value: unknown = await response.json();
      if (generation !== this.generation || this.stopped || !this.mapsWanted) return;
      const result = this.state.acceptMaps(value);
      if (result === 'restart') { void this.connect(); return; }
      if (result === 'ignored') this.state.mapError = 'Map data could not be read.';
    } catch (error) {
      if (!abort.signal.aborted && generation === this.generation) this.state.mapError = error instanceof Error ? error.message : 'Map data unavailable.';
    } finally {
      if (this.mapAbort === abort) this.mapAbort = null;
      if (!this.stopped && this.mapsWanted && generation === this.generation) this.mapTimer = setTimeout(() => void this.pollMaps(generation), 1000);
    }
  }
}
