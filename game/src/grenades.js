// Grenades: a thrown canister, an arc, a fuse, a blast. One shared pool, reused meshes,
// no per-frame allocation. The bounce reuses the same overlap idea physics.js uses.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { GRENADE_FUSE } from './combat.js';

const GRAVITY = 20;
const THROW_SPEED = 13;
const RESTITUTION = 0.35;

export function createGrenades(scene, colliders) {
  const pool = [];
  const active = [];
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const geometry = new THREE.SphereGeometry(0.09, 10, 8);

  function acquire() {
    let item = pool.pop();
    if (!item) {
      item = { mesh: new THREE.Mesh(geometry, material), velocity: new THREE.Vector3(), fuse: 0, live: false };
      item.mesh.castShadow = true;
      scene.add(item.mesh);
    }
    item.mesh.visible = true;
    item.live = true;
    return item;
  }

  function throwGrenade(origin, direction, speed = THROW_SPEED) {
    const item = acquire();
    item.mesh.position.copy(origin);
    item.velocity.copy(direction).normalize().multiplyScalar(speed);
    item.velocity.y += 3.2;
    item.fuse = GRENADE_FUSE;
    active.push(item);
    return item;
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
        onBlast(item.mesh.position);
        continue;
      }
      const p = item.mesh.position;
      item.velocity.y -= GRAVITY * dt;
      const nextX = p.x + item.velocity.x * dt;
      const nextY = p.y + item.velocity.y * dt;
      const nextZ = p.z + item.velocity.z * dt;
      // Cheap point collision: sample the world boxes.
      let bounced = false;
      for (let c = 0; c < colliders.length; c += 1) {
        const box = colliders[c];
        if (nextX > box.min.x - 0.1 && nextX < box.max.x + 0.1 && nextY > box.min.y - 0.1 && nextY < box.max.y + 0.1
          && nextZ > box.min.z - 0.1 && nextZ < box.max.z + 0.1) {
          bounced = true;
          break;
        }
      }
      if (bounced) {
        item.velocity.x *= -RESTITUTION;
        item.velocity.z *= -RESTITUTION;
        item.velocity.y *= -RESTITUTION;
        if (Math.abs(item.velocity.y) < 1.5) item.velocity.y = 0;
      } else {
        p.set(nextX, nextY, nextZ);
      }
      if (p.y < 0.09) {
        p.y = 0.09;
        item.velocity.y = Math.abs(item.velocity.y) * RESTITUTION;
        if (item.velocity.y < 1.0) item.velocity.y = 0;
        item.velocity.x *= 0.86;
        item.velocity.z *= 0.86;
      }
    }
  }

  return { throwGrenade, step, active };
}
