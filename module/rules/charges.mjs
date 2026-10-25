/**
 * Charges: Атака, Блок, Уворот (CONFIG.DOGMALITER.charges) - ordinary
 * attributes with a value and a max, that actions spend:
 *
 *   - an action spends one; with none left it is refused (the macros ask
 *     `canSpend` first);
 *   - once they run out (value 0) recovery starts: +1 at the start of each of
 *     the character's combat turns, until it has been +1 as many times as the
 *     max - charges spent meanwhile do not stop it. If it ends with none left,
 *     it starts over.
 *
 * An actor without the attribute, or with it but no max, has no limit.
 * Recovery state is in the actor's flags: `flags.dogmaliter.recovery.<key>`
 * = how many times it has been +1 so far; no key = not recovering.
 *
 * `game.dogmaliter.charges` - for macros:
 *
 *   charges.get(actor, 'attack')      // {name, value, max, limited, recovering, restored}
 *   charges.canSpend(actor, 'block')
 *   await charges.spend(actor, 'dodge', 'реакция: Уворот')   // the text goes to the action log
 *   await charges.recover(actor)      // one recovery step, every charge (the GM's "+1" button)
 */

const FLAG = 'recovery';

/** The configured charges, as [key, {name, icon, color}]. */
function configured() {
  return Object.entries(CONFIG.DOGMALITER.charges);
}

/**
 * One charge of an actor.
 * @param {Actor} actor
 * @param {string} key     a key of CONFIG.DOGMALITER.charges
 * @returns {{key, name, icon, color, id, exists, value, max, limited, recovering, restored}}
 */
export function get(actor, key) {
  const config = CONFIG.DOGMALITER.charges[key];
  const attribute = actor?.findAttribute?.(config?.name) ?? null;
  const value = Math.max(0, Number(attribute?.value) || 0);
  const max = Number(attribute?.max);
  const limited = !!attribute && attribute.max !== '' && Number.isFinite(max) && max > 0;
  const restored = actor?.getFlag?.('dogmaliter', FLAG)?.[key];
  return {
    key,
    ...config,
    id: attribute?.id ?? null,
    exists: !!attribute,
    value,
    max: limited ? max : 0,
    limited,
    recovering: limited && Number.isFinite(restored),
    restored: Number.isFinite(restored) ? restored : 0,
  };
}

/** Every configured charge the actor has with a max. */
export function list(actor) {
  return configured()
    .map(([key]) => get(actor, key))
    .filter((charge) => charge.limited);
}

/** May the actor spend one? (No limit without the attribute or its max.) */
export function canSpend(actor, key) {
  const charge = get(actor, key);
  return !charge.limited || charge.value > 0;
}

/**
 * Set a charge's value; reaching 0 starts recovery, if it is not running.
 * @param {Actor} actor
 * @param {string} key
 * @param {number} value
 * @param {string} [reason]   why, for the action log
 */
export async function setValue(actor, key, value, reason = game.i18n.localize('DOGMALITER.Log.ReasonManual')) {
  const charge = get(actor, key);
  if (!charge.limited) return;
  value = Math.clamp(Math.round(value), 0, charge.max);
  const update = { [`system.attributes.${charge.id}.value`]: String(value) };
  if (value === 0 && !charge.recovering) update[`flags.dogmaliter.${FLAG}.${key}`] = 0;
  await actor.update(update, { dogmaliterReason: reason });
}

/**
 * Spend one charge.
 * @param {Actor} actor
 * @param {string} key
 * @param {string} [reason]   why, for the action log
 * @returns {Promise<boolean>} false if there was none to spend
 */
export async function spend(actor, key, reason = game.i18n.localize('DOGMALITER.Log.ReasonSpend')) {
  const charge = get(actor, key);
  if (!charge.limited) return true;
  if (charge.value <= 0) return false;
  await setValue(actor, key, charge.value - 1, reason);
  return true;
}

/**
 * One recovery step: +1 to every charge (or just `key`) that is recovering.
 * @param {Actor} actor
 * @param {string} [key]
 * @param {string} [reason]   why, for the action log
 * @returns {Promise<string[]>} the names of the charges that got +1
 */
export async function recover(actor, key = null, reason = game.i18n.localize('DOGMALITER.Log.ReasonRecoverGm')) {
  const update = {};
  const recovered = [];
  for (const charge of key ? [get(actor, key)] : list(actor)) {
    if (!charge.recovering) continue;
    const value = Math.min(charge.max, charge.value + 1);
    const restored = charge.restored + 1;
    update[`system.attributes.${charge.id}.value`] = String(value);
    if (restored < charge.max) update[`flags.dogmaliter.${FLAG}.${charge.key}`] = restored;
    // Done: +1 as many times as the max. Still none left? Start over.
    else update[`flags.dogmaliter.${FLAG}.${charge.key}`] = value === 0 ? 0 : null;
    recovered.push(charge.name);
  }
  if (!recovered.length) return recovered;
  // A null flag value means "not recovering" - drop the key instead of keeping a null.
  for (const [path, value] of Object.entries(update)) {
    if (value === null) {
      delete update[path];
      Object.assign(update, actor.constructor.deletion(path));
    }
  }
  await actor.update(update, { dogmaliterReason: reason });
  return recovered;
}

/** Call at `ready`: the start of a character's turn recovers its charges (once, on the active GM's client). */
export function registerCharges() {
  Hooks.on('updateCombat', async (combat, changes, options) => {
    if (!game.users.activeGM?.isSelf || !combat.started) return;
    if (!('turn' in changes) && !('round' in changes)) return;
    if ((options?.direction ?? 1) < 0) return; // stepping back is not a new turn
    const actor = combat.combatant?.actor;
    if (!actor) return;
    const recovered = await recover(actor, null, game.i18n.localize('DOGMALITER.Log.ReasonRecoverTurn'));
    if (recovered.length) {
      ui.notifications.info(game.i18n.format('DOGMALITER.Charges.Recovered', { name: actor.name, list: recovered.join(', ') }));
    }
  });
}
