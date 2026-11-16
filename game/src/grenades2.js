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
const RESTITUTION = 0.42;
const FRICTION = 0.82;
const MIN_FUSE = 0.35;     // a fully cooked can still gives you this long to move
const MAX_FUSE = 2.6;
const COOK_RATE = 1.0;     // seconds of fuse burned per second of held G
const ARC_STEPS = 18;
const ARC_TIME = 1.0;

export function createGrenades(scene, colliders) {
  const pool = [];
  const active = [];
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const geometry = new THREE.SphereGeometry(RADIUS, 10, 8);

  // The predicted flight: one shared line whose points are rewritten each frame while
  // the throw is charged. It is the only new geometry the system allocates.
  const arcPositions = new Float32Array(ARC_STEPS * 3);
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
  const arcLine = new THREE.Line(arcGeometry, new THREE.LineDashedMaterial({
    color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0.5, dashSize: 0.22, gapSize: 0.14,
  }));
  arcLine.visible = false;
  arcLine.frustumCulled = false;
  scene.add(arcLine);

  function acquire() {
    let item = pool.pop();
    if (!item) {
      item = {
        mesh: new THREE.Mesh(geometry, material),
        velocity: new THREE.Vector3(),
        position: new THREE.Vector3(),
        fuse: 0,
        live: false,
      };
      item.mesh.castShadow = true;
      scene.add(item.mesh);
    }
    item.mesh.visible = true;
    item.live = true;
    return item;
  }

  // First box whose bounds contain the point, or null. One pass, no allocation.
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
    const item = acquire();
    item.position.copy(origin);
    item.velocity.copy(direction).normalize().multiplyScalar(speed);
    // The lob is what makes a can clear the mid-lane rail instead of dying against it.
    item.velocity.y += 3.6;
    item.fuse = Math.max(MIN_FUSE, MAX_FUSE - cook);
    item.mesh.position.copy(item.position);
    active.push(item);
    return item;
  }

  // Predicts the arc for the indicator by integrating the same gravity the sim uses,
  // stopping the preview at the first surface it would strike.
  function previewArc(origin, direction, speed = THROW_SPEED) {
    let x = origin.x;
    let y = origin.y;
    let z = origin.z;
    const vx = direction.x * speed;
    const vy = direction.y * speed + 3.6;
    const vz = direction.z * speed;
    const dt = ARC_TIME / ARC_STEPS;
    let stopped = false;
    for (let step = 0; step < ARC_STEPS; step += 1) {
      const t = (step + 1) * dt;
      const px = x + vx * t;
      const py = y + vy * t - 0.5 * GRAVITY * t * t;
      const pz = z + vz * t;
      if (!stopped && (py < RADIUS || boxAt(px, py, pz, RADIUS))) stopped = true;
      // Once the arc strikes, the remaining points collapse onto the hit so the line
      // reads as a stub that ends there rather than a line running through a wall.
      arcPositions[step * 3] = stopped ? x : px;
      arcPositions[step * 3 + 1] = stopped ? y : py;
      arcPositions[step * 3 + 2] = stopped ? z : pz;
      if (!stopped) { x = px; y = py; z = pz; }
    }
    arcGeometry.attributes.position.needsUpdate = true;
    arcLine.computeLineDistances();
    arcLine.visible = true;
  }

  function hideArc() {
    arcLine.visible = false;
  }

  function step(dt, onBlast) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const item = active[index];
      item.fuse -= dt;
      if (item.fuse <= 0) {
        item.mesh.visible = false;
        item.live = false;
        active.splice(index, 1);
        pool.push(item);
        onBlast(item.position);
        continue;
      }
      const p = item.position;
      item.velocity.y -= GRAVITY * dt;
      // Axis-separated sweep: move x, test, then z, then y. Each axis that ends up
      // inside a box is undone and reflected, which is what makes a corner bounce
      // send the can back out of the corner instead of through it.
      const nextX = p.x + item.velocity.x * dt;
      if (boxAt(nextX, p.y, p.z, RADIUS)) item.velocity.x *= -RESTITUTION;
      else p.x = nextX;
      const nextZ = p.z + item.velocity.z * dt;
      if (boxAt(p.x, p.y, nextZ, RADIUS)) item.velocity.z *= -RESTITUTION;
      else p.z = nextZ;
      const nextY = p.y + item.velocity.y * dt;
      if (boxAt(p.x, nextY, p.z, RADIUS)) {
        item.velocity.y *= -RESTITUTION;
        item.velocity.x *= FRICTION;
        item.velocity.z *= FRICTION;
      } else {
        p.y = nextY;
      }
      if (p.y < RADIUS) {
        p.y = RADIUS;
        item.velocity.y = Math.abs(item.velocity.y) * RESTITUTION;
        if (item.velocity.y < 1.0) item.velocity.y = 0;
        item.velocity.x *= FRICTION;
        item.velocity.z *= FRICTION;
      }
      item.mesh.position.copy(p);
      // A can that has come to rest sits level instead of rolling: a bounce cycle of
      // less than 0.5 m/s is below what the wall test can resolve cleanly.
      if (item.velocity.lengthSq() < 0.25 && p.y <= RADIUS + 0.01) {
        item.velocity.set(0, 0, 0);
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
