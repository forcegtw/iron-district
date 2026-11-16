// The minimap: a 2D canvas pinned to the HUD's corner that draws the map's walls,
// the player as a heading triangle, spotted enemies as red dots, the plant site and
// the capture point as circles. It reads simulation state and draws it; it never
// drives anything. The canvas is 176 px square covering the world's 34 x 30 m foot
// print, so one pixel is about a body and a half — right for reading lanes at a glance.
import { DEVICE_SPOT, ROUTES } from './world.js';
import { CAPTURE_SPOT, CAPTURE_RADIUS } from './objectives.js';

const SIZE = 176;
const WORLD = 36;          // metres of world mapped across the canvas
const PLAYER_COLOUR = '#e2e7e4';
const ENEMY_COLOUR = '#e07a2e';
const WALL_COLOUR = '#2b353c';
const SITE_COLOUR = '#82909a';

function toPixel(value) {
  return (value + WORLD / 2) * (SIZE / WORLD);
}

export function createMinimap(parent, hooks) {
  const canvas = document.createElement('canvas');
  canvas.id = 'minimap';
  canvas.width = SIZE;
  canvas.height = SIZE;
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  function clear() {
    ctx.fillStyle = 'rgba(16, 19, 21, 0.82)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = WALL_COLOUR;
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  }

  // The boundary walls and the mid platform, drawn once per frame from the same
  // constants the 3D world builds from: the map and its map stay one truth.
  function walls() {
    ctx.fillStyle = WALL_COLOUR;
    // Mid rail platform deck.
    ctx.fillRect(toPixel(-3.5), toPixel(-11), 7 * SIZE / WORLD, 14 * SIZE / WORLD);
    // Warehouse walls framing the lanes.
    ctx.fillRect(toPixel(-10), toPixel(-9.3), 5 * SIZE / WORLD, 0.6 * SIZE / WORLD);
    ctx.fillRect(toPixel(7.5), toPixel(-9.3), 5 * SIZE / WORLD, 0.6 * SIZE / WORLD);
    ctx.fillRect(toPixel(-10.5), toPixel(-9.2), 0.6 * SIZE / WORLD, 6 * SIZE / WORLD);
    ctx.fillRect(toPixel(9.9), toPixel(-9.2), 0.6 * SIZE / WORLD, 6 * SIZE / WORLD);
  }

  function circle(x, z, radiusPx, colour, fill) {
    ctx.beginPath();
    ctx.arc(toPixel(x), toPixel(z), radiusPx, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = colour;
      ctx.fill();
    } else {
      ctx.strokeStyle = colour;
      ctx.stroke();
    }
  }

  function player(x, z, yaw) {
    const px = toPixel(x);
    const pz = toPixel(z);
    // A triangle pointing the way the player faces; yaw's sign matches the world's
    // -sin / -cos convention, so north on the map is north in the scene.
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.2, 5);
    ctx.lineTo(-4.2, 5);
    ctx.closePath();
    ctx.fillStyle = PLAYER_COLOUR;
    ctx.fill();
    ctx.restore();
  }

  function dot(x, z, colour) {
    circle(x, z, 3, colour, true);
  }

  // One frame of the map. Everything the panel shows is passed in; nothing here
  // reaches into the simulation's live objects.
  function draw(frame) {
    clear();
    walls();
    // Capture point: a ring, filled when Coal owns it, dashed when contested.
    const captured = frame.captureOwner === 'coal';
    ctx.setLineDash(frame.captureContested ? [3, 3] : []);
    circle(CAPTURE_SPOT[0], CAPTURE_SPOT[1], CAPTURE_RADIUS * SIZE / WORLD,
      captured ? PLAYER_COLOUR : SITE_COLOUR, false);
    ctx.setLineDash([]);
    // Plant site: a small square outline where the device goes.
    ctx.strokeStyle = SITE_COLOUR;
    ctx.strokeRect(toPixel(DEVICE_SPOT[0]) - 6, toPixel(DEVICE_SPOT[1]) - 6, 12, 12);
    if (frame.devicePlanted) dot(DEVICE_SPOT[0], DEVICE_SPOT[1], ENEMY_COLOUR);
    // Spotted enemies only: the minimap is a memory aid, not a wall hack.
    for (const bot of frame.spottedBots) dot(bot.body.position.x, bot.body.position.z, ENEMY_COLOUR);
    player(frame.playerX, frame.playerZ, frame.playerYaw);
  }

  return { draw, canvas, constants: { SIZE, WORLD } };
}

// Exported for the HUD test path and the shot mode: the route points drawn dimly so
// the map shows which lane is which without giving away live bot positions.
export function lanePoints() {
  const points = [];
  for (const name of Object.keys(ROUTES)) {
    for (const [x, z] of ROUTES[name]) points.push([name, x, z]);
  }
  return points;
}
