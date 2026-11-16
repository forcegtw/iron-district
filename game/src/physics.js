// Shared capsule-vs-box movement, one axis at a time, so a wall never swallows a body.
// The player and every bot resolve through this one implementation, and the grenade
// bounce reuses the same overlap test.
const RADIUS = 0.34;
const LIFT = 0.04;

export function makeBody(x, z, height) {
  return {
    position: { x, y: 0, z },
    velocity: { x: 0, y: 0, z: 0 },
    height,
    onGround: true,
  };
}

export function overlaps(colliders, x, y, z, height, lift = LIFT) {
  const minX = x - RADIUS;
  const maxX = x + RADIUS;
  const minY = y + lift;
  const maxY = y + height - lift;
  const minZ = z - RADIUS;
  const maxZ = z + RADIUS;
  for (let index = 0; index < colliders.length; index += 1) {
    const box = colliders[index];
    if (minX <= box.max.x && maxX >= box.min.x && minY <= box.max.y && maxY >= box.min.y
      && minZ <= box.max.z && maxZ >= box.min.z) return box;
  }
  return null;
}

export function moveBody(body, colliders, dt, wishX, wishZ, speed, gravity, jump) {
  // Acceleration toward the wish velocity, then friction when idle on the ground.
  const blend = Math.min(1, 42 * dt / Math.max(speed, 0.001));
  body.velocity.x += (wishX * speed - body.velocity.x) * blend;
  body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
  if (body.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - 9 * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }
  if (jump && body.onGround) {
    body.velocity.y = 6.2;
    body.onGround = false;
  }
  body.velocity.y -= gravity * dt;
  body.velocity.y = Math.max(-30, body.velocity.y);

  const p = body.position;
  const nextX = p.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, p.y, p.z, body.height)) p.x = nextX;
  else body.velocity.x = 0;
  const nextZ = p.z + body.velocity.z * dt;
  if (!overlaps(colliders, p.x, p.y, nextZ, body.height)) p.z = nextZ;
  else body.velocity.z = 0;

  p.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, p.x, p.y, p.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    p.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    p.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (p.y < 0) {
    p.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
}

export function horizontalSpeed(body) {
  return Math.hypot(body.velocity.x, body.velocity.z);
}

// Line of sight: a segment sampled against the world's colliders, no allocation per test.
const LOS_HITS = 8;
export function hasLineOfSight(from, to, colliders) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const stepX = dx / length;
  const stepY = dy / length;
  const stepZ = dz / length;
  let t = 0.6;
  const far = length - 0.4;
  let hitCount = 0;
  while (t < far && hitCount < LOS_HITS) {
    const x = from.x + stepX * t;
    const y = from.y + stepY * t;
    const z = from.z + stepZ * t;
    let blocked = false;
    for (let index = 0; index < colliders.length; index += 1) {
      const box = colliders[index];
      if (x > box.min.x - 0.05 && x < box.max.x + 0.05 && y > box.min.y - 0.05 && y < box.max.y + 0.05
        && z > box.min.z - 0.05 && z < box.max.z + 0.05) {
        blocked = true;
        break;
      }
    }
    if (blocked) return false;
    t += 0.5;
    hitCount += 1;
  }
  return true;
}
