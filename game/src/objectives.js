// The mid capture point: a second objective on the rail platform that pays the
// defender for holding the centre of the map. Capture takes six uncontested
// seconds; once Coal owns it, every fifteen seconds of ownership pays $500 into
// the round purse. A Torch bot inside the radius freezes progress (contested),
// and an enemy standing alone in the point for two seconds flips it back to
// neutral. The state here is plain numbers so the minimap and HUD read it direct.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const CAPTURE_SPOT = [0, -4.0];   // centre of the raised rail platform
const CAPTURE_RADIUS = 4.4;              // covers the platform deck between its rails
const CAPTURE_TIME = 6.0;                // seconds of uncontested standing to own it
const PAYOUT_INTERVAL = 15.0;            // seconds of ownership between payouts
const PAYOUT_AMOUNT = 500;               // per payout, deliberately under a kill bounty
const FLIP_TIME = 2.0;                   // enemy alone in the point this long neutralises it

export function createObjectives(scene, hooks) {
  const state = {
    progress: 0,        // 0..1 toward Coal ownership
    owner: 'neutral',   // neutral | coal
    contested: false,
    enemyHold: 0,       // enemy-alone timer toward the flip
    holdTime: 0,        // seconds owned this round
    payoutTimer: 0,
  };

  // A flat ring on the deck marks the point; a thin post shows the capture fill.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CAPTURE_RADIUS - 0.18, CAPTURE_RADIUS, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(CAPTURE_SPOT[0], 0.58, CAPTURE_SPOT[1]);
  scene.add(ring);

  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 2.4, 0.22),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.7 }),
  );
  post.position.set(CAPTURE_SPOT[0] + CAPTURE_RADIUS - 0.6, 1.78, CAPTURE_SPOT[1]);
  scene.add(post);

  function reset() {
    state.progress = 0;
    state.owner = 'neutral';
    state.contested = false;
    state.enemyHold = 0;
    state.holdTime = 0;
    state.payoutTimer = 0;
  }

  function inside(x, z) {
    const dx = x - CAPTURE_SPOT[0];
    const dz = z - CAPTURE_SPOT[1];
    return dx * dx + dz * dz <= CAPTURE_RADIUS * CAPTURE_RADIUS;
  }

  function step(dt, playerBody, bots, roundState) {
    if (roundState.phase !== 'live') {
      ring.material.color.set(PALETTE.muted);
      return;
    }
    const playerIn = playerBody.alive && inside(playerBody.position.x, playerBody.position.z);
    let enemiesIn = 0;
    for (const bot of bots) {
      if (bot.alive && inside(bot.body.position.x, bot.body.position.z)) enemiesIn += 1;
    }
    state.contested = playerIn && enemiesIn > 0;

    if (state.owner === 'neutral') {
      if (playerIn && enemiesIn === 0) {
        state.progress = Math.min(1, state.progress + dt / CAPTURE_TIME);
        if (state.progress >= 1) {
          state.owner = 'coal';
          state.payoutTimer = 0;
          hooks.onCaptured();
        }
      } else if (enemiesIn > 0) {
        // An enemy standing the point alone works it back to neutral; with the
        // player also inside it is simply frozen, never reversed under fire.
        state.enemyHold += dt;
        if (state.enemyHold >= FLIP_TIME) state.progress = Math.max(0, state.progress - dt / CAPTURE_TIME * 2);
      } else {
        state.enemyHold = 0;
      }
    } else {
      state.holdTime += dt;
      state.payoutTimer += dt;
      if (state.payoutTimer >= PAYOUT_INTERVAL) {
        state.payoutTimer -= PAYOUT_INTERVAL;
        hooks.onPayout(PAYOUT_AMOUNT);
      }
      if (enemiesIn > 0 && !playerIn) {
        state.enemyHold += dt;
        if (state.enemyHold >= FLIP_TIME) {
          state.owner = 'neutral';
          state.progress = 0.4; // partly worked over, not from scratch
          state.enemyHold = 0;
          hooks.onLost();
        }
      } else if (!state.contested) {
        state.enemyHold = 0;
      }
    }

    // Colour tells the story at a glance: grey neutral, ink owned, accent contested.
    const colour = state.contested ? PALETTE.accent : (state.owner === 'coal' ? PALETTE.ink : PALETTE.muted);
    ring.material.color.set(colour);
    post.scale.y = state.owner === 'coal' ? 1 : 0.4 + state.progress * 0.6;
    post.position.y = 0.58 + 1.2 * post.scale.y;
  }

  return { state, step, reset, inside, constants: { CAPTURE_SPOT, CAPTURE_RADIUS, PAYOUT_AMOUNT } };
}
