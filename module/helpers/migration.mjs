/**
 * One-time changes to a world's data when the system changes shape. Run by
 * the active GM at `ready`; the `migrationVersion` setting remembers what has
 * been done.
 *
 *   1  `system.power` became `system.mana`: its numbers move over, and every
 *      token bar (prototype or placed) that showed `power` shows `mana`.
 *   2  Ловкость, Интеллект, Выносливость join the attributes new actors start
 *      with, if the world has its own list already.
 *   3  The charges Атака, Блок, Уворот (2 / 2): into that list, and onto every
 *      actor that has none of them by that name. Sound bindings stop running
 *      the system's own macros (a roll inside a roll).
 *   4  Рукопашный бой, a new attack type: into that list, and onto every actor
 *      that has none by that name.
 */

import { SYSTEM_ID } from './settings.mjs';

const CURRENT = 4;

export async function migrateWorld() {
  if (!game.users.activeGM?.isSelf) return;
  const version = game.settings.get(SYSTEM_ID, 'migrationVersion');
  if (version >= CURRENT) return;

  if (version < 1) await powerToMana();
  if (version < 2) await addStats(['Ловкость', 'Интеллект', 'Выносливость'], 'Сила');
  if (version < 3) await addCharges();
  if (version < 4) await addToEveryone([{ name: 'Рукопашный бой', value: '0', max: '' }], 'Меткость');
  await game.settings.set(SYSTEM_ID, 'migrationVersion', CURRENT);
}

/** Bar attribute changes for a token's data: `power` -> `mana`. */
function barChanges(token, prefix = '') {
  const changes = {};
  for (const bar of ['bar1', 'bar2']) {
    if (token[bar]?.attribute === 'power') changes[`${prefix}${bar}.attribute`] = 'mana';
  }
  return changes;
}

async function powerToMana() {
  // Tokens first: a bar still pointing at `power` once it is gone would
  // animate to nothing on the canvas.
  for (const scene of game.scenes) {
    const updates = scene.tokens
      .map((token) => ({ _id: token.id, ...barChanges(token._source) }))
      .filter((update) => Object.keys(update).length > 1);
    if (updates.length) await scene.updateEmbeddedDocuments('Token', updates);
  }
  for (const actor of game.actors) {
    const power = actor._source.system?.power;
    const changes = barChanges(actor._source.prototypeToken ?? {}, 'prototypeToken.');
    if (power) {
      changes['system.mana.value'] = Number(power.value) || 0;
      changes['system.mana.max'] = Number(power.max) || 0;
      Object.assign(changes, actor.constructor.deletion('system.power'));
    }
    if (!foundry.utils.isEmpty(changes)) await actor.update(changes);
  }
}

/** Add attributes to the `defaultAttributes` list, after `after`, unless it has them. */
async function addStats(names, after, value = '0', max = '') {
  const list = game.settings.get(SYSTEM_ID, 'defaultAttributes');
  const has = (name) => list.some((attribute) => attribute.name?.trim().toLowerCase() === name.toLowerCase());
  const missing = names.filter((name) => !has(name)).map((name) => ({ name, value, max }));
  if (!missing.length) return;
  const index = list.findIndex((attribute) => attribute.name?.trim() === after);
  list.splice(index < 0 ? list.length : index + 1, 0, ...missing);
  await game.settings.set(SYSTEM_ID, 'defaultAttributes', list);
}

async function addCharges() {
  const names = Object.values(CONFIG.DOGMALITER.charges).map((charge) => charge.name);
  await addStats(names, 'Шанс крита', '2', '2');
  for (const actor of game.actors) {
    const missing = names.filter((name) => !actor.findAttribute(name));
    if (!missing.length) continue;
    const update = {};
    for (const name of missing) update[`system.attributes.${foundry.utils.randomID()}`] = { name, value: '2', max: '2' };
    await actor.update(update);
  }
  // A binding that ran the stat check or the reaction opened another roll mid-roll.
  const systemMacros = game.macros.filter((macro) => macro.getFlag('dogmaliter', 'statRoll') || macro.getFlag('dogmaliter', 'reaction'));
  const uuids = new Set(systemMacros.map((macro) => macro.uuid));
  const bindings = game.settings.get(SYSTEM_ID, 'soundBindings') ?? [];
  if (bindings.some((binding) => uuids.has(binding.macro))) {
    await game.settings.set(SYSTEM_ID, 'soundBindings', bindings.map((binding) => (uuids.has(binding.macro) ? { ...binding, macro: '' } : binding)));
  }
}

/** Attributes into the list of new actors' attributes, after `after`, and onto every actor without them. */
async function addToEveryone(attributes, after) {
  for (const { name, value, max } of attributes) await addStats([name], after, value, max);
  for (const actor of game.actors) {
    const update = {};
    for (const attribute of attributes) {
      if (!actor.findAttribute(attribute.name)) update[`system.attributes.${foundry.utils.randomID()}`] = { ...attribute };
    }
    if (!foundry.utils.isEmpty(update)) await actor.update(update);
  }
}
