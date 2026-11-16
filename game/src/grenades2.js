// Grenades, second pass: a proper swept bounce against the map's boxes, a cook timer
// you hold, and a one-second arc that shows where the can is going before it leaves
// the hand. The bounce resolves one axis at a time against the AABB it is inside, so a
// can thrown into a corner reflects off the wall it hit rather than reversing blindly
// in all three axes the way a centre-point test would.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 20;
const THROW_SPEED = 15;
const RADIUS = 0.09;
const bounciness = 0.42;
const dragFriction = 0.82;
const MIN_FUSE = 0.35;     // a fully cooked can still gives you this long to move
const MAX_FUSE = 2.6;
const COOK_RATE = 1.0;     // seconds of fuse burned per second of held G
const PREDICT_STEPS = 18;
const BURN_TIME = 1.0;
// The lob is what makes a can clear the mid-lane rail instead of dying against it.
const LOFT = 3.6;

export function createGrenades(scene, colliders) {
  const pool = [];
  const active = [];
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const geometry = new THREE.SphereGeometry(RADIUS, 10, 8);

  // The predicted flight: one shared dashed line whose points are rewritten each
  // frame while the throw is charged. It is the only standing extra geometry.
  const arcPositions = new Float32Array(PREDICT_STEPS * 3);
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
  const canLine = new THREE.Line(arcGeometry, new THREE.LineDashedMaterial({
    color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0.5, dashSize: 0.22, gapSize: 0.14,
  }));
  canLine.visible = false;
  canLine.frustumCulled = false;
  scene.add(canLine);

  function acquire() {
    let canister = pool.pop();
    if (!canister) {
      canister = {
        mesh: new THREE.Mesh(geometry, material),
        velocity: new THREE.Vector3(),
        position: new THREE.Vector3(),
        fuse: 0,
        live: false,
      };
      canister.mesh.castShadow = true;
      scene.add(canister.mesh);
    }
    canister.mesh.visible = true;
    canister.live = true;
    return canister;
  }

  // First box whose bounds contain the point (padded by the can's radius), or null.
  function boxAt(x, y, z, pad) {
    for (let index = 0; index < colliders.length; index += 1) {
      const box = colliders[index];
      if (x > box.min.x - pad && x < box.max.x + pad
        && y > box.min.y - pad && y < box.max.y + pad
        && z > box.min.z - pad && z < box.max.z + pad) return box;
    }
    return null;
  }

  function throwGrenade(origin, direction, speed = THROW_SPEED, cook = 0) {
    const canister = acquire();
    canister.position.copy(origin);
    canister.velocity.copy(direction).normalize().multiplyScalar(speed);
    canister.velocity.y += LOFT;
    canister.fuse = Math.max(MIN_FUSE, MAX_FUSE - cook);
    canister.mesh.position.copy(canister.position);
    active.push(canister);
    return canister;
  }

  // Integrates the same gravity the sim uses and stops the preview at the first
  // surface it would strike, so the line never reads as running through a wall.
  function previewArc(origin, direction, speed = THROW_SPEED) {
    let x = origin.x;
    let y = origin.y;
    let z = origin.z;
    const vx = direction.x * speed;
    const vy = direction.y * speed + LOFT;
    const vz = direction.z * speed;
    const dt = BURN_TIME / PREDICT_STEPS;
    let stopped = false;
    for (let step = 0; step < PREDICT_STEPS; step += 1) {
      const t = (step + 1) * dt;
      const px = x + vx * t;
      const py = y + vy * t - 0.5 * GRAVITY * t * t;
      const pz = z + vz * t;
      if (!stopped && (py < RADIUS || boxAt(px, py, pz, RADIUS))) stopped = true;
      // After impact, every later point collapses onto the hit point.
      arcPositions[step * 3] = stopped ? x : px;
      arcPositions[step * 3 + 1] = stopped ? y : py;
      arcPositions[step * 3 + 2] = stopped ? z : pz;
      if (!stopped) { x = px; y = py; z = pz; }
    }
    arcGeometry.attributes.position.needsUpdate = true;
    canLine.computeLineDistances();
    canLine.visible = true;
  }

  function hideArc() {
    canLine.visible = false;
  }

  // Axis-separated sweep: move x, test, then z, then y. Each axis that ends up inside
  // a box is undone and reflected, which is what makes a corner bounce send the can
  // back out of the corner instead of through it.
  function step(dt, onBlast) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const canister = active[index];
      canister.fuse -= dt;
      if (canister.fuse <= 0) {
        canister.mesh.visible = false;
        canister.live = false;
        active.splice(index, 1);
        pool.push(canister);
        onBlast(canister.position);
        continue;
      }
      const p = canister.position;
      canister.velocity.y -= GRAVITY * dt;
      const nextX = p.x + canister.velocity.x * dt;
      if (boxAt(nextX, p.y, p.z, RADIUS)) canister.velocity.x *= -bounciness;
      else p.x = nextX;
      const nextZ = p.z + canister.velocity.z * dt;
      if (boxAt(p.x, p.y, nextZ, RADIUS)) canister.velocity.z *= -bounciness;
      else p.z = nextZ;
      const nextY = p.y + canister.velocity.y * dt;
      if (boxAt(p.x, nextY, p.z, RADIUS)) {
        canister.velocity.y *= -bounciness;
        canister.velocity.x *= dragFriction;
        canister.velocity.z *= dragFriction;
      } else {
        p.y = nextY;
      }
      if (p.y < RADIUS) {
        p.y = RADIUS;
        canister.velocity.y = Math.abs(canister.velocity.y) * bounciness;
        if (canister.velocity.y < 1.0) canister.velocity.y = 0;
        canister.velocity.x *= dragFriction;
        canister.velocity.z *= dragFriction;
      }
      canister.mesh.position.copy(p);
      // A can that has come to rest sits level instead of rolling: below ~0.5 m/s
      // the wall test cannot resolve a clean bounce cycle.
      if (canister.velocity.lengthSq() < 0.25 && p.y <= RADIUS + 0.01) {
        canister.velocity.set(0, 0, 0);
      }
    }
  }

  return {
    throwGrenade,
    step,
    previewArc,
    hideArc,
    active,
    constants: { MIN_FUSE, MAX_FUSE, COOK_RATE, THROW_SPEED },
  };
}
