// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// Iron District, a round-based tactical FPS: the player's Coal side defends the device,
// the Torch bots attack along lanes and plant it, every gun in the game fires through one
// hitscan path, and money buys weapons and grenades between rounds. ?shot=start|play|end
// with &seed=N sets up a deterministic frame for a capture, renders it twice, then freezes
// it and sets window.__shotReady. No AudioContext anywhere, so a headless capture is clean.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, DEFENDER_SPAWNS, DEVICE_SPOT as BOMB_SPOT } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { createBots } from './bots.js';
import { createCombat, GUNS, GRENADE_PRICE, GRENADE_RADIUS, GRENADE_DAMAGE } from './combat.js';
import { createRounds } from './rounds.js';
import { createDevice } from './device.js';
import { createGrenades } from './grenades.js';
import { createHud } from './hud.js';
import { createKillcam } from './killcam.js';
import { createStats } from './stats.js';
import { createObjectives } from './objectives.js';
import { createSpotting } from './spotting.js';
import { registerExtraGuns, spreadCone, rangeScale, recoilWalk, extraBuyItems, gunDetail } from './weapons2.js';
import { createGrenades as createGrenadesV2 } from './grenades2.js';
import { createMinimap } from './minimap.js';
import { init as initRadar } from './radar.js';
import { createParticles } from './particles.js';
import { createAnnouncer } from './announce.js';
import { hasLineOfSight } from './physics.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const GRENADE_CAP = 2;

// The two extra guns register into the shared table before anything reads it: the
// weapon models, the buy catalog and the bot loadouts all see them for free.
registerExtraGuns(GUNS);

// Cook state for the held grenade: G pressed begins burning the fuse and drawing the
// arc, release throws with whatever fuse is left. A tap is a full-fuse lob.
const fuseCook = { holding: false, burned: 0 };

// Seeded generator for everything the simulation draws: spread jitter, bot decisions.
// Rendering reads no random numbers, so a seed replays identically.
function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.65;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 28, 78);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const combat = createCombat();
combat.setWorld(world.colliders);
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange, () => {
  // 'R' flips the radar overlay; the toggle returns the new visibility for the banner.
  const shown = radar.toggle();
  announcer.info(shown ? 'Radar on.' : 'Radar off.');
});
const device = createDevice(scene);
const grenades = createGrenades(scene, world.colliders);
const grenades2 = createGrenadesV2(scene, world.colliders);
const particles = createParticles(scene, random);
const announcer = createAnnouncer();
announcer.bind(document.getElementById('announcer'));
const minimap = createMinimap(document.getElementById('minimap-slot'));
const recoilModel = recoilWalk();
const killcam = createKillcam();
const stats = createStats();
const spotting = createSpotting(scene);
const objectives = createObjectives(scene, {
  onCaptured() {
    hud.setObjective('Mid point secured. It pays every fifteen seconds.');
    hud.showBanner('Mid point secured. +$500 every 15 s.');
    announcer.captured();
  },
  onPayout(amount) {
    rounds.state.money = Math.min(9000, rounds.state.money + amount);
    stats.recordCapturePayout();
    hud.setMoney(rounds.state.money);
    hud.showBanner(`Mid point pays $${amount}.`, 1400);
  },
  onLost() {
    hud.setObjective('Mid point lost. Take it back.');
    announcer.captureLost();
  },
});

const body = player.state;

// The one hitscan target list, rebuilt in place: the player first, then the bots.
const bodies = [body, null, null, null];
function targetList() {
  for (let index = 0; index < bots.bots.length; index += 1) bodies[index + 1] = bots.bots[index];
  return bodies;
}

const state = {
  started: false,
  frozen: false,
  buyOpen: false,
  carriedGrenades: 0,
  kills: 0,
  blasted: false,
};

// One tracer pool for every gun in the game, player and bots alike: 24 reusable
// line segments, each drawn for 50 ms before the slot goes back to the pool.
const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85 });
const tracers = [];
const tracerActive = [];
for (let index = 0; index < 24; index += 1) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geometry, tracerMaterial);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}

function spawnTracer(from, to) {
  let item = null;
  for (const candidate of tracers) {
    if (candidate.life <= 0) { item = candidate; break; }
  }
  if (!item) return;
  const positions = item.line.geometry.attributes.position.array;
  positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
  positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
  item.line.geometry.attributes.position.needsUpdate = true;
  item.line.visible = true;
  item.life = 0.05;
  tracerActive.push(item);
}

function stepTracers(dt) {
  for (let index = tracerActive.length - 1; index >= 0; index -= 1) {
    const item = tracerActive[index];
    item.life -= dt;
    if (item.life <= 0) {
      item.line.visible = false;
      tracerActive.splice(index, 1);
    }
  }
}

const tracerEnd = new THREE.Vector3();
// Reverse lookup from a gun table entry to its kind, built once so a kill can be
// filed under the right weapon without allocating in the shot path.
const GUN_KIND = new Map();
for (const kind of Object.keys(GUNS)) GUN_KIND.set(GUNS[kind], kind);

// The single hitscan path for every shot in the game, player or bot: trace, tracer,
// then either body damage with the range falloff, or a dust puff on whatever the
// round actually struck.
function fireHitscan(origin, aimVecV, gun, shooter) {
  stats.recordShot(GUN_KIND.get(gun));
  const hit = combat.trace(origin, aimVecV, 90, targetList(), shooter.team);
  if (hit && hit.point) spawnTracer(origin, hit.point);
  else {
    tracerEnd.copy(origin).addScaledVector(aimVecV, 90);
    spawnTracer(origin, tracerEnd);
  }
  if (!hit || hit.kind !== 'body') {
    if (hit && hit.point) particles.dustAt(hit.point);
    return;
  }
  const scale = rangeScale(gun, hit.distance);
  const damage = gun.damage * scale * (hit.part === 'head' ? gun.headMult : 1);
  const target = hit.body;
  if (target === body) {
    body.health -= damage;
    stats.recordDamageTaken(damage);
    hud.damageFlashPulse();
    hud.setHealth(Math.max(0, Math.round(body.health)));
    if (body.health <= 0 && body.alive) {
      body.alive = false;
      stats.recordDeath();
      hud.showBanner('You are down. Spectating until the round ends.');
      // Drop into the killcam orbit over whoever landed the shot, unless the
      // grenade blast path called with no shooter geometry to orbit.
      if (!shot && shooter && shooter.position) {
        killcam.start(shooter.position, body.position);
      }
    }
    return;
  }
  if (hit.point) particles.bloodAt(hit.point);
  stats.recordHit(GUN_KIND.get(gun), hit.part, damage);
  const killed = bots.damage(target, damage, hit.part);
  hud.hitMarker(killed, markerHoldMs);
  if (killed) {
    stats.recordKill(GUN_KIND.get(gun));
    state.kills += 1;
    rounds.state.killMoney += rounds.constants.KILL_REWARD;
    hud.setMoney(rounds.state.money + rounds.state.killMoney);
  }
}

const bots = createBots(scene, world.colliders, combat, random, {
  canSee(eye, target) {
    return hasLineOfSight(eye, target, world.colliders);
  },
  fire(bot, origin, aimVec, gun) {
    fireHitscan(origin, aimVec, gun, bot);
  },
  plant() {
    if (rounds.state.phase !== 'live' || rounds.state.devicePlanted) return;
    rounds.state.devicePlanted = true;
    rounds.state.fuse = rounds.constants.FUSE_TIME;
    device.group.visible = true;
    hud.showBanner('The device is planted.');
    hud.setObjective('Defuse the device or eliminate Torch.');
    announcer.bombPlanted();
  },
  plantTime() {
    return rounds.constants.PLANT_TIME;
  },
  onBotHurt(bot) {
    bot.holdTimer = Math.max(bot.holdTimer, 1.2);
  },
});

// The radar is the tactical dish overlay; it needs the camera for heading and the
// live bot list for blips. bots.bots is mutated in place, so the radar reads the
// same array the simulation steps each frame.
const radar = initRadar(document.getElementById('radar-slot'), scene, camera, bots.bots);

const rounds = createRounds({
  onRoundBegin(s) {
    hud.setRound(s.round);
    hud.showBanner(`Round ${s.round}. Buy your kit.`);
    hud.setObjective('Buy phase. Press B for the menu.');
    body.health = 100;
    body.alive = true;
    player.respawn(DEFENDER_SPAWNS[1][0], DEFENDER_SPAWNS[1][1]);
    weapon.refillGrenades(state.carriedGrenades);
    bots.spawnAll();
    device.group.visible = false;
    state.blasted = false;
    spotting.reset();
    objectives.reset();
    killcam.cancel();
    particles.reset();
    announcer.clear();
    recoilModel.reset();
    grenades2.hideArc();
    fuseCook.holding = false;
    hud.setScore(s.scores.coal, s.scores.torch);
    hud.setMoney(s.money);
    hud.setHealth(100);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    hud.setGrenades(state.carriedGrenades);
    if (!shot) openBuy();
  },
  onLive() {
    hud.showBanner('Live.', 900);
    hud.setObjective('Defend the device site. Watch mid and both lanes.');
    closeBuy();
  },
  onRoundEnd(s) {
    closeBuy();
    stats.recordRound(s.result === 'coal');
    hud.renderStats(stats);
    if (s.result === 'coal') announcer.roundWin();
    else announcer.roundLost();
    hud.showBanner(s.result === 'coal' ? `Round won. ${s.reason}` : `Round lost. ${s.reason}`, 3000);
    hud.setScore(s.scores.coal, s.scores.torch);
    hud.setMoney(s.money);
    if (!shot) {
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay(s.result === 'coal' ? 'won' : 'lost', s);
    }
  },
});

// The buy catalog, re-priced against the purse every time the menu opens. The two
// extra guns were registered into GUNS at boot, so they appear here without fuss.
const BUY_ITEMS = [
  { kind: 'cinder', name: GUNS.cinder.name, price: GUNS.cinder.price },
  { kind: 'smg', name: GUNS.smg.name, price: GUNS.smg.price },
  { kind: 'shotgun', name: GUNS.shotgun.name, price: GUNS.shotgun.price },
  { kind: 'rifle', name: GUNS.rifle.name, price: GUNS.rifle.price },
  { kind: 'sniper', name: GUNS.sniper.name, price: GUNS.sniper.price },
  { kind: 'grenade', name: 'Frag grenade', price: GRENADE_PRICE },
];

// The T panel: the same catalog with per-gun detail lines, for players who want the
// numbers before spending. It opens alongside the buy menu, never instead of it.
let detailOpen = false;
function toggleDetail() {
  detailOpen = !detailOpen;
  hud.toggleDetail(detailOpen
    ? Object.keys(GUNS).map((kind) => gunDetail(kind, GUNS[kind]))
    : null);
}

// Marks the owned rows against the current weapon and grenade cap before render.
function buyCatalog() {
  for (const item of BUY_ITEMS) {
    item.owned = item.kind === 'grenade'
      ? state.carriedGrenades >= GRENADE_CAP
      : weapon.state.gun === item.kind;
  }
  return BUY_ITEMS;
}

function openBuy() {
  state.buyOpen = true;
  hud.openBuy(buyCatalog(), rounds.state.money);
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeBuy() {
  state.buyOpen = false;
  hud.closeBuy();
  // Pointer lock needs a user gesture; the resume click provides it. Here we only
  // show the paused panel so the player can click back into the fight.
  if (state.started && !shot && rounds.state.phase !== 'over' && !document.pointerLockElement) {
    hud.showOverlay('paused', rounds.state);
  }
}

// A purchase: subtract the price, equip the gun or add the grenade, refresh the menu.
function handleBuyPick(kind) {
  if (kind === 'grenade') {
    if (rounds.state.money >= GRENADE_PRICE && state.carriedGrenades < GRENADE_CAP) {
      rounds.state.money -= GRENADE_PRICE;
      state.carriedGrenades += 1;
      weapon.refillGrenades(state.carriedGrenades);
      hud.setGrenades(state.carriedGrenades);
    }
  } else {
    const gun = GUNS[kind];
    if (gun && gun.price <= rounds.state.money && weapon.state.gun !== kind) {
      rounds.state.money -= gun.price;
      weapon.equip(kind);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    }
  }
  hud.setMoney(rounds.state.money);
  hud.refreshBuy(buyCatalog(), rounds.state.money);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    state.started = true;
    hud.hideOverlay();
  } else if (rounds.state.phase !== 'over' && !state.buyOpen) {
    hud.showOverlay('paused', rounds.state);
  }
}

// The camera rides the physics body: eye height while alive, a low spectate crouch
// when down, with the body's yaw and pitch as the view angles.
function syncCamera() {
  const eyeHeight = body.alive ? body.eye : 0.45;
  camera.position.set(body.position.x, body.position.y + eyeHeight, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

// Aim the body at a world point; used by the screenshot setups to pose the view.
function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

const aimVec = new THREE.Vector3();
// One scratch array for the shotgun's pellet vectors, sized once per cone.
const pelletPool = [];
const muzzlePoint = new THREE.Vector3();

// One trigger pull. The scatter gun samples its own pellet cone; every other gun
// flies a single jittered line. Muzzle flash and view recoil land after the shots.
function shoot(spread) {
  if (!weapon.takeRound()) return false;
  const gunDef = weapon.gun();
  camera.getWorldDirection(aimVec);
  if ((gunDef.pellets ?? 1) > 1) {
    aimVec.x += (random() * 2 - 1) * spread;
    aimVec.y += (random() * 2 - 1) * spread;
    aimVec.z += (random() * 2 - 1) * spread;
    aimVec.normalize();
    const count = spreadCone(gunDef, aimVec, random, pelletPool);
    scene.updateMatrixWorld(true);
    muzzlePoint.copy(camera.position).addScaledVector(aimVec, 0.7);
    particles.muzzleAt(muzzlePoint);
    for (let index = 0; index < count; index += 1) {
      fireHitscan(camera.position, pelletPool[index], gunDef, body);
    }
  } else {
    aimVec.x += (random() * 2 - 1) * spread;
    aimVec.y += (random() * 2 - 1) * spread;
    aimVec.z += (random() * 2 - 1) * spread;
    aimVec.normalize();
    scene.updateMatrixWorld(true);
    muzzlePoint.copy(camera.position).addScaledVector(aimVec, 0.7);
    particles.muzzleAt(muzzlePoint);
    fireHitscan(camera.position, aimVec, gunDef, body);
  }
  weapon.pullTrigger();
  const kick = recoilModel.shot(gunDef, random);
  player.recoil(kick.pitch + random() * 0.003, kick.yaw + (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

// Grenade splash against the player's side; the bots' splash lives in bots.js. A
// blast that downs the player is attributed to the nearest live bot for the killcam.
const blastPoint = new THREE.Vector3();
function blastAt(point) {
  blastPoint.copy(point);
  const dx = body.position.x - point.x;
  const dy = (body.position.y + 0.9) - point.y;
  const dz = body.position.z - point.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < GRENADE_RADIUS && body.alive) {
    body.health -= GRENADE_DAMAGE * (1 - distance / GRENADE_RADIUS);
    stats.recordDamageTaken(GRENADE_DAMAGE * (1 - distance / GRENADE_RADIUS));
    hud.damageFlashPulse();
    hud.setHealth(Math.max(0, Math.round(body.health)));
    if (body.health <= 0 && body.alive) {
      body.alive = false;
      stats.recordDeath();
      let nearest = null;
      let nearestDistance = Infinity;
      for (const bot of bots.bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.body.position.x - point.x, bot.body.position.z - point.z);
        if (d < nearestDistance) { nearestDistance = d; nearest = bot; }
      }
      if (!shot && nearest) killcam.start(nearest.body.position, body.position);
    }
  }
  bots.grenadeBlast(blastPoint);
  // A handful of short tracers sells the blast without a particle system.
  for (let index = 0; index < 6; index += 1) {
    spawnTracer(point, {
      x: point.x + (random() * 2 - 1) * 2.2,
      y: point.y + (random() * 2 - 1) * 1.6,
      z: point.z + (random() * 2 - 1) * 2.2,
    });
  }
}

// Defusing: hold E within reach of the planted device and the progress bar fills.
// Progress resets when the player lets go, dies or walks away.
function stepDefuse(dt) {
  const s = rounds.state;
  if (!s.devicePlanted || s.phase !== 'live' || !body.alive) {
    s.defuseProgress = 0;
    if (s.devicePlanted && s.phase === 'live') hud.setObjective('Defuse the device: hold E at the site.');
    return;
  }
  const dx = body.position.x - BOMB_SPOT[0];
  const dz = body.position.z - BOMB_SPOT[1];
  const inReach = Math.hypot(dx, dz) < 1.8 && input.state.keys.has('KeyE');
  if (!inReach) {
    s.defuseProgress = 0;
    hud.setObjective('Get to the device and hold E to defuse.');
    return;
  }
  s.defuseProgress += dt;
  hud.setObjective(`Defusing: ${Math.round((s.defuseProgress / rounds.constants.DEFUSE_TIME) * 100)}%`);
}

// Grenade throw with fuseCook: pressing G starts the burn and draws the arc, releasing
// throws with the remaining fuse. The whole flow lives in the frame update because
// it is input-shaped; the simulation only sees the thrown can.
function stepGrenadeThrow() {
  const holding = input.state.keys.has('KeyG') && weapon.state.grenades > 0;
  if (holding && !fuseCook.holding) {
    fuseCook.holding = true;
    fuseCook.burned = 0;
  }
  if (fuseCook.holding) {
    if (holding) {
      fuseCook.burned += FIXED_STEP;
      camera.getWorldDirection(aimVec);
      grenades2.previewArc(camera.position, aimVec, grenades2.constants.THROW_SPEED);
    } else {
      fuseCook.holding = false;
      grenades2.hideArc();
      weapon.state.grenades -= 1;
      state.carriedGrenades = weapon.state.grenades;
      hud.setGrenades(weapon.state.grenades);
      camera.getWorldDirection(aimVec);
      grenades2.throwGrenade(camera.position, aimVec, grenades2.constants.THROW_SPEED, fuseCook.burned);
    }
  }
}

function step(dt) {
  uptime += dt;
  rounds.step(dt, {
    player: body.alive,
    torch: bots.aliveCount(),
    coalTeammates: 0,
  });

  if (rounds.state.phase !== 'over') {
    player.step(dt, input.state.keys);
    stepDefuse(dt);
    weapon.step(dt);
    stepGrenadeThrow();
    const targets = targetList();
    for (let index = 0; index < bots.bots.length; index += 1) {
      bots.step(bots.bots[index], dt, targets, rounds.state);
    }
    grenades.step(dt, blastAt);
    grenades2.step(dt, blastAt);
    device.step(uptime, rounds.state.devicePlanted);
    objectives.step(dt, body, bots.bots, rounds.state);
    spotting.step(dt, body, bots.bots, (from, to) => hasLineOfSight(from, to, world.colliders), input.state.keys, rounds.state);
    particles.step(dt);
    announcer.step(dt * 1000);
    // Recoil walk-back runs every step but contributes nothing while firing.
    const relax = recoilModel.step(dt, weapon.gun(), input.state.firing && rounds.state.phase === 'live');
    if (relax.pitch !== 0 || relax.yaw !== 0) player.recoil(relax.pitch, relax.yaw);
    minimap.draw({
      playerX: body.position.x,
      playerZ: body.position.z,
      playerYaw: body.yaw,
      spottedBots: bots.bots.filter((bot) => spotting.isSpotted(bot)),
      devicePlanted: rounds.state.devicePlanted,
      captureOwner: objectives.state.owner,
      captureContested: objectives.state.contested,
    });
  }

  // Killcam: while it runs the orbit owns the camera; the first-person pose comes
  // back on the step it ends. Shot mode never starts one, so captures stay posed.
  if (killcam.active()) {
    if (!killcam.step(camera, dt)) syncCamera();
    stepTracers(dt);
    return;
  }

  // Detonation: one blast when the fuse runs out, then the round has already ended.
  if (rounds.state.phase === 'over' && rounds.state.reason === 'The device detonated' && !state.blasted) {
    state.blasted = true;
    device.group.visible = false;
    blastAt({ x: BOMB_SPOT[0], y: 0.5, z: BOMB_SPOT[1] });
  }
  stepTracers(dt);
}

// A kill marker stays pinned on screen in shot mode so captures always show one.
const markerHoldMs = shot ? 4000 : 90;
let uptime = 0;
let accumulator = 0;
let lastTime = performance.now();

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'over') {
    rounds.beginRound(rounds.state.money);
    return;
  }
  input.requestLock();
});
hud.onBuyPick(handleBuyPick);
hud.onBuyClose(closeBuy);

// Buy menu toggle on B, weapon details on T, both only between rounds or live play
// outside pointer lock; the detail panel never pauses anything.
window.addEventListener('keydown', (event) => {
  if (shot) return;
  if (event.code === 'KeyB') {
    if (state.buyOpen) closeBuy();
    else if (rounds.state.phase === 'buy') openBuy();
  } else if (event.code === 'KeyT') {
    toggleDetail();
  }
});

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!state.frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (input.state.keys.has('KeyR')) weapon.reload();
    // Quick-tap grenade: a G press consumed here is the legacy full-fuse lob;
    // a held G is picked up by the fuseCook path in the fixed step instead.
    if (input.state.keys.has('KeyG') && weapon.state.grenades > 0 && !weapon.pulling()) {
      input.state.keys.delete('KeyG');
      weapon.state.grenades -= 1;
      state.carriedGrenades = weapon.state.grenades;
      hud.setGrenades(weapon.state.grenades);
      camera.getWorldDirection(aimVec);
      grenades.throwGrenade(camera.position, aimVec, 13);
    }
    if (rounds.state.phase === 'live' && body.alive && input.state.firing && !state.buyOpen) {
      const semi = !weapon.gun().auto;
      if (!semi || input.takePress()) {
        shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

// Advances the simulation a fixed number of steps with no rendering: how the
// screenshot setups reach a settled pose deterministically.
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

// Deterministic screenshot setup, adapted to the round system:
//   start - the overlay panel, the player at spawn looking down mid.
//   play  - a live round mid-fight, three bots in the yard, one just downed.
//   end   - the round-won state after the Torch squad is eliminated.
function runShot(name) {
  hud.hideOverlay();
  body.pitch = 0;
  body.yaw = 0;
  state.carriedGrenades = 1;
  rounds.state.money = 2700;
  weapon.equip('rifle');
  weapon.refillGrenades(1);

  if (name === 'start') {
    body.position.x = 0; body.position.z = 13.0;
    bots.spawnAll();
    settle(10);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.setScore(0, 0);
    hud.setRound(1);
    hud.setMoney(rounds.state.money);
    hud.setHealth(100);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    hud.setGrenades(1);
    hud.setTimer(rounds.state.timer);
    hud.setObjective('Defend the device site.');
    hud.showOverlay('start', rounds.state);
  } else if (name === 'play') {
    rounds.state.phase = 'live';
    rounds.state.timer = 74;
    rounds.state.scores.coal = 2;
    rounds.state.scores.torch = 1;
    rounds.state.round = 4;
    body.position.x = -4.0; body.position.z = 6.0;
    bots.spawnAll();
    // Place the squad so the fight reads in the frame.
    const poses = [[0.5, -2.0], [11.0, -6.0], [-11.5, -3.0]];
    for (let index = 0; index < bots.bots.length; index += 1) {
      bots.bots[index].body.position.x = poses[index][0];
      bots.bots[index].body.position.z = poses[index][1];
      bots.bots[index].mode = 'hold';
      bots.bots[index].holdTimer = 3;
    }
    settle(6);
    const target = bots.bots[0];
    aimAt(new THREE.Vector3(target.body.position.x, 1.0, target.body.position.z));
    shoot(0);
    bots.damage(target, 200, 'torso');
    hud.setScore(rounds.state.scores.coal, rounds.state.scores.torch);
    hud.setMoney(rounds.state.money);
    hud.setHealth(87);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    hud.setGrenades(1);
    hud.setTimer(rounds.state.timer);
    hud.setRound(4);
    hud.setObjective('Defend the device site. Watch mid and both lanes.');
    hud.showBanner('Live.', 900);
    settle(2);
  } else {
    rounds.state.phase = 'over';
    rounds.state.result = 'coal';
    rounds.state.reason = 'Torch eliminated';
    rounds.state.scores.coal = 3;
    rounds.state.scores.torch = 1;
    rounds.state.round = 5;
    rounds.state.money = 5950;
    body.position.x = -2.0; body.position.z = 9.0;
    bots.spawnAll();
    for (const bot of bots.bots) {
      bot.alive = false;
      bot.mesh.group.visible = false;
    }
    settle(6);
    aimAt(new THREE.Vector3(0, 1.2, -10));
    hud.setScore(3, 1);
    hud.setMoney(5950);
    hud.setHealth(64);
    hud.setAmmo(24, 90);
    hud.setGrenades(0);
    hud.setTimer(0);
    hud.setRound(5);
    hud.showOverlay('won', rounds.state);
  }

  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  paintTwiceThenReady();
}

// Paint the settled frame twice, then freeze the loop and flag the capture ready:
// two rAF passes let shadows and post state settle before the pixel grab. A spinning
// rAF after that would burn the capture's virtual-time budget, so it stops.
function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      state.frozen = true;
      return;
    }
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A starting weapon so the first frame never shows an empty model.
weapon.equip('rifle');
syncCamera();
if (shot) runShot(shot);
else {
  rounds.beginRound(rounds.state.money);
  requestAnimationFrame(frame);
}
