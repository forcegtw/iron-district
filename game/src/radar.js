// The radar: a rotating sweep overlay rendered on its own canvas, larger than the
// corner minimap and styled like a sonar dish. Unlike the minimap — which is a static
// map aid — the radar is a tactical instrument: it draws every enemy that is alive,
// a view cone for where the player is looking, and a bearing marker for the current
// objective. It reads simulation state through the init() API and draws it; like the
// minimap it never drives anything. The canvas is a 220 px circle, radar-up rather
// than map-up: north is whatever direction the player faces, so the blips spin as
// the player turns and the sweep line makes the rotation legible.
import { DEVICE_SPOT } from './world.js';
import { CAPTURE_SPOT } from './objectives.js';

const SIZE = 220;              // canvas is square, the dish is the inscribed circle
const RANGE = 22;              // metres from the player drawn edge to edge
const C = SIZE / 2;            // centre of the dish, where the player always sits
const PX = (C - 6) / RANGE;    // pixels per metre, leaving a rim margin
const RIM_COLOUR = '#3f4c55';
const SWEEP_COLOUR = 'rgba(130, 200, 150, 0.5)';
const GRID_COLOUR = 'rgba(80, 100, 110, 0.28)';
const SELF_COLOUR = '#e2e7e4';
const ENEMY_COLOUR = '#e07a2e';
const OBJECTIVE_COLOUR = '#7aa2c4';
const CONE_COLOUR = 'rgba(226, 231, 228, 0.10)';
const BACKGROUND = 'rgba(10, 13, 15, 0.86)';
const CONE_HALF_ANGLE = Math.PI / 5;   // ~72 degrees total, matches the FOV feel
const RING_STEPS = [0.25, 0.5, 0.75, 1];

let canvas = null;
let ctx = null;
let cameraRef = null;
let enemyList = [];
let sweepPhase = 0;
let lastTime = 0;
let visible = true;
let frameHandle = 0;

// A cheap forward vector from the camera's world matrix — avoids pulling in THREE
// just to read a heading, keeps the module free of vendor imports.
function forwardOf(camera) {
  const e = camera.matrixWorld.elements;
  return { x: -e[8], z: -e[10] };
}

// World metres -> dish pixels, relative to the player's position and rotated so
// the player's heading always points "up" the dish.
function toDish(px, pz, yaw, wx, wz) {
  const dx = wx - px;
  const dz = wz - pz;
  // Rotate world delta by -yaw so forward maps to screen-up (negative canvas y).
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  return { x: C + rx * PX, y: C + rz * PX };
}

function insideDish(x, y, pad = 0) {
  const dx = x - C;
  const dy = y - C;
  return dx * dx + dy * dy <= (C - pad) * (C - pad);
}

function clear() {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = BACKGROUND;
  ctx.beginPath();
  ctx.arc(C, C, C - 1, 0, Math.PI * 2);
  ctx.fill();
}

function rim() {
  ctx.strokeStyle = RIM_COLOUR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(C, C, C - 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
}

// Range rings and the crosshair axes: the static grid that makes the dish read
// as an instrument instead of a dark circle.
function grid() {
  ctx.strokeStyle = GRID_COLOUR;
  for (const step of RING_STEPS) {
    ctx.beginPath();
    ctx.arc(C, C, (C - 4) * step, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(C, 4);
  ctx.lineTo(C, SIZE - 4);
  ctx.moveTo(4, C);
  ctx.lineTo(SIZE - 4, C);
  ctx.stroke();
}

// The rotating sweep wedge that trails behind the scan line.
function sweep(dt) {
  sweepPhase = (sweepPhase + dt * 1.6) % (Math.PI * 2);
  const tail = 1.1; // radians of trail behind the leading edge
  const gradient = ctx.createRadialGradient(C, C, 4, C, C, C - 4);
  gradient.addColorStop(0, SWEEP_COLOUR);
  gradient.addColorStop(1, 'rgba(130, 200, 150, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(C, C);
  ctx.arc(C, C, C - 4, sweepPhase - tail, sweepPhase);
  ctx.closePath();
  ctx.fill();
  // Leading edge of the sweep.
  ctx.strokeStyle = SWEEP_COLOUR;
  ctx.beginPath();
  ctx.moveTo(C, C);
  ctx.lineTo(C + Math.cos(sweepPhase) * (C - 4), C + Math.sin(sweepPhase) * (C - 4));
  ctx.stroke();
}

// Player at centre: a filled dot plus a short nose showing heading.
function selfMark() {
  ctx.fillStyle = SELF_COLOUR;
  ctx.beginPath();
  ctx.arc(C, C, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(C, C - 9);
  ctx.lineTo(C - 4, C - 2);
  ctx.lineTo(C + 4, C - 2);
  ctx.closePath();
  ctx.fill();
}

// Field-of-view cone drawn from the centre: shows where the player can see, so
// off-cone blips are understood as behind or beside rather than missing. The dish
// is rotated radar-up, so the cone always points to screen-up.
function viewCone() {
  const r = C - 4;
  ctx.fillStyle = CONE_COLOUR;
  ctx.beginPath();
  ctx.moveTo(C, C);
  ctx.arc(C, C, r, -Math.PI / 2 - CONE_HALF_ANGLE, -Math.PI / 2 + CONE_HALF_ANGLE);
  ctx.closePath();
  ctx.fill();
}

// Enemies as blips; faded when the sweep has passed recently, bright otherwise,
// and clamped to the rim so out-of-range enemies still show a bearing cue.
function enemyBlips(px, pz, yaw) {
  for (const enemy of enemyList) {
    if (!enemy || !enemy.alive) continue;
    const ep = enemy.position;
    const raw = toDish(px, pz, yaw, ep.x, ep.z);
    const dx = raw.x - C;
    const dy = raw.y - C;
    const dist = Math.hypot(dx, dy);
    const maxR = C - 8;
    const clamped = dist > maxR;
    const scale = clamped ? maxR / dist : 1;
    const x = C + dx * scale;
    const y = C + dy * scale;
    if (!insideDish(x, y, 3)) continue;
    const fade = clamped ? 0.45 : 0.95;
    ctx.fillStyle = ENEMY_COLOUR;
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.arc(x, y, clamped ? 2.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// Objective bearing: the capture point as a diamond, the device spot as a square,
// both clamped to the rim like enemy blips so they act as compass cues.
function objectiveMarks(px, pz, yaw) {
  const marks = [
    { spot: CAPTURE_SPOT, colour: OBJECTIVE_COLOUR, kind: 'diamond' },
    { spot: DEVICE_SPOT, colour: OBJECTIVE_COLOUR, kind: 'square' },
  ];
  for (const mark of marks) {
    if (!mark.spot) continue;
    const raw = toDish(px, pz, yaw, mark.spot[0], mark.spot[1]);
    const dx = raw.x - C;
    const dy = raw.y - C;
    const dist = Math.hypot(dx, dy);
    const maxR = C - 8;
    const scale = dist > maxR ? maxR / dist : 1;
    const x = C + dx * scale;
    const y = C + dy * scale;
    ctx.strokeStyle = mark.colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (mark.kind === 'diamond') {
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
    } else {
      ctx.rect(x - 4, y - 4, 8, 8);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function drawFrame(now) {
  frameHandle = requestAnimationFrame(drawFrame);
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0.016;
  lastTime = now;
  if (!visible || !cameraRef) return;
  const cam = cameraRef;
  const pos = cam.position;
  const fwd = forwardOf(cam);
  // Heading angle: 0 when facing -Z, negative when facing -X, etc. The dish
  // rotation below maps the forward direction to screen-up for any heading.
  const yaw = Math.atan2(fwd.x, -fwd.z);
  clear();
  rim();
  grid();
  viewCone();
  sweep(dt);
  objectiveMarks(pos.x, pos.z, yaw);
  enemyBlips(pos.x, pos.z, yaw);
  selfMark();
}

// Public API: hand the radar the live scene's camera and enemy array, create the
// canvas inside the given slot element, and start the draw loop. Safe to call once.
export function init(slot, scene, camera, enemies) {
  if (canvas) return { toggle, canvas };
  if (!slot) return null;
  canvas = document.createElement('canvas');
  canvas.id = 'radar';
  canvas.width = SIZE;
  canvas.height = SIZE;
  slot.appendChild(canvas);
  ctx = canvas.getContext('2d');
  cameraRef = camera;
  enemyList = enemies || [];
  // `scene` is accepted for API symmetry and future scene-space queries; the radar
  // currently reads only camera and enemy state, both plain and cheap.
  void scene;
  frameHandle = requestAnimationFrame(drawFrame);
  return { toggle, canvas };
}

// 'R' toggles the overlay; the draw loop keeps running but skips painting while
// hidden, so re-showing costs nothing and the sweep phase stays continuous.
function toggle() {
  visible = !visible;
  if (canvas) canvas.style.display = visible ? '' : 'none';
  return visible;
}

export function dispose() {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = 0;
  if (canvas && canvas.parentElement) canvas.parentElement.removeChild(canvas);
  canvas = null;
  ctx = null;
  cameraRef = null;
  enemyList = [];
}
