// Two more guns and the models behind their feel: a pump shotgun that trades reach
// for a brutal close-range cone, and an economy SMG that sprays fast but pays for it
// in recoil that walks. Both register into the shared GUNS table so the buy menu,
// the bot loadouts and the single hitscan path see them without special cases.
//
// Balance notes sit next to the numbers: every value here was picked against a
// 100 HP body and a 0.4 s human reaction, so a duel has a winner before it drags.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const extraGuns = {
  shotgun: {
    name: 'Breaker 12',
    // 8 pellets x 13 = 104 at the muzzle: a clean one-shot only if the whole cone
    // lands on the chest inside 5 m, exactly the range a defender gives up map
    // control to hold.
    damage: 13,
    headMult: 2.0,      // every pellet in the head is 208: lethal, but rare
    pellets: 8,
    cone: 0.085,        // radians of half-angle: 0.9 m wide at 10 m, wider than a torso
    falloffNear: 6,     // full damage inside this range
    falloffFar: 26,     // and 35% of it beyond, so a lane shot warns instead of killing
    falloffFloor: 0.35,
    fireGap: 0.78,      // pump cycle: no spam, so the first shot has to count
    mag: 6,
    reserve: 24,
    reloadTime: 2.7,
    spreadStill: 0.010,
    spreadMove: 0.048,  // moving with a shotgun is punished harder than with a rifle
    moveRef: 5.2,
    recoil: 0.030,
    price: 1200,
    auto: false,
    recovery: 0.42,     // share of the kick the view walks back out of
  },
  cinder: {
    name: 'Cinder 9',
    // 15 damage every 0.052 s: seven rounds (0.36 s) to drop a body versus the
    // carbine's four (0.32 s). Cheaper and faster but weaker per pull — the eco
    // answer to a lost round, not a replacement for the rifle.
    damage: 15,
    headMult: 2.4,
    pellets: 1,
    fireGap: 0.052,
    mag: 40,
    reserve: 120,
    reloadTime: 1.75,
    spreadStill: 0.006,
    spreadMove: 0.034,
    moveRef: 5.2,
    recoil: 0.0055,
    price: 1100,
    auto: true,
    recovery: 0.62,     // most of the climb comes back: sustained spray stays aimable
  },
};

// Registers the two guns into the shared table in place. Called once at boot, before
// any model is built or any price is read, so nothing else needs to know they are new.
export function registerExtraGuns(guns) {
  for (const kind of Object.keys(extraGuns)) {
    if (!guns[kind]) guns[kind] = extraGuns[kind];
  }
  return guns;
}

// Range multiplier on damage: flat inside falloffNear, linear down to the floor at
// falloffFar. Guns without falloff data return 1 (rifle, SMG, pistol, DMR).
export function rangeScale(gun, distance) {
  if (!gun.falloffNear) return 1;
  if (distance <= gun.falloffNear) return 1;
  if (distance >= gun.falloffFar) return gun.falloffFloor;
  const t = (distance - gun.falloffNear) / (gun.falloffFar - gun.falloffNear);
  return 1 - t * (1 - gun.falloffFloor);
}

// Scatter directions for one trigger pull, written into a caller-owned array of
// vectors so no Vector3 is allocated while firing. The radius is sampled with a
// square root so pellets spread evenly across the disc instead of bunching mid-cone.
export function spreadCone(gun, direction, random, out) {
  const count = gun.pellets ?? 1;
  for (let index = 0; index < count; index += 1) {
    const target = out[index] ?? (out[index] = new THREE.Vector3());
    target.copy(direction);
    if (count > 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * gun.cone;
      target.x += Math.cos(angle) * radius;
      target.y += Math.sin(angle) * radius;
    }
    target.normalize();
  }
  return count;
}

// View recoil as a small state machine: kick on the shot, climb while the trigger is
// held, then walk the view back after release. player.js only knows how to add a
// delta, so the walk-back arrives here as negative deltas spread over time.
export function recoilWalk() {
  let climb = 0;        // 0..1, how deep into a burst the trigger is
  let debtPitch = 0;    // accumulated kick not yet walked out
  let debtYaw = 0;

  function shot(gun, random) {
    climb = Math.min(1, climb + 0.22);
    // The multiplier caps at 1.55x: a spray climbs, it never becomes unaimable.
    const scale = 1 + climb * 0.55;
    debtPitch += gun.recoil * scale;
    debtYaw += (random() * 2 - 1) * gun.recoil * 0.35;
    return { pitch: gun.recoil * scale, yaw: (random() * 2 - 1) * gun.recoil * 0.35 };
  }

  // Called every fixed step. Returns the delta to add to the view, and is zero while
  // the trigger is down so spraying still climbs.
  function step(dt, gun, firing) {
    climb = Math.max(0, climb - dt * 1.7);
    if (firing || !gun) return { pitch: 0, yaw: 0 };
    const rate = (gun.recovery ?? 0.45) * dt * 2.6;
    const pitch = debtPitch * Math.min(1, rate);
    const yaw = debtYaw * Math.min(1, rate);
    debtPitch -= pitch;
    debtYaw -= yaw;
    return { pitch: -pitch, yaw: -yaw };
  }

  return {
    shot,
    step,
    reset() { climb = 0; debtPitch = 0; debtYaw = 0; },
  };
}

// The two view models, shaped from the same three materials the other guns use: a wide
// bore and a tube magazine for the shotgun, a stubby receiver with a tall magazine for
// the SMG.
export function extraModel(kind, materials) {
  if (kind !== 'shotgun' && kind !== 'cinder') return null;
  const model = new THREE.Group();
  if (kind === 'shotgun') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.30), materials.metal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.62, 10), materials.grip);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.46);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.48, 8), materials.metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.03, -0.40);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.14), materials.accent);
    pump.position.set(0, -0.03, -0.26);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.26), materials.grip);
    stock.position.set(0, -0.02, 0.26);
    model.add(receiver, barrel, tube, pump, stock);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.26), materials.metal);
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.20, 10), materials.grip);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(0, 0.02, -0.30);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.20, 0.06), materials.accent);
    magazine.position.set(0, -0.14, -0.04);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), materials.grip);
    brace.position.set(0, -0.01, 0.19);
    model.add(receiver, shroud, magazine, brace);
  }
  model.position.set(0.24, -0.2, -0.42);
  model.visible = false;
  return model;
}

// Buy-menu rows for the two new guns, in the shape the HUD catalog already takes.
export function extraBuyItems() {
  return [
    { kind: 'shotgun', name: extraGuns.shotgun.name, price: extraGuns.shotgun.price },
    { kind: 'cinder', name: extraGuns.cinder.name, price: extraGuns.cinder.price },
  ];
}

// Detail lines for the T panel: the numbers a player actually compares, kept short
// enough to read during a buy phase rather than a full stat sheet.
export function gunDetail(kind, gun) {
  const rpm = Math.round(60 / gun.fireGap);
  const lines = [
    ['Damage', `${gun.damage}${gun.pellets > 1 ? ` x${gun.pellets}` : ''}`],
    ['Head', `x${gun.headMult}`],
    ['Rate', `${rpm} rpm`],
    ['Magazine', `${gun.mag} / ${gun.reserve}`],
    ['Reload', `${gun.reloadTime.toFixed(1)} s`],
  ];
  if (gun.falloffNear) lines.push(['Falloff', `${gun.falloffNear}-${gun.falloffFar} m`]);
  lines.push(['Price', `$${gun.price}`]);
  return { kind, name: gun.name, lines };
}

// The palette is imported for the shared tone of the model materials; referenced here
// so a bundler cannot tree-shake a module the view models depend on.
export const ACCENT = PALETTE.accent;
