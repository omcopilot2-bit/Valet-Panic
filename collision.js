// Shared ground-plane collision math. Cars use two overlapping circles to approximate their long body.
// Cars are ~2.85 long and ~1.4 wide, so two circles of radius 0.7 centred 0.7 from the middle match the real body
// (the old 0.85 radius made cars 1.7 wide and got them stuck in narrow lanes).
export const CAR_BODY_OFFSETS = [-0.7, 0.7];
export const CAR_BODY_RADIUS = 0.7;

// Circle against a prop collider. Props with halfX / halfZ (planters) are real axis-aligned boxes, so a circle is NOT used for them
// (the old bounding circle blocked the guest path and the lanes beside the planters). Returns { nx, nz, depth } or null.
export function circleVsCollider(x, z, radius, c, seed = '') {
  if (c.halfX !== undefined && c.halfZ !== undefined) {
    const qx = Math.max(c.x - c.halfX, Math.min(x, c.x + c.halfX));
    const qz = Math.max(c.z - c.halfZ, Math.min(z, c.z + c.halfZ));
    let dx = x - qx, dz = z - qz;
    const d = Math.hypot(dx, dz);
    if (d >= radius) return null;
    if (d < 1e-5) {
      const ox = c.halfX - Math.abs(x - c.x), oz = c.halfZ - Math.abs(z - c.z);
      if (ox < oz) return { nx: Math.sign(x - c.x) || 1, nz: 0, depth: radius + ox };
      return { nx: 0, nz: Math.sign(z - c.z) || 1, depth: radius + oz };
    }
    return { nx: dx / d, nz: dz / d, depth: radius - d };
  }
  const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), min = radius + c.r;
  if (d >= min) return null;
  const [nx, nz] = separationNormal(dx, dz, seed);
  return { nx, nz, depth: min - d };
}

// Circle against the rotated stall box. Returns an outward world-space normal and penetration depth.
export function circleVsParkingBox(x, z, radius, slot, halfX, halfZ) {
  const yaw = slot.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
  const dx = x - slot.x, dz = z - slot.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  const qx = Math.max(-halfX, Math.min(lx, halfX));
  const qz = Math.max(-halfZ, Math.min(lz, halfZ));
  let nx = lx - qx, nz = lz - qz, d = Math.hypot(nx, nz);
  if (d >= radius) return null;
  let depth = radius - d;
  if (d < 1e-5) {
    const ox = halfX - Math.abs(lx), oz = halfZ - Math.abs(lz);
    if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; depth += ox; }
    else { nx = 0; nz = Math.sign(lz) || 1; depth += oz; }
  } else { nx /= d; nz /= d; }
  return { nx: c * nx + s * nz, nz: -s * nx + c * nz, depth };
}

export function separationNormal(dx, dz, seed = '') {
  const d = Math.hypot(dx, dz);
  if (d > 1e-5) return [dx / d, dz / d];
  let hash = 2166136261;
  for (const ch of String(seed)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const a = ((hash >>> 0) / 4294967296) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

export function carBodiesOverlapAt(x, z, yaw, other, ox = other.x, oz = other.z, oyaw = other.yaw, margin = 0.04) {
  const ax = Math.sin(yaw), az = Math.cos(yaw);
  const bx = Math.sin(oyaw), bz = Math.cos(oyaw);
  const min = CAR_BODY_RADIUS * 2 + margin;
  for (const a of CAR_BODY_OFFSETS) {
    const px = x + ax * a, pz = z + az * a;
    for (const b of CAR_BODY_OFFSETS) {
      if (Math.hypot(px - (ox + bx * b), pz - (oz + bz * b)) < min) return true;
    }
  }
  return false;
}

// Check the whole short movement, not just its endpoint, so scripted cars do not tunnel through traffic.
export function carPathBlocked(car, x, z, yaw, others, margin = 0.04) {
  const distance = Math.hypot(x - car.x, z - car.z);
  const steps = Math.max(1, Math.ceil(distance / 0.25));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const px = car.x + (x - car.x) * f;
    const pz = car.z + (z - car.z) * f;
    for (const other of others) {
      if (other !== car && carBodiesOverlapAt(px, pz, yaw, other, other.x, other.z, other.yaw, margin)) return true;
    }
  }
  return false;
}

export function carPathHitsCircle(car, x, z, yaw, obstacles, margin = 0.04) {
  const distance = Math.hypot(x - car.x, z - car.z);
  const angle = Math.atan2(Math.sin(yaw - car.yaw), Math.cos(yaw - car.yaw));
  const steps = Math.max(1, Math.ceil(distance / 0.25), Math.ceil(Math.abs(angle) / 0.15));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const px = car.x + (x - car.x) * f, pz = car.z + (z - car.z) * f;
    const pyaw = car.yaw + angle * f, fx = Math.sin(pyaw), fz = Math.cos(pyaw);
    for (const o of obstacles) {
      if (o.disabled) continue;
      for (const offset of CAR_BODY_OFFSETS) {
        const cx = px + fx * offset, cz = pz + fz * offset;
        if (o.halfX !== undefined && o.halfZ !== undefined) {
          // Planters are square in the scene; their bounding circle falsely blocks the drop-off lane.
          const qx = Math.max(o.x - o.halfX, Math.min(cx, o.x + o.halfX));
          const qz = Math.max(o.z - o.halfZ, Math.min(cz, o.z + o.halfZ));
          const boxClearance = CAR_BODY_RADIUS + Math.max(0, margin - 0.08);
          if (Math.hypot(cx - qx, cz - qz) < boxClearance) return true;
        } else if (Math.hypot(cx - o.x, cz - o.z) < CAR_BODY_RADIUS + o.r + margin) return true;
      }
    }
  }
  return false;
}

export function movingCircleHitsCar(car, x0, z0, x1, z1, radius) {
  const vx = x1 - x0, vz = z1 - z0, len2 = vx * vx + vz * vz;
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  for (const offset of CAR_BODY_OFFSETS) {
    const px = car.x + fx * offset, pz = car.z + fz * offset;
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / len2)) : 0;
    if (Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t)) < CAR_BODY_RADIUS + radius) return true;
  }
  return false;
}

export function movingCircleHitsPoint(x0, z0, x1, z1, radius, px, pz, pointRadius = 0) {
  const vx = x1 - x0, vz = z1 - z0, len2 = vx * vx + vz * vz;
  const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / len2)) : 0;
  return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t)) < radius + pointRadius;
}
