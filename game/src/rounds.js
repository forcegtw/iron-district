// The round state machine: buy phase, live play, a win or a loss, the payout and the
// next round. Two sides of three: the player's Coal and the bot Torch squad. A round
// ends on elimination, on the device detonating or being defused, or on time expiring
// while it is not planted. Money follows the tactical-shooter shape: a win bonus, a
// loss consolation and a bounty per kill, capped at a ceiling.
import { GUNS, GRENADE_PRICE } from './combat.js';

const ROUND_TIME = 100;
const BUY_TIME = 10;
const FUSE_TIME = 35;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 6.0;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1400;
const KILL_REWARD = 300;
const MAX_MONEY = 9000;

export function createRounds(hooks) {
  const state = {
    round: 1,
    phase: 'buy', // buy | live | over
    timer: BUY_TIME,
    scores: { coal: 0, torch: 0 },
    result: null, // 'coal' | 'torch'
    reason: '',
    devicePlanted: false,
    fuse: 0,
    plantProgress: 0,
    defuseProgress: 0,
    money: 800,
    killMoney: 0,
  };

  function beginRound(playerMoney) {
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.result = null;
    state.reason = '';
    state.devicePlanted = false;
    state.fuse = 0;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.killMoney = 0;
    if (typeof playerMoney === 'number') state.money = playerMoney;
    hooks.onRoundBegin(state);
  }

  function goLive() {
    state.phase = 'live';
    state.timer = ROUND_TIME;
    hooks.onLive();
  }

  function endRound(winner, reason) {
    if (state.phase === 'over') return;
    state.phase = 'over';
    state.result = winner;
    state.reason = reason;
    state.scores[winner] += 1;
    state.money = Math.min(
      MAX_MONEY,
      state.money + state.killMoney + (winner === 'coal' ? WIN_REWARD : LOSS_REWARD),
    );
    hooks.onRoundEnd(state);
  }

  function step(dt, alive) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) goLive();
      return;
    }
    if (state.phase === 'over') return;

    const coalAlive = (alive.player ? 1 : 0) + alive.coalTeammates;
    const torchAlive = alive.torch;

    if (state.devicePlanted) {
      state.fuse -= dt;
      if (state.defuseProgress >= DEFUSE_TIME) {
        endRound('coal', 'Device defused');
        return;
      }
      if (state.fuse <= 0) {
        endRound('torch', 'The device detonated');
        return;
      }
    }

    if (coalAlive === 0) {
      endRound('torch', 'Coal eliminated');
      return;
    }
    if (torchAlive === 0 && !state.devicePlanted) {
      endRound('coal', 'Torch eliminated');
      return;
    }

    state.timer -= dt;
    if (state.timer <= 0 && !state.devicePlanted) {
      endRound('coal', 'Time expired');
    }
  }

  return {
    state,
    beginRound,
    step,
    goLive,
    endRound,
    constants: { ROUND_TIME, BUY_TIME, FUSE_TIME, PLANT_TIME, DEFUSE_TIME, GRENADE_PRICE, KILL_REWARD },
    prices: GUNS,
  };
}
