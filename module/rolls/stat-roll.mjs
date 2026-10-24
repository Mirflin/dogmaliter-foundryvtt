/**
 * The stat check lives in a Macro the GM can edit in Foundry: "Бросок
 * характеристики", a script macro of this world, marked with the flag
 * `dogmaliter.statRoll`. Its starting text is `macros/stat-roll.js` of the
 * system - all of the roll: dialog, dice, crit, chat card, sound triggers.
 *
 * The active GM creates the macro at `ready` if the world has none. Players
 * may run it (Limited permission) but not change it. The GM panel opens it
 * and puts the starting text back. A later version of the system does not
 * overwrite the world's macro: the GM's changes stay.
 *
 * `game.dogmaliter.rollStat({actor, token})` - and the sheet's "Roll" button
 * - run the world's macro; with none (deleted, say) the starting text runs
 * as it is.
 */

const SOURCE = 'systems/dogmaliter/macros/stat-roll.js';
const FLAG = 'statRoll';

/** The starting text, fetched once. */
let source = null;

/**
 * @param {boolean} [refresh]   fetch the file again
 * @returns {Promise<string>}
 */
async function defaultSource(refresh = false) {
  if (!source || refresh) source = await (await fetch(`${SOURCE}?v=${Date.now()}`)).text();
  return source;
}

/** The world's stat check macro, or null. */
export function statRollMacro() {
  return game.macros.find((macro) => macro.getFlag('dogmaliter', FLAG)) ?? null;
}

/**
 * The world's stat check macro, created from the starting text if there is
 * none yet (GM only).
 * @returns {Promise<Macro|null>}
 */
export async function ensureStatRollMacro() {
  const existing = statRollMacro();
  if (existing || !game.user.isGM) return existing;
  return getDocumentClass('Macro').create({
    name: 'Бросок характеристики',
    type: 'script',
    img: 'icons/dice/d20black.svg',
    command: await defaultSource(),
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    flags: { dogmaliter: { [FLAG]: true } },
  });
}

/** Put the starting text back into the world's macro. */
export async function resetStatRollMacro() {
  const macro = await ensureStatRollMacro();
  await macro?.update({ command: await defaultSource(true) });
  return macro;
}

/**
 * Run the stat check.
 * @param {object} [options]
 * @param {Actor} [options.actor]   default: the selected token's actor, or the user's character
 * @param {Token} [options.token]   the token that speaks; default: the actor's token on the scene
 * @returns {Promise<object|null>}  what was rolled (the macro's return value), or null
 */
export async function rollStat({ actor = null, token = null } = {}) {
  const scope = {};
  if (actor) {
    scope.actor = actor;
    scope.token = token ?? actor.getActiveTokens?.()[0] ?? null;
  } else if (token) {
    scope.token = token;
  }
  const macro = statRollMacro();
  if (macro?.canExecute) return macro.execute(scope);
  // No macro in the world: the starting text, as a macro of this user's.
  const temporary = new (getDocumentClass('Macro'))({
    name: 'Бросок характеристики',
    type: 'script',
    command: await defaultSource(),
    author: game.user.id,
  });
  return temporary.execute(scope);
}
