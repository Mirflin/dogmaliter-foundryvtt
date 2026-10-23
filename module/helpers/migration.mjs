/**
 * One-time changes to a world's data when the system changes shape. Run by
 * the active GM at `ready`; the `migrationVersion` setting remembers what has
 * been done.
 *
 *   1  `system.power` became `system.mana`: its numbers move over, and every
 *      token bar (prototype or placed) that showed `power` shows `mana`.
 *   2  Ловкость, Интеллект, Выносливость join the attributes new actors start
 *      with, if the world has its own list already.
 */

import { SYSTEM_ID } from './settings.mjs';

const CURRENT = 2;

export async function migrateWorld() {
  if (!game.users.activeGM?.isSelf) return;
  const version = game.settings.get(SYSTEM_ID, 'migrationVersion');
  if (version >= CURRENT) return;

  if (version < 1) await powerToMana();
  if (version < 2) await addStats(['Ловкость', 'Интеллект', 'Выносливость'], 'Сила');
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
async function addStats(names, after) {
  const list = game.settings.get(SYSTEM_ID, 'defaultAttributes');
  const has = (name) => list.some((attribute) => attribute.name?.trim().toLowerCase() === name.toLowerCase());
  const missing = names.filter((name) => !has(name)).map((name) => ({ name, value: '0', max: '' }));
  if (!missing.length) return;
  const index = list.findIndex((attribute) => attribute.name?.trim() === after);
  list.splice(index < 0 ? list.length : index + 1, 0, ...missing);
  await game.settings.set(SYSTEM_ID, 'defaultAttributes', list);
}
