import type { Vec3 } from '@/lib/grgworld';

export type CameraMode = 'room' | 'Mongo' | 'Kiwi';
export interface SavedCamera { position: Vec3; target: Vec3 }
const PREFIX = 'grgworld.petcam.';

export function loadPreference<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(PREFIX + key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}
export function savePreference(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* Private browsing is still usable. */ }
}
export function savedCamera(mode: CameraMode): SavedCamera | null {
  const value = loadPreference<SavedCamera | null>(`camera.${mode}`, null);
  return value && [value.position, value.target].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) ? value : null;
}
