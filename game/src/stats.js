// Session statistics: every trigger pull, hit, headshot and point of damage flows
// through here, and the end-of-round panel renders the ledger. Accuracy counts
// pellets individually for the scatter gun, so the number stays honest per shot
// fired rather than per trigger squeeze. Streaks reset on death and award nothing
// by themselves: they are information the player reads, not a scoring rule.

export function createStats() {
  const state = {
    shotsFired: 0,      // one per projectile (a trigger pull with pellets counts 8)
    shotsHit: 0,
    headshots: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    killsByGun: {},     // gun kind -> count
    streak: 0,
    bestStreak: 0,
    roundsPlayed: 0,
    roundsWon: 0,
    capturePayouts: 0,  // times the mid point paid out
  };

  function recordShot(gunKind) {
    state.shotsFired += 1;
  }

  function recordHit(gunKind, part, damage) {
    state.shotsHit += 1;
    if (part === 'head') state.headshots += 1;
    state.damageDealt += damage;
  }

  function recordKill(gunKind) {
    state.kills += 1;
    state.killsByGun[gunKind] = (state.killsByGun[gunKind] ?? 0) + 1;
    state.streak += 1;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  }

  function recordDamageTaken(amount) {
    state.damageTaken += amount;
  }

  function recordDeath() {
    state.streak = 0;
  }

  function recordRound(won) {
    state.roundsPlayed += 1;
    if (won) state.roundsWon += 1;
  }

  function accuracy() {
    return state.shotsFired === 0 ? 0 : state.shotsHit / state.shotsFired;
  }

  function headshotShare() {
    return state.shotsHit === 0 ? 0 : state.headshots / state.shotsHit;
  }

  // Builds the panel DOM inside the given container. One clear + rebuild per round
  // end is fine: this runs once, never in the frame loop.
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
    recordCapturePayout() {
      state.capturePayouts += 1;
    },
    accuracy,
    headshotShare,
    render,
  };
}
