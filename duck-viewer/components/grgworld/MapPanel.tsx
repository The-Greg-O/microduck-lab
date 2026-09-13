"use client";

import { useEffect, useRef } from 'react';
import { mapCaptureAge, mapStatus, type MapSnapshot, type WorldClient } from '@/lib/grgworld';
import styles from './pet-camera.module.css';

function OccupancyMap({ map, name }: { map: MapSnapshot; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = map.grid;
    const c = canvas.current;
    if (!g || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = g.width; c.height = g.height;
    const image = ctx.createImageData(g.width, g.height);
    for (let row = 0; row < g.height; row++) for (let col = 0; col < g.width; col++) {
      // Row zero starts at minimum map Y; display +Y upward. Zero odds = unknown.
      const odds = g.log_odds[row * g.width + col];
      const rgb = odds > 0 ? [65, 82, 75] : odds < 0 ? [243, 242, 229] : [193, 201, 190];
      const i = ((g.height - 1 - row) * g.width + col) * 4;
      image.data.set([...rgb, 255], i);
    }
    ctx.putImageData(image, 0, 0);
    const [x, y, yaw] = map.tracked_pose;
    const px = (x - g.origin[0]) / g.cell;
    const py = g.height - (y - g.origin[1]) / g.cell;
    const r = Math.max(3, .10 / g.cell);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-yaw);
    ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(-r, -r * .7); ctx.lineTo(-r, r * .7); ctx.closePath();
    ctx.fillStyle = '#dc8140'; ctx.fill(); ctx.strokeStyle = '#fff8eb'; ctx.lineWidth = Math.max(1, r / 5); ctx.stroke(); ctx.restore();
  }, [map]);
  return <canvas ref={canvas} className={styles.mapCanvas} aria-label={`${name}'s individual occupancy map; orange arrow is its estimated pose`} role="img" />;
}

export default function MapPanel({ client, now, onClose }: { client: WorldClient; now: number; onClose: () => void }) {
  const s = client.state;
  const data = s.maps;
  const stale = now - s.mapsAt > 3500 || s.connection(now) !== 'live';
  return <aside className={styles.mapPanel} aria-label="Individual maps">
    <div className={styles.panelHeading}><div><span className={styles.eyebrow}>Their view of the room</span><h2>Individual maps</h2></div><button onClick={onClose} aria-label="Close maps" className={styles.close}>×</button></div>
    <p className={styles.mapIntro}>Built from each grg’s own still observations. These are separate estimates, not a shared map or office ground truth.</p>
    {s.mapError && <p className={styles.mapNotice}>{s.mapError} {data ? 'Showing the last map.' : ''}</p>}
    {data?.diagnostics.error && <p className={styles.mapNotice}>Mapping unavailable: {data.diagnostics.error}</p>}
    {!data ? <p className={styles.emptyMap}>Waiting for map data…</p> : !data.diagnostics.enabled ? <p className={styles.emptyMap}>Mapping is off for this session.</p> : <>
      {stale && <p className={styles.mapNotice}>Map feed paused · last received data</p>}
      {s.scene?.grgs.map(({ name }) => {
        const map = data.maps[name];
        const captureAge = map ? mapCaptureAge(map, s.frame?.sim_time) : null;
        return <section className={styles.mapCard} key={name}>
          <div className={styles.mapTitle}><h3>{name.charAt(0).toUpperCase() + name.slice(1)}</h3>{map && <span>{map.n_submaps} submaps</span>}</div>
          {map ? <>
            <p className={styles.mapState}>{mapStatus(map)}</p>
            {captureAge !== null && captureAge > 3.5 && <p className={styles.mapNotice}>No recent mapping samples · showing earlier evidence</p>}
            {map.grid ? <OccupancyMap map={map} name={name} /> : <p className={styles.emptyMap}>No integrated map yet. Waiting for a still observation window.</p>}
            <div className={styles.mapMeta}><span>{map.samples.admitted} admitted observations</span><span>{map.n_loops} loops</span></div>
            <div className={styles.mapMeta}><span>{map.windows} windows</span><span>{captureAge !== null ? `${captureAge.toFixed(1)}s since capture` : 'No samples yet'}</span></div>
          </> : <p className={styles.emptyMap}>Waiting for {name}’s first sample.</p>}
        </section>;
      })}
      {!!data.diagnostics.queue_dropped && <p className={styles.mapNotice}>{data.diagnostics.queue_dropped} mapping samples dropped by the server.</p>}
      <div className={styles.legend}><span><i className={styles.occupied} />Occupied evidence</span><span><i className={styles.free} />Free</span><span><i className={styles.unknown} />Unknown</span></div>
      <p className={styles.mapFootnote}>Arrow: estimated pose in that grg’s map frame. Tracking can resume with an unverified location.</p>
    </>}
  </aside>;
}
