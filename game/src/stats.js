// Per-session stat ledger. The game calls one record function per sim event and the
// HUD asks for a DOM render at round end, so nothing here runs inside the frame loop.
// The scatter gun's pellets each count as a shot, keeping accuracy per projectile.

function freshLedger() {
  return {
    shotsFired: 0,       // projectiles launched, pellets counted one by one
    shotsHit: 0,
    headshots: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    killsByGun: {},      // weapon kind -> kill tally
    streak: 0,           // consecutive kills without dying
    bestStreak: 0,
    roundsPlayed: 0,
    roundsWon: 0,
    capturePayouts: 0,   // how often the mid point paid out
  };
}

export function createStats() {
  const ledger = freshLedger();
  const state = ledger;

  const recordShot = (gunKind) => { state.shotsFired += 1; };

  const recordHit = (gunKind, part, damage) => {
    state.shotsHit += 1;
    if (part === 'head') state.headshots += 1;
    state.damageDealt += damage;
  };

  const recordKill = (gunKind) => {
    state.kills += 1;
    state.killsByGun[gunKind] = (state.killsByGun[gunKind] ?? 0) + 1;
    state.streak += 1;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  };

  const recordDamageTaken = (amount) => { state.damageTaken += amount; };

  // Death ends a streak; the streak itself grants no bonus money anywhere.
  const recordDeath = () => { state.streak = 0; };

  const recordRound = (won) => {
    state.roundsPlayed += 1;
    if (won) state.roundsWon += 1;
  };

  function accuracy() {
    if (state.shotsFired === 0) return 0;
    return state.shotsHit / state.shotsFired;
  }

  function headshotShare() {
    if (state.shotsHit === 0) return 0;
    return state.headshots / state.shotsHit;
  }

  // One clear + rebuild of the ledger DOM. Runs once per round end, never per frame.
  function render(container) {
    container.innerHTML = '';
    const rows = [
      ['Accuracy', `${Math.round(accuracy() * 100)}%`],
      ['Headshot share', `${Math.round(headshotShare() * 100)}%`],
      ['Damage dealt', String(Math.round(state.damageDealt))],
      ['Damage taken', String(Math.round(state.damageTaken))],
      ['Kills', String(state.kills)],
      ['Best streak', String(state.bestStreak)],
      ['Rounds', `${state.roundsWon} won of ${state.roundsPlayed}`],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      const name = document.createElement('span');
      name.className = 'stat-label';
      name.textContent = label;
      const num = document.createElement('span');
      num.className = 'stat-value';
      num.textContent = value;
      row.append(name, num);
      container.appendChild(row);
    }
    // Weapon breakdown appears only once at least one kill has been filed.
    const kinds = Object.keys(state.killsByGun);
    if (kinds.length > 0) {
      const title = document.createElement('div');
      title.className = 'stat-title';
      title.textContent = 'Kills by weapon';
      container.appendChild(title);
      for (const kind of kinds) {
        const row = document.createElement('div');
        row.className = 'stat-row';
        const name = document.createElement('span');
        name.className = 'stat-label';
        name.textContent = kind;
        const num = document.createElement('span');
        num.className = 'stat-value';
        num.textContent = String(state.killsByGun[kind]);
        row.append(name, num);
        container.appendChild(row);
      }
    }
  }

  return {
    state,
    recordShot,
    recordHit,
    recordKill,
    recordDamageTaken,
    recordDeath,
    recordRound,
    recordCapturePayout() { state.capturePayouts += 1; },
    accuracy,
    headshotShare,
    render,
  };
}
