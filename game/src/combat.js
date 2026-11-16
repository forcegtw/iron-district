// One hitscan implementation for every gun and every shooter: player and bots alike.
// A shot is an origin, a direction and a damage model; the ray steps the world's
// colliders and every body's two hit zones (head sphere, torso sphere) and returns
// the nearest. Scratch vectors are reused: nothing is allocated in the hot loop.
import * as THREE from 'three';

const HEAD_RADIUS = 0.19;
const TORSO_RADIUS = 0.38;
const TORSO_TOP = 1.55;
const TORSO_BOTTOM = 0.25;

export function createCombat() {
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const center = new THREE.Vector3();
  const toCenter = new THREE.Vector3();
  const boxPoint = new THREE.Vector3();

  function sphereHit(originV, directionV, cx, cy, cz, radius, maxDist) {
    center.set(cx, cy, cz);
    toCenter.subVectors(center, originV);
    const along = toCenter.dot(directionV);
    if (along < 0 || along > maxDist) return -1;
    const squared = toCenter.lengthSq() - along * along;
    const r2 = radius * radius;
    if (squared > r2) return -1;
    return along - Math.sqrt(r2 - squared);
  }

  function boxHit(originV, directionV, box, maxDist) {
    // Ray against an axis-aligned box: returns the entry distance or -1.
    let tNear = 0;
    let tFar = maxDist;
    const mins = [box.min.x, box.min.y, box.min.z];
    const maxs = [box.max.x, box.max.y, box.max.z];
    const o = [originV.x, originV.y, originV.z];
    const d = [directionV.x, directionV.y, directionV.z];
    for (let axis = 0; axis < 3; axis += 1) {
      if (Math.abs(d[axis]) < 1e-9) {
        if (o[axis] < mins[axis] || o[axis] > maxs[axis]) return -1;
        continue;
      }
      let t1 = (mins[axis] - o[axis]) / d[axis];
      let t2 = (maxs[axis] - o[axis]) / d[axis];
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
      if (t1 > tNear) tNear = t1;
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar) return -1;
    }
    return tNear > 0 ? tNear : -1;
  }

  // bodies: array of { position:{x,y,z}, alive, team, isCrouching }
  // Returns { kind:'body'|'world'|null, body, part, distance, point }
  function trace(originV, directionV, far, bodies, shooterTeam) {
    let best = null;
    let bestDistance = far;

    for (let index = 0; index < bodies.length; index += 1) {
      const target = bodies[index];
      if (!target || !target.alive || target.team === shooterTeam) continue;
      const p = target.position;
      const crouch = target.isCrouching ? 0.55 : 0;
      const headY = p.y + 1.55 - crouch;
      const tHead = sphereHit(originV, directionV, p.x, headY, p.z, HEAD_RADIUS, bestDistance);
      if (tHead >= 0) {
        bestDistance = tHead;
        best = { kind: 'body', body: target, part: 'head', distance: tHead };
      }
      const torsoY = p.y + (TORSO_TOP + TORSO_BOTTOM) / 2 - crouch;
      const tTorso = sphereHit(originV, directionV, p.x, torsoY, p.z, TORSO_RADIUS, bestDistance);
      if (tTorso >= 0) {
        bestDistance = tTorso;
        best = { kind: 'body', body: target, part: 'torso', distance: tTorso };
      }
    }

    for (let index = 0; index < worldBoxes.length; index += 1) {
      const t = boxHit(originV, directionV, worldBoxes[index], bestDistance);
      if (t >= 0) {
        bestDistance = t;
        best = { kind: 'world', body: null, part: null, distance: t };
      }
    }

    if (!best) return best;
    boxPoint.copy(originV).addScaledVector(directionV, best.distance);
    best.point = boxPoint;
    return best;
  }

  let worldBoxes = [];
  function setWorld(boxes) { worldBoxes = boxes; }

  return { trace, setWorld, origin, direction };
}

// Gun definitions shared by the player and the bots. Damage numbers and prices in
// one table; the buy menu, the weapon models and the bot loadouts all read it.
export const GUNS = {
  pistol: { name: 'Sidearm P9', damage: 26, headMult: 3.0, fireGap: 0.17, mag: 12, reserve: 36, reloadTime: 1.4, spreadStill: 0.004, spreadMove: 0.022, moveRef: 5.2, recoil: 0.010, price: 0, auto: false },
  rifle: { name: 'Carbine C7', damage: 31, headMult: 3.4, fireGap: 0.105, mag: 30, reserve: 90, reloadTime: 1.9, spreadStill: 0.0025, spreadMove: 0.030, moveRef: 5.2, recoil: 0.009, price: 2700, auto: true },
  smg: { name: 'Rattler SMG', damage: 22, headMult: 2.6, fireGap: 0.075, mag: 32, reserve: 96, reloadTime: 1.7, spreadStill: 0.005, spreadMove: 0.020, moveRef: 5.2, recoil: 0.007, price: 1600, auto: true },
  sniper: { name: 'Longbow DMR', damage: 88, headMult: 2.2, fireGap: 0.9, mag: 5, reserve: 20, reloadTime: 2.6, spreadStill: 0.0008, spreadMove: 0.06, moveRef: 5.2, recoil: 0.028, price: 3800, auto: false },
};

export const GRENADE_PRICE = 300;
export const GRENADE_DAMAGE = 90;
export const GRENADE_RADIUS = 4.5;
export const GRENADE_FUSE = 1.6;
