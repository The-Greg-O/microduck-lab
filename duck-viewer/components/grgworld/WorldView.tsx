"use client";

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { buildBodyGeometries } from '@/components/Duck';
import { WorldClient, type WorldScene } from '@/lib/grgworld';
import { savedCamera, savePreference, type CameraMode } from './preferences';
import styles from './pet-camera.module.css';

/** All global MuJoCo body poses belong to ONE room, with no per-grg offset. */
function SharedOffice({ scene, client }: { scene: WorldScene; client: WorldClient }) {
  const bodies = useMemo(() => buildBodyGeometries(scene), [scene]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(THREE.Group | null)[]>([]);
  const root = useRef<THREE.Group>(null);
  const lastSequence = useRef(-1);
  useEffect(() => () => bodies.forEach(body => body.geometry?.dispose()), [bodies]);
  useFrame(() => {
    const f = client.state.frame;
    if (!f || f.stream_id !== scene.stream_id || f.sequence === lastSequence.current) return;
    lastSequence.current = f.sequence;
    if (root.current) root.current.visible = true;
    // Apply only received poses. No extrapolation or endless easing after a stall.
    f.bodies.forEach((pose, i) => {
      const group = refs.current[i];
      if (!group) return;
      group.position.set(pose[0], pose[1], pose[2]);
      group.quaternion.set(pose[4], pose[5], pose[6], pose[3]).normalize();
    });
    scene.grgs.forEach((grg, i) => {
      const p = f.bodies[grg.body];
      labels.current[i]?.position.set(p[0], p[1], p[2] + .32);
    });
  });
  return <group ref={root} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
    {bodies.map((body, i) => <group key={i} ref={node => { refs.current[i] = node; }}>
      {body.geometry && <mesh geometry={body.geometry}><meshStandardMaterial vertexColors roughness={.78} metalness={.04} /></mesh>}
    </group>)}
    {scene.grgs.map((grg, i) => <group key={grg.name} ref={node => { labels.current[i] = node; }}>
      <Html center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}><span className={styles.worldLabel} data-grg={grg.name.toLowerCase()}>{grg.name.charAt(0).toUpperCase() + grg.name.slice(1)}</span></Html>
    </group>)}
  </group>;
}

function Camera({ scene, client, mode }: { scene: WorldScene; client: WorldClient; mode: CameraMode }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);
  const initialized = useRef(false);
  const [xmin, ymin, xmax, ymax] = scene.world.bounds;
  const span = Math.max(xmax - xmin, ymax - ymin);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    initialized.current = mode === 'room';
    const saved = savedCamera(mode);
    const center = new THREE.Vector3((xmin + xmax) / 2, .12, -(ymin + ymax) / 2);
    if (mode === 'room') {
      camera.position.copy(saved ? new THREE.Vector3(...saved.position) : center.clone().add(new THREE.Vector3(span * .48, span * .78, span * .65)));
      orbit.target.copy(saved ? new THREE.Vector3(...saved.target) : center);
    }
    orbit.update();
  }, [camera, mode, xmin, ymin, xmax, ymax, span]);
  useFrame(() => {
    if (mode === 'room' || !controls.current) return;
    const grg = scene.grgs.find(g => g.name.toLowerCase() === mode.toLowerCase());
    const p = grg && client.state.frame?.bodies[grg.body];
    if (!p) return;
    target.set(p[0], p[2] + .08, -p[1]); // MuJoCo Z-up → Three Y-up
    const orbit = controls.current;
    if (!initialized.current) {
      const saved = savedCamera(mode);
      camera.position.copy(target).add(saved ? new THREE.Vector3(...saved.position).sub(new THREE.Vector3(...saved.target)) : new THREE.Vector3(1.15, .85, 1.25));
      orbit.target.copy(target); initialized.current = true;
    } else {
      delta.copy(target).sub(orbit.target);
      camera.position.add(delta); orbit.target.copy(target);
    }
    orbit.update();
  });
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.12}
    enablePan={mode === 'room'} minDistance={.35} maxDistance={span * 3} maxPolarAngle={Math.PI * .49}
    onEnd={() => { if (controls.current && initialized.current) savePreference(`camera.${mode}`, { position: camera.position.toArray(), target: controls.current.target.toArray() }); }} />;
}

export default function WorldView({ scene, client, mode }: { scene: WorldScene; client: WorldClient; mode: CameraMode }) {
  return <Canvas dpr={[1, 1.5]} camera={{ position: [5, 6, 7], fov: 42, near: .02, far: 150 }}
    gl={{ antialias: true, alpha: false }} aria-label="Mongo and Kiwi together in their shared office">
    <color attach="background" args={['#e8e5de']} />
    <ambientLight intensity={1.5} />
    <hemisphereLight args={['#f9f5eb', '#9b9c94', 1.5]} />
    <directionalLight position={[3, 7, 5]} intensity={2.2} />
    <SharedOffice key={scene.stream_id} scene={scene} client={client} />
    <Camera key={scene.stream_id} scene={scene} client={client} mode={mode} />
  </Canvas>;
}
