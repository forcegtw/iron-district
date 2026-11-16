// Spotting: hold Q and enemies inside the view cone with clean line of sight get
// marked for five seconds — a floating ring over the head plus a red dot on the
// minimap. At most two marks live at once and each mark costs a 1.2 s cooldown,
// so spotting is a decision, not a wall hack. Marks also nudge bot behaviour:
// a spotted bot holds its angle a beat longer, as if it suspects it is seen.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

const SPOT_DURATION = 5.0;
const MAX_MARKS = 2;
const COOLDOWN = 1.2;
const SCAN_INTERVAL = 0.35;   // how often a held Q attempts a new mark
const VIEW_CONE = 0.8;        // radians off the look direction a mark is allowed
const RANGE = 42;

export function createSpotting(scene) {
  const marks = new Map(); // bot -> seconds remaining
  let cooldown = 0;
  let scanTimer = 0;

  const ringGeometry = new THREE.RingGeometry(0.26, 0.34, 20);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false,
  });

  function ringFor(bot) {
    if (!bot.spotRing) {
      bot.spotRing = new THREE.Mesh(ringGeometry, ringMaterial);
      bot.spotRing.rotation.x = Math.PI / 2;
      bot.spotRing.visible = false;
      bot.spotRing.renderOrder = 5;
      bot.mesh.group.add(bot.spotRing);
      bot.spotRing.position.y = 2.05;
    }
    return bot.spotRing;
  }

  function tryMark(bot, playerBody, canSee) {
    const dx = bot.body.position.x - playerBody.position.x;
    const dz = bot.body.position.z - playerBody.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > RANGE) return false;
    // The bot must sit inside the player's view cone: spotting what you face.
    const facing = Math.atan2(-dx, -dz);
    let diff = Math.abs(facing - playerBody.yaw);
    while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
    if (diff > VIEW_CONE) return false;
    const eye = { x: playerBody.position.x, y: playerBody.position.y + playerBody.eye, z: playerBody.position.z };
    const chest = { x: bot.body.position.x, y: bot.body.position.y + 1.1, z: bot.body.position.z };
    if (!canSee(eye, chest)) return false;
    marks.set(bot, SPOT_DURATION);
    ringFor(bot).visible = true;
    return true;
  }

  function step(dt, playerBody, bots, canSee, keys, roundState) {
    cooldown = Math.max(0, cooldown - dt);
    for (const [bot, timeLeft] of marks) {
      const remaining = timeLeft - dt;
      if (remaining <= 0 || !bot.alive) {
        marks.delete(bot);
        if (bot.spotRing) bot.spotRing.visible = false;
      } else {
        marks.set(bot, remaining);
      }
    }
    if (roundState.phase !== 'live' || !playerBody.alive || !keys.has('KeyQ')) return;
    scanTimer -= dt;
    if (scanTimer > 0 || cooldown > 0 || marks.size >= MAX_MARKS) return;
    scanTimer = SCAN_INTERVAL;
    // Nearest unmarked visible enemy first: the threat closest to you is the one
    // worth putting on the map.
    let best = null;
    let bestDistance = Infinity;
    for (const bot of bots) {
      if (!bot.alive || marks.has(bot)) continue;
      const distance = Math.hypot(
        bot.body.position.x - playerBody.position.x,
        bot.body.position.z - playerBody.position.z,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bot;
      }
    }
    if (best && tryMark(best, playerBody, canSee)) cooldown = COOLDOWN;
  }

  function isSpotted(bot) {
    return marks.has(bot);
  }

  function reset() {
    for (const bot of marks.keys()) {
      if (bot.spotRing) bot.spotRing.visible = false;
    }
    marks.clear();
    cooldown = 0;
    scanTimer = 0;
  }

  return { step, isSpotted, reset, count: () => marks.size };
}
