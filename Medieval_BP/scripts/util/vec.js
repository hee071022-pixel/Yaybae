// Small immutable vector helpers ({x,y,z} objects, like the Script API uses).

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(dot(a, a));
export const dist = (a, b) => len(sub(a, b));

export function norm(a) {
  const l = len(a);
  return l > 1e-6 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 };
}

/** Horizontal (XZ) unit direction. Falls back to +Z if the input is vertical. */
export function flat(a) {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-6 ? { x: a.x / l, y: 0, z: a.z / l } : { x: 0, y: 0, z: 1 };
}

/** Rotate a direction around the Y axis by `deg` degrees. */
export function yaw(a, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: a.x * c - a.z * s, y: a.y, z: a.x * s + a.z * c };
}

/** Shortest distance from point p to the segment a->b. */
export function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-6, dot(ab, ab))));
  return dist(p, add(a, mul(ab, t)));
}

/** Approximate body centre of an entity (feet location + ~0.9 blocks). */
export function centre(entity) {
  const l = entity.location;
  return { x: l.x, y: l.y + 0.9, z: l.z };
}
