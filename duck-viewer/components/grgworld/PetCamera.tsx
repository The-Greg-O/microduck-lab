"use client";

import { useEffect, useState } from 'react';
import { WorldClient, worldAddress, type GrgStatus } from '@/lib/grgworld';
import WorldView from './WorldView';
import MapPanel from './MapPanel';
import { loadPreference, savePreference, type CameraMode } from './preferences';
import styles from './pet-camera.module.css';

const titleCase = (text: string) => text.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const elapsed = (seconds: number) => `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

function Companion({ name, status, active, onFollow }: { name: string; status?: GrgStatus; active: boolean; onFollow: () => void }) {
  const battery = status ? Math.round(status.battery * 100) : null;
  const displayName = titleCase(name);
  return <button className={styles.companion} data-active={active} onClick={onFollow} aria-pressed={active} aria-label={`Follow ${displayName}`}>
    <span className={styles.avatar} data-grg={name.toLowerCase()}>{displayName.slice(0, 1)}</span>
    <span className={styles.companionText}><strong>{displayName}<span className={styles.followLabel}>{active ? 'Following' : 'Follow'}</span></strong><span>{status ? titleCase(status.activity) : 'Waiting for a frame'}{status?.fallen && <em> · Fallen</em>}</span>{status?.chain && <small>{titleCase(status.chain)}</small>}</span>
    <span className={styles.battery} aria-label={battery === null ? 'Battery unavailable' : `${battery}% battery`}><span className={styles.batteryOutline}><i style={{ width: `${battery ?? 0}%` }} data-low={battery !== null && battery < 20} /></span><span>{battery === null ? '—' : `${battery}%`}</span></span>
  </button>;
}

export default function PetCamera() {
  const [setup] = useState(() => {
    try { return { client: new WorldClient(worldAddress(window.location.search, window.location.protocol)), error: null }; }
    catch (error) { return { client: null, error: error instanceof Error ? error.message : 'Invalid world address.' }; }
  });
  const [mode, setMode] = useState<CameraMode>(() => {
    const stored = loadPreference<string>('view', 'room');
    return stored === 'Mongo' || stored === 'Kiwi' ? stored : 'room';
  });
  const [mapsOpen, setMapsOpen] = useState(() => loadPreference<boolean>('mapsOpen', false) === true);
  const [now, setNow] = useState(Date.now);
  const client = setup.client;
  useEffect(() => {
    client?.start();
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(interval); client?.stop(); };
  }, [client]);
  useEffect(() => { client?.showMaps(mapsOpen); savePreference('mapsOpen', mapsOpen); }, [client, mapsOpen]);
  const changeMode = (next: CameraMode) => { setMode(next); savePreference('view', next); };
  const state = client?.state;
  const scene = state?.scene;
  const frame = state?.frame;
  const connection = state?.connection(now) ?? 'disconnected';
  const live = connection === 'live';
  const label = { connecting: 'Connecting', waiting: 'Waiting for frames', live: 'Live', stale: 'Feed paused', disconnected: 'Disconnected' }[connection];
  return <main className={styles.page}>
    <div className={styles.viewport}>{scene && client && <WorldView scene={scene} client={client} mode={mode} />}</div>
    <header className={styles.header}>
      <div className={styles.brand}><span className={styles.brandIcon} aria-hidden="true">◉</span><div><span className={styles.eyebrow}>Grgworld · Pet camera</span><h1>Mongo &amp; Kiwi</h1></div></div>
      <div className={styles.connection} role="status" data-live={live}><i /><span>{label}</span></div>
      <div className={styles.clock}><span>1× real time</span><strong>{frame ? elapsed(frame.sim_time) : '—:—:—'}</strong></div>
    </header>
    <div className={styles.toolbar}>
      <nav aria-label="Observation camera" className={styles.cameraModes}>
        {(['room', 'Mongo', 'Kiwi'] as const).map(camera => <button key={camera} onClick={() => changeMode(camera)} aria-pressed={mode === camera} data-active={mode === camera}>{camera === 'room' ? 'Room' : `Follow ${camera}`}</button>)}
      </nav>
      <button className={styles.mapsToggle} onClick={() => setMapsOpen(open => !open)} aria-expanded={mapsOpen} data-active={mapsOpen}><span aria-hidden="true">▧</span> Maps</button>
    </div>
    {!frame && <div className={styles.waiting}><span className={styles.waitingIcon} aria-hidden="true">⌂</span><h2>{scene ? 'The office is ready' : 'Opening a window into their world'}</h2><p>{setup.error || state?.error || (scene ? 'Waiting for Mongo and Kiwi’s first frame…' : 'Connecting to the shared office…')}</p><span>{client?.address.host ?? 'Check the world address'}</span></div>}
    {frame && !live && <div className={styles.paused} role="status"><strong>{label}</strong><span>{connection === 'stale' ? 'The world is not advancing. Showing the last received pose.' : 'Showing the last received pose. Reconnecting automatically.'}</span></div>}
    {mapsOpen && client && <MapPanel client={client} now={now} onClose={() => setMapsOpen(false)} />}
    <div className={styles.bottom} data-maps={mapsOpen}>
      <div className={styles.roomCaption}><span className={styles.eyebrow}>{scene?.world.name ?? 'Shared office'}</span><span>{mode === 'room' ? 'A little window into their day.' : `Keeping an eye on ${mode}.`}</span></div>
      <div className={styles.companions}>{(scene?.grgs ?? [{ name: 'Mongo' }, { name: 'Kiwi' }]).map(({ name }) => <Companion key={name} name={name} status={frame?.grgs.find(g => g.name === name)} active={mode.toLowerCase() === name.toLowerCase()} onFollow={() => changeMode(name.toLowerCase() === 'kiwi' ? 'Kiwi' : 'Mongo')} />)}</div>
      <footer className={styles.footer}><span>Live simulation · observation only</span><span>Drag to orbit · scroll to zoom</span></footer>
    </div>
  </main>;
}
