// The Torch squad: three bots that walk lanes, hold positions, react to what they see,
// plant the device at the site and shoot with the same hitscan the player uses.
// Deterministic: every random draw comes from the shared seeded generator, so a seed
// plays out the same round every time. HOLD_TIME is the main pressure knob: shorter
// holds push the squad onto the objective sooner.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ROUTES as PATHS, DEVICE_SPOT as BOMB_SPOT, ATTACKER_SPAWNS } from './world.js';
import { makeBody, moveBody, footSpeed } from './physics.js';
import { GUNS, GRENADE_RADIUS, GRENADE_DAMAGE } from './combat.js';

const HEALTH = 100;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const HEIGHT_STAND = 1.72;
const WALK_SPEED = 3.8;      // brisk patrol pacing keeps bots from lagging the player
const HOLD_TIME = 2.4;       // trimmed so holding bots re-engage lanes sooner
const REACTION_TIME = 0.4;
const ACCURACY = 0.08;       // aim jitter in radians, wider on the move and at range
const FIRE_GAP_BOT = 0.5;

// Reused vectors: nothing in the per-bot step allocates.
const scratchEye = new THREE.Vector3();
const scratchSeen = new THREE.Vector3();

// One low-poly figure: dark torso and legs, accent-coloured head, all shadowed.
function makeBotMesh(scene) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.1 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), bodyMaterial);
  torso.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), headMaterial);
  head.position.y = 1.53;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.28), bodyMaterial);
  legs.position.y = 0.38;
  group.add(torso, head, legs);
  group.traverse((figure) => { if (figure.isMesh) { figure.castShadow = true; figure.receiveShadow = true; } });
  group.visible = false;
  scene.add(group);
  return { group, torso, head, legs };
}

export function createBots(scene, colliders, combat, random, hooks) {
  const bots = [];
  const eye = new THREE.Vector3();

  // Three bots with fixed roles and lanes: the carrier plants, the others cover.
  for (let index = 0; index < 3; index += 1) {
    const figure = makeBotMesh(scene);
    const bot = {
      index,
      team: 'torch',
      alive: true,
      health: HEALTH,
      body: makeBody(0, 0, HEIGHT_STAND),
      yaw: 0,
      eye: EYE_STAND,
      height: HEIGHT_STAND,
      isCrouching: false,
      gun: GUNS.smg,
      routeName: ['mid', 'left', 'right'][index],
      routeStep: 0,
      mode: 'route', // route | hold
      holdTimer: 0,
      reactTimer: 0,
      fireTimer: 0,
      reloadTimer: 0,
      plantTimer: 0,
      magazine: GUNS.smg.mag,
      burst: 0,
      target: null,
      role: index === 0 ? 'carrier' : (index === 1 ? 'support' : 'cover'),
      figure,
    };
    bot.position = bot.body.position;
    bots.push(bot);
  }

  function spawnAll() {
    const yaws = [0.4, 0, -0.4];
    for (let index = 0; index < bots.length; index += 1) {
      const bot = bots[index];
      bot.alive = true;
      bot.health = HEALTH;
      bot.body.position.x = ATTACKER_SPAWNS[index][0];
      bot.body.position.y = 0;
      bot.body.position.z = ATTACKER_SPAWNS[index][1];
      bot.body.velocity.x = 0;
      bot.body.velocity.y = 0;
      bot.body.velocity.z = 0;
      bot.body.height = HEIGHT_STAND;
      bot.yaw = yaws[index];
      bot.eye = EYE_STAND;
      bot.height = HEIGHT_STAND;
      bot.isCrouching = false;
      bot.mode = 'route';
      bot.holdTimer = 0;
      bot.reactTimer = 0;
      bot.fireTimer = 0;
      bot.reloadTimer = 0;
      bot.plantTimer = 0;
      bot.magazine = bot.gun.mag;
      bot.burst = 0;
      bot.target = null;
      bot.routeStep = 0;
      bot.figure.group.visible = true;
    }
  }

  function eyeOf(bot, out) {
    out.set(bot.body.position.x, bot.body.position.y + bot.eye, bot.body.position.z);
    return out;
  }

  // Nearest enemy the bot can plausibly see: line of sight first, then a field-of-view
  // test that only forgives distant enemies (the fov widens while holding position).
  function seeEnemy(bot, enemies) {
    eyeOf(bot, eye);
    let best = null;
    let bestDistance = Infinity;
    for (let index = 0; index < enemies.length; index += 1) {
      const enemy = enemies[index];
      if (!enemy.alive || enemy.team === bot.team) continue;
      const p = enemy.position;
      scratchSeen.set(p.x, p.y + (enemy.isCrouching ? EYE_CROUCH : EYE_STAND) * 0.85, p.z);
      if (!hooks.canSee(eye, scratchSeen)) continue;
      const dx = p.x - bot.body.position.x;
      const dz = p.z - bot.body.position.z;
      const distance = Math.hypot(dx, dz);
      const facing = Math.atan2(-dx, -dz);
      let diff = Math.abs(facing - bot.yaw);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      const fov = bot.mode === 'hold' ? 1.4 : 1.0;
      if (diff > fov && distance > 6) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = enemy;
      }
    }
    return best;
  }

  // Burst discipline: two or three rounds, then a longer pause to re-aim. Jitter
  // grows with the bot's own movement, the range and the enemy's crouch.
  function launchBot(bot, enemy) {
    if (bot.magazine <= 0) {
      bot.reloadTimer = bot.gun.reloadTime;
      return;
    }
    if (bot.fireTimer > 0) return;
    bot.burst += 1;
    bot.fireTimer = (bot.burst % 3 === 0 ? FIRE_GAP_BOT * 2.6 : FIRE_GAP_BOT) + random() * 0.14;
    bot.magazine -= 1;
    eyeOf(bot, eye);
    scratchSeen.set(
      enemy.position.x,
      enemy.position.y + (enemy.isCrouching ? EYE_CROUCH : EYE_STAND) * 0.7,
      enemy.position.z,
    );
    combat.direction.subVectors(scratchSeen, eye).normalize();
    const range = Math.hypot(
      enemy.position.x - bot.body.position.x,
      enemy.position.z - bot.body.position.z,
    );
    const enemyCrouch = enemy.isCrouching ? 1.5 : 0;
    const jitter = ACCURACY * (0.4 + footSpeed(bot.body) / WALK_SPEED + range / 40 + enemyCrouch);
    combat.direction.x += (random() * 2 - 1) * jitter;
    combat.direction.y += (random() * 2 - 1) * jitter;
    combat.direction.z += (random() * 2 - 1) * jitter;
    combat.origin.copy(eye);
    hooks.fire(bot, combat.origin, combat.direction, bot.gun);
  }

  function routePoint(bot) {
    const route = PATHS[bot.routeName];
    return route[bot.routeStep % route.length];
  }

  // On each waypoint reached there is a chance the bot stops and holds the spot.
  function stepLane(bot) {
    bot.routeStep += 1;
    if (random() < 0.3) {
      bot.mode = 'hold';
      bot.holdTimer = HOLD_TIME;
    }
  }

  // Unit step toward a point, or null when already on it.
  function walkToward(bot, x, z) {
    const dx = x - bot.body.position.x;
    const dz = z - bot.body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.01) return null;
    return [dx / distance, dz / distance, distance];
  }

  function step(bot, dt, enemies, roundState) {
    if (!bot.alive) {
      bot.figure.group.visible = false;
      return;
    }
    bot.fireTimer = Math.max(0, bot.fireTimer - dt);
    if (bot.reloadTimer > 0) {
      bot.reloadTimer -= dt;
      if (bot.reloadTimer <= 0) bot.magazine = bot.gun.mag;
    }
    if (bot.reactTimer > 0) bot.reactTimer -= dt;
    // Eye height glides between stand and crouch rather than snapping.
    const eyeTarget = bot.isCrouching ? EYE_CROUCH : EYE_STAND;
    bot.eye += (eyeTarget - bot.eye) * Math.min(1, dt * 10);

    // Target acquisition: a new sighting costs a reaction delay scaled by range;
    // a lost or dead target clears after a moment.
    const seen = spotEnemy(bot, enemies);
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reactTimer = REACTION_TIME * (0.6 + random() * 0.8 + Math.min(1.2, Math.hypot(
          seen.position.x - bot.body.position.x,
          seen.position.z - bot.body.position.z,
        ) / 30));
      }
    } else if (bot.target && (!bot.target.alive || random() < dt * 2)) {
      bot.target = null;
    }

    let moveVec = 0;
    let wishStrafe = 0;

    // Combat: face the enemy, crouch at long range, fire, and strafe occasionally.
    if (bot.target && bot.reactTimer <= 0) {
      const enemy = bot.target;
      bot.yaw = Math.atan2(
        -(enemy.position.x - bot.body.position.x),
        -(enemy.position.z - bot.body.position.z),
      );
      const distance = Math.hypot(
        enemy.position.x - bot.body.position.x,
        enemy.position.z - bot.body.position.z,
      );
      bot.isCrouching = distance > 14;
      launchBot(bot, enemy);
      if (random() < dt * 1.2) {
        moveVec = Math.cos(bot.yaw) * (random() < 0.5 ? 1 : -1);
        wishStrafe = -Math.sin(bot.yaw) * (random() < 0.5 ? 1 : -1);
      }
      moveBody(bot.body, colliders, dt, moveVec, wishStrafe, WALK_SPEED, 20, false);
      syncFigure(bot);
      return;
    }

    bot.isCrouching = false;

    if (roundState.phase === 'live') {
      // The carrier walks to the site and plants; everyone else walks there to
      // guard once the device is down.
      if (bot.role === 'carrier' && !roundState.devicePlanted) {
        const site = walkToward(bot, BOMB_SPOT[0], BOMB_SPOT[1]);
        if (site && site[2] < 1.6) {
          bot.plantTimer += dt;
          bot.mode = 'hold';
          bot.holdTimer = HOLD_TIME;
          if (bot.plantTimer >= hooks.plantTime()) {
            bot.plantTimer = 0;
            hooks.plant(bot);
          }
        } else if (site) {
          moveVec = site[0];
          wishStrafe = site[1];
        }
      } else if (roundState.devicePlanted) {
        const guard = walkToward(bot, BOMB_SPOT[0], BOMB_SPOT[1]);
        if (guard && guard[2] > 4.5) {
          moveVec = guard[0];
          wishStrafe = guard[1];
        } else if (bot.mode !== 'hold') {
          bot.mode = 'hold';
          bot.holdTimer = HOLD_TIME;
        }
      }
    }

    // No objective pull: hold the current spot or walk the lane's waypoints.
    if (moveVec === 0 && wishStrafe === 0) {
      if (bot.mode === 'hold') {
        bot.holdTimer -= dt;
        if (bot.holdTimer <= 0) bot.mode = 'route';
      } else {
        const point = routePoint(bot);
        const move = walkToward(bot, point[0], point[1]);
        if (move) {
          if (move[2] < 1.0) stepLane(bot);
          else {
            moveVec = move[0];
            wishStrafe = move[1];
          }
        } else {
          stepLane(bot);
        }
      }
    }

    if (moveVec !== 0 || wishStrafe !== 0) bot.yaw = Math.atan2(-moveVec, -wishStrafe);
    moveBody(bot.body, colliders, dt, moveVec, wishStrafe, WALK_SPEED, 20, false);
    syncFigure(bot);
  }

  // Mesh follows the physics body; the torso bobs faintly while the sim runs.
  function syncFigure(bot) {
    const p = bot.body.position;
    bot.figure.group.position.set(p.x, p.y, p.z);
    bot.figure.group.rotation.y = bot.yaw;
    bot.figure.torso.rotation.x = Math.sin(performance.now() * 0.008 + bot.index) * 0.05;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    hooks.onBotHurt(bot);
    if (bot.health <= 0) {
      bot.alive = false;
      bot.figure.group.visible = false;
      return true;
    }
    return false;
  }

  // Linear splash: full damage at the centre, zero at the blast radius.
  function grenadeBlast(point) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const dx = bot.body.position.x - point.x;
      const dy = (bot.body.position.y + 0.9) - point.y;
      const dz = bot.body.position.z - point.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < GRENADE_RADIUS) {
        damage(bot, GRENADE_DAMAGE * (1 - distance / GRENADE_RADIUS), 'torso');
      }
    }
  }

  return {
    bots,
    step,
    spawnAll,
    damage,
    grenadeBlast,
    eyeOf,
    aliveCount() {
      let count = 0;
      for (const bot of bots) if (bot.alive) count += 1;
      return count;
    },
  };
}
