// Impact particles: dust when a wall eats a bullet, blood spray when a body does,
// and a muzzle puff that is not just the flat flash quad. One pool of 200 sprites,
// no allocation after boot, and a fade driven by a fixed-rate clock so a seeded run
// of the same fight spawns and kills the same particles in the same order.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const POOL = 200;
const DUST_LIFE = 0.5;
const BLOOD_LIFE = 0.35;
const MUZZLE_LIFE = 0.08;
const GRAVITY = 6.0;

export function createParticles(scene, random) {
  // One shared Points cloud: 200 quads in a single draw call, positions and alphas
  // rewritten in place. Sorting per-particle is skipped deliberately — with additive
  // blending and small sprites the depth sort costs more than it shows.
  const positions = new Float32Array(POOL * 3);
  const alphas = new Float32Array(POOL);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  const dustMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.muted), size: 0.12, transparent: true, depthWrite: false,
    vertexColors: false, sizeAttenuation: true,
  });
  const cloud = new THREE.Points(geometry, dustMaterial);
  cloud.frustumCulled = false;
  scene.add(cloud);

  const items = [];
  for (let index = 0; index < POOL; index += 1) {
    items.push({
      free: true,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 0,
    });
    // Park unused particles under the floor so the cloud shows nothing at rest.
    positions[index * 3 + 1] = -10;
  }
  let cursor = 0;

  function acquire() {
    // Round-robin over the pool: the oldest burst is overwritten when the pool is
    // exhausted, which for impact sprites is invisible in practice.
    for (let tries = 0; tries < POOL; tries += 1) {
      const item = items[cursor];
      cursor = (cursor + 1) % POOL;
      if (item.free) return item;
    }
    return items[0];
  }

  function spawn(x, y, z, life, spread, speed) {
    const item = acquire();
    item.free = false;
    item.x = x;
    item.y = y;
    item.z = z;
    // Isotropic burst: each axis gets its own share of the speed, so a cloud spreads
    // in three dimensions instead of flying as a beam. The generator is the caller's
    // seeded one, so a seed reproduces the same cloud tick for tick.
    item.vx = (random() * 2 - 1) * speed;
    item.vy = (random() * 2 - 1) * speed * 0.6 + speed * 0.35;
    item.vz = (random() * 2 - 1) * speed;
    item.maxLife = life;
    item.life = life;
  }

  function dustAt(point) {
    for (let count = 0; count < 5; count += 1) {
      spawn(point.x, point.y, point.z, DUST_LIFE, 0.1, 1.6);
    }
  }

  function bloodAt(point) {
    for (let count = 0; count < 4; count += 1) {
      spawn(point.x, point.y, point.z, BLOOD_LIFE, 0.05, 2.4);
    }
  }

  function muzzleAt(point) {
    spawn(point.x, point.y, point.z, MUZZLE_LIFE, 0.02, 1.0);
  }

  function step(dt) {
    for (let index = 0; index < POOL; index += 1) {
      const item = items[index];
      if (item.free) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.free = true;
        positions[index * 3 + 1] = -10;
        alphas[index] = 0;
        continue;
      }
      item.vy -= GRAVITY * dt;
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.z += item.vz * dt;
      positions[index * 3] = item.x;
      positions[index * 3 + 1] = item.y;
      positions[index * 3 + 2] = item.z;
      alphas[index] = item.life / item.maxLife;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;
  }

  function reset() {
    for (let index = 0; index < POOL; index += 1) {
      items[index].free = true;
      positions[index * 3 + 1] = -10;
      alphas[index] = 0;
    }
    cursor = 0;
  }

  return { step, dustAt, bloodAt, muzzleAt, reset, constants: { POOL } };
}
