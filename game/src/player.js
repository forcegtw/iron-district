// Player movement and first-person state: acceleration, friction, crouch, jump and
// the shared capsule-vs-box resolution from physics.js. Health and the body that
// bullets hit live here; the gun and its ammunition live in weapon.js.
import * as THREE from 'three';
import { makeBody, moveBody, horizontalSpeed, overlaps } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GRAVITY = 20;
const MAX_HEALTH = 100;

export function createPlayer(colliders) {
  const player = {
    position: { x: 0, y: 0, z: 13.0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: MAX_HEALTH,
    alive: true,
    team: 'coal',
    isCrouching: false,
  };
  const body = makeBody(0, 0, STAND_HEIGHT);
  // The player's body IS the shared body; the two views stay one object.
  player.position = body.position;
  player.velocity = body.velocity;
  player.onGround = body.onGround;

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!player.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
      player.isCrouching = true;
    } else if (!crouching && player.crouching && !overlaps(colliders, player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
      player.crouching = false;
      player.height = STAND_HEIGHT;
      player.isCrouching = false;
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      const length = Math.hypot(forward, strafe);
      wishX = (-sin * forward + cos * strafe) / length;
      wishZ = (-cos * forward - sin * strafe) / length;
    }
    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    moveBody(body, colliders, dt, wishX, wishZ, speed, GRAVITY, keys.has('Space'));
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return horizontalSpeed(body);
    },
    respawn(x, z) {
      body.position.x = x;
      body.position.y = 0;
      body.position.z = z;
      body.velocity.x = 0;
      body.velocity.y = 0;
      body.velocity.z = 0;
      body.height = STAND_HEIGHT;
      player.crouching = false;
      player.isCrouching = false;
      player.health = MAX_HEALTH;
      player.alive = true;
      player.eye = STAND_EYE;
    },
  };
}
