/**
 * Skills: Items of type `skill`.
 *
 *   system.description    HTML
 *   system.cost           [{key, name, amount}] - what using it costs: a
 *                         resource (health, mana, ap), a charge (attack,
 *                         block, dodge) or an attribute by name (key
 *                         `attribute`, `name`) - CONFIG.DOGMALITER.skillCosts
 *   system.requirements   [{name, op, min}] - attributes compared with a
 *                         number: `op` one of CONFIG.DOGMALITER.requirementOps
 *                         (>=, >, <=, <, =, !=; >= when missing), `min` the number
 *   system.tags           [string]
 *   system.roll           a roll formula ("1d20", "2d6 + @Strength"), or empty
 *   system.askMultiplier  ask for a multiplier, added to the roll, on use
 *   system.cooldown       turns before it can be used again - in combat only:
 *                         used in a started combat, the copy counts down
 *                         `flags.dogmaliter.cooldown` at the start of each of
 *                         the character's turns; the combat's end clears it.
 *                         Out of combat skills have no cooldown, and cost no
 *                         charges (module/rules/charges.mjs).
 *
 * The GM makes them on the GM panel's Skills page; they are kept in a world
 * compendium, "Навыки" (`world.dogmaliter-skills`, created the first time).
 * A character gets one by having it dropped on their sheet, or by the panel's
 * "give" button: a copy, which remembers where it came from. Using it (the
 * sheet's Skills page) checks the requirements, asks for the multiplier if
 * it should, takes the cost, rolls, posts a chat card and fires the `skill`
 * sound trigger.
 *
 * Changing a skill in the compendium changes every copy characters have
 * (same source; one with no source, by its old name) - its cooldown stays.
 *
 * `game.dogmaliter.skills` - `pack()`, `useSkill(actor, item)`, `giveSkill(actor, skill)`.
 */

import * as charges from './charges.mjs';
import { fireTrigger } from '../audio/triggers.mjs';
import { note as logNote } from './action-log.mjs';

export const PACK_NAME = 'dogmaliter-skills';
const PACK_ID = `world.${PACK_NAME}`;
export const SKILL_IMG = 'icons/svg/book.svg';

const CollectionImpl = foundry.documents?.collections?.CompendiumCollection ?? CompendiumCollection;
const RollImpl = foundry.dice?.Roll ?? Roll;

/** The skills compendium, or null if the world has none yet. */
export function pack() {
  return game.packs.get(PACK_ID) ?? null;
}

/** The skills compendium, created if the world has none yet (GM only). */
export async function ensurePack() {
  const existing = pack();
  if (existing || !game.user.isGM) return existing;
  return CollectionImpl.createCompendium({ name: PACK_NAME, label: game.i18n.localize('DOGMALITER.Skills.PackLabel'), type: 'Item' });
}

/** Every skill of the compendium, by name. */
export async function allSkills() {
  const skillPack = pack();
  if (!skillPack) return [];
  const documents = await skillPack.getDocuments();
  return documents.filter((item) => item.type === 'skill').sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------- */
/*  Describing                                  */
/* -------------------------------------------- */

/** "Мана 2", "Заряд атаки 1", "Сила 3". */
export function costLabel(cost) {
  const config = CONFIG.DOGMALITER.skillCosts[cost.key];
  const name = cost.key === 'attribute' ? cost.name : game.i18n.localize(config?.label ?? cost.key);
  return `${name} ${cost.amount}`;
}

/** The cost entries that mean something (a known key, an amount, a name for attributes). */
export function costs(skill) {
  return (skill.system?.cost ?? []).filter(
    (cost) => cost && cost.key in CONFIG.DOGMALITER.skillCosts && Number(cost.amount) > 0 && (cost.key !== 'attribute' || String(cost.name ?? '').trim())
  );
}

/** Does `value` meet `op` `number`? */
function compare(value, op, number) {
  switch (op) {
    case '>': return value > number;
    case '<=': return value <= number;
    case '<': return value < number;
    case '=': return value === number;
    case '!=': return value !== number;
    default: return value >= number;
  }
}

/** "Интеллект ≥ 2". */
export function requirementLabel(requirement) {
  const op = requirement.op in CONFIG.DOGMALITER.requirementOps ? requirement.op : '>=';
  return `${requirement.name} ${CONFIG.DOGMALITER.requirementOps[op]} ${Number(requirement.min) || 0}`;
}

/** "1d20", "1d8 + мультипликатор", or '' with no roll. */
export function rollLabel(skill) {
  const formula = String(skill.system?.roll ?? '').trim();
  if (!formula) return '';
  return skill.system.askMultiplier ? `${formula} + ${game.i18n.localize('DOGMALITER.Skills.MultiplierShort')}` : formula;
}

/** The requirement entries that mean something. */
export function requirements(skill) {
  return (skill.system?.requirements ?? []).filter((requirement) => requirement && String(requirement.name ?? '').trim());
}

/** What the actor has of what a cost takes. */
function available(actor, cost) {
  if (cost.key in CONFIG.DOGMALITER.resources) return Number(actor.system[cost.key]?.value) || 0;
  if (cost.key in CONFIG.DOGMALITER.charges) {
    const charge = charges.get(actor, cost.key);
    // Out of combat charges are not spent: as good as endless.
    return charge.limited && charges.inCombat(actor) ? charge.value : Infinity;
  }
  return Number(actor.findAttribute(cost.name)?.value) || 0;
}

/**
 * The skill's requirements and costs measured against an actor.
 * @returns {{requirements: object[], costs: object[], canUse: boolean}}
 */
export function check(actor, skill) {
  const reqs = requirements(skill).map((requirement) => {
    const value = Number(actor?.findAttribute(requirement.name)?.value);
    const min = Number(requirement.min) || 0;
    const op = requirement.op in CONFIG.DOGMALITER.requirementOps ? requirement.op : '>=';
    return {
      name: requirement.name,
      op,
      min,
      label: requirementLabel(requirement),
      value: Number.isFinite(value) ? value : null,
      met: Number.isFinite(value) && compare(value, op, min),
    };
  });
  const costList = costs(skill).map((cost) => {
    const have = actor ? available(actor, cost) : 0;
    const amount = Number(cost.amount);
    return { ...cost, amount, label: costLabel(cost), have, ok: have >= amount };
  });
  const cooldown = cooldownLeft(actor, skill);
  return {
    requirements: reqs,
    costs: costList,
    cooldown,
    canUse: !cooldown && reqs.every((r) => r.met) && costList.every((c) => c.ok),
  };
}

/** Turns left before the actor's copy can be used again - 0 out of combat. */
export function cooldownLeft(actor, item) {
  if (!actor || !charges.inCombat(actor)) return 0;
  return Math.max(0, Number(item.getFlag?.('dogmaliter', 'cooldown')) || 0);
}

/** "3 х." - the skill's cooldown, or '' with none. */
export function cooldownLabel(skill) {
  const turns = Number(skill.system?.cooldown) || 0;
  return turns > 0 ? game.i18n.format('DOGMALITER.Skills.CooldownTurns', { turns }) : '';
}

/* -------------------------------------------- */
/*  Using and giving                            */
/* -------------------------------------------- */

/**
 * Use a skill: check, pay, post to chat, fire the `skill` trigger.
 * @param {Actor} actor
 * @param {Item} item   the actor's skill
 * @returns {Promise<boolean>} whether it was used
 */
export async function useSkill(actor, item) {
  const result = check(actor, item);
  if (result.cooldown) {
    ui.notifications.warn(game.i18n.format('DOGMALITER.Skills.OnCooldown', { name: item.name, turns: result.cooldown }));
    return false;
  }
  const missingReq = result.requirements.filter((r) => !r.met);
  if (missingReq.length) {
    ui.notifications.warn(game.i18n.format('DOGMALITER.Skills.RequirementsNotMet', {
      name: item.name,
      list: missingReq.map((r) => r.label).join(', '),
    }));
    return false;
  }
  const short = result.costs.filter((c) => !c.ok);
  if (short.length) {
    ui.notifications.warn(game.i18n.format('DOGMALITER.Skills.CannotPay', { name: item.name, list: short.map((c) => c.label).join(', ') }));
    return false;
  }

  // The roll: the skill's formula, with the actor's roll data (@Attribute), and
  // the multiplier asked for when the skill says so. Asked before paying, so
  // closing the window costs nothing.
  const escape = (text) => foundry.utils.escapeHTML(String(text ?? ''));
  const formula = String(item.system.roll ?? '').trim();
  let roll = null;
  if (formula) {
    if (!RollImpl.validate(formula)) {
      ui.notifications.error(game.i18n.format('DOGMALITER.Skills.BadFormula', { name: item.name, formula }));
      return false;
    }
    let multiplier = 0;
    if (item.system.askMultiplier) {
      const answer = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.format('DOGMALITER.Skills.RollTitle', { name: item.name }), icon: 'fa-solid fa-dice-d20' },
        classes: ['dogmaliter', 'dl-stat-roll-dialog'],
        content: `<div class="dl-stat-roll">
          <p class="hint">${escape(game.i18n.localize('DOGMALITER.Skills.Roll'))}: ${escape(formula)} + ${escape(game.i18n.localize('DOGMALITER.Skills.MultiplierShort'))}</p>
          <div class="form-group">
            <label>${escape(game.i18n.localize('DOGMALITER.Skills.Multiplier'))}</label>
            <input type="number" name="multiplier" value="0" step="any" autofocus>
          </div></div>`,
        buttons: [
          { action: 'roll', label: 'DOGMALITER.Skills.Use', icon: 'fa-solid fa-dice-d20', default: true, callback: (e, button) => Number(button.form.elements.multiplier.value) },
          { action: 'cancel', label: 'DOGMALITER.Skills.Cancel', icon: 'fa-solid fa-xmark' },
        ],
        rejectClose: false,
      });
      if (typeof answer !== 'number') return false;
      if (!Number.isFinite(answer)) {
        ui.notifications.error(game.i18n.localize('DOGMALITER.Skills.BadMultiplier'));
        return false;
      }
      multiplier = answer;
    }
    const full = multiplier ? `${formula} + ${multiplier}` : formula;
    roll = await new RollImpl(full, actor.getRollData()).evaluate();
  }

  // Pay: resources and attributes in one update, charges through the charge rules.
  const reason = game.i18n.format('DOGMALITER.Skills.LogReason', { name: item.name });
  const update = {};
  for (const cost of result.costs) {
    if (cost.key in CONFIG.DOGMALITER.resources) {
      update[`system.${cost.key}.value`] = (Number(actor.system[cost.key]?.value) || 0) - cost.amount;
    } else if (cost.key === 'attribute') {
      const attribute = actor.findAttribute(cost.name);
      update[`system.attributes.${attribute.id}.value`] = String((Number(attribute.value) || 0) - cost.amount);
    }
  }
  if (!foundry.utils.isEmpty(update)) await actor.update(update, { dogmaliterReason: reason });
  for (const cost of result.costs) {
    if (cost.key in CONFIG.DOGMALITER.charges && charges.get(actor, cost.key).limited && charges.inCombat(actor)) {
      await charges.setValue(actor, cost.key, charges.get(actor, cost.key).value - cost.amount, reason);
    }
  }

  // The cooldown starts - in combat only.
  const cooldown = Number(item.system.cooldown) || 0;
  if (cooldown > 0 && charges.inCombat(actor)) {
    await item.setFlag('dogmaliter', 'cooldown', cooldown);
    logNote(actor, game.i18n.format('DOGMALITER.Skills.LogCooldown', { name: item.name, turns: cooldown }));
  }

  const tags = item.system.tags ?? [];
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    // The roll goes along too: dice sound, and 3D dice where a module shows them.
    rolls: roll ? [roll] : [],
    content: `
      <div class="dogmaliter dl-skill-card">
        <h3><img src="${escape(item.img)}" alt=""/> ${escape(item.name)}</h3>
        ${tags.length ? `<p class="dl-skill-card-tags">${tags.map((t) => `<span>${escape(t)}</span>`).join('')}</p>` : ''}
        ${result.costs.length ? `<p><strong>${escape(game.i18n.localize('DOGMALITER.Skills.Paid'))}:</strong> ${result.costs.map((c) => escape(c.label)).join(', ')}</p>` : ''}
        ${roll ? `<div class="dl-skill-card-roll">${await roll.render()}</div>` : ''}
        <div class="dl-skill-card-text">${item.system.description ?? ''}</div>
      </div>`,
  });
  await fireTrigger('skill', { values: [item.name, ...tags], actor, data: { skill: item.name, tags, roll: roll?.total ?? null } });
  return true;
}

/**
 * Give an actor a copy of a skill (from the compendium, or anywhere).
 * @param {Actor} actor
 * @param {Item} skill
 * @returns {Promise<Item|null>} the copy, or null if the actor has it already
 */
export async function giveSkill(actor, skill) {
  if (hasSkill(actor, skill)) {
    ui.notifications.warn(game.i18n.format('DOGMALITER.Skills.AlreadyHas', { actor: actor.name, name: skill.name }));
    return null;
  }
  const data = skill.toObject();
  delete data._id;
  // The compendium skill it all comes from - also when copied from another character.
  const source = skill.getFlag?.('dogmaliter', 'sourceUuid') ?? skill.uuid;
  if (data.flags?.dogmaliter) delete data.flags.dogmaliter.cooldown;
  foundry.utils.setProperty(data, '_stats.compendiumSource', source);
  foundry.utils.setProperty(data, 'flags.dogmaliter.sourceUuid', source);
  const [created] = await actor.createEmbeddedDocuments('Item', [data]);
  if (created) ui.notifications.info(game.i18n.format('DOGMALITER.Skills.Given', { actor: actor.name, name: skill.name }));
  return created ?? null;
}

/** Does the actor have this skill already (the same source, or the same name)? */
export function hasSkill(actor, skill) {
  const source = skill.getFlag?.('dogmaliter', 'sourceUuid') ?? skill.uuid;
  return actor.items.some(
    (item) => item.type === 'skill' && (item.getFlag('dogmaliter', 'sourceUuid') === source || item.name.trim().toLowerCase() === skill.name.trim().toLowerCase())
  );
}

/* -------------------------------------------- */
/*  Keeping copies and cooldowns                */
/* -------------------------------------------- */

/** Every actor whose skills could be copies: the world's, and unlinked tokens' on any scene. */
function everyActor() {
  const unlinked = game.scenes.contents.flatMap((scene) => scene.tokens.filter((token) => !token.actorLink && token.actor).map((token) => token.actor));
  return [...game.actors.contents, ...unlinked];
}

/**
 * Make every copy of a compendium skill match it: name, picture, all of its
 * data. A copy is one with that source, or - with no source at all - the
 * skill's old name.
 * @param {Item} skill
 * @param {string} [oldName]
 * @returns {Promise<number>} how many copies were changed
 */
export async function syncCopies(skill, oldName = skill.name) {
  const source = skill.uuid;
  const data = skill.toObject();
  let count = 0;
  for (const actor of everyActor()) {
    const updates = actor.items
      .filter((item) => {
        if (item.type !== 'skill') return false;
        const itemSource = item.getFlag('dogmaliter', 'sourceUuid') ?? item._stats?.compendiumSource ?? null;
        if (itemSource) return itemSource === source;
        return item.name.trim().toLowerCase() === String(oldName).trim().toLowerCase();
      })
      .map((item) => ({ _id: item.id, name: data.name, img: data.img, system: data.system, 'flags.dogmaliter.sourceUuid': source }));
    if (!updates.length) continue;
    // A merge, not a replacement: the copy's own flags (its cooldown) stay; arrays replace whole.
    await actor.updateEmbeddedDocuments('Item', updates);
    count += updates.length;
  }
  return count;
}

/** Clear the cooldowns of an actor's skills. */
async function clearCooldowns(actor) {
  const updates = actor.items
    .filter((item) => item.type === 'skill' && item.getFlag('dogmaliter', 'cooldown'))
    .map((item) => ({ _id: item.id, ...actor.constructor.deletion('flags.dogmaliter.cooldown') }));
  if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
}

/** Call at `ready`. */
export function registerSkills() {
  // A compendium skill changed: its copies follow (the client that changed it).
  Hooks.on('preUpdateItem', (item, changes, options) => {
    if (item.pack === PACK_ID) options.dogmaliterOldName = item.name;
  });
  Hooks.on('updateItem', async (item, changes, options, userId) => {
    if (item.pack !== PACK_ID || userId !== game.user.id || item.type !== 'skill') return;
    const count = await syncCopies(item, options.dogmaliterOldName);
    if (count) ui.notifications.info(game.i18n.format('DOGMALITER.Skills.CopiesUpdated', { name: item.name, count }));
  });

  // The start of a character's turn: their skills' cooldowns count down by one.
  Hooks.on('updateCombat', async (combat, changes, options) => {
    if (!game.users.activeGM?.isSelf || !combat.started) return;
    if (!('turn' in changes) && !('round' in changes)) return;
    if ((options?.direction ?? 1) < 0) return;
    const actor = combat.combatant?.actor;
    if (!actor) return;
    const updates = actor.items
      .filter((item) => item.type === 'skill' && Number(item.getFlag('dogmaliter', 'cooldown')) > 0)
      .map((item) => {
        const left = Number(item.getFlag('dogmaliter', 'cooldown')) - 1;
        return left > 0
          ? { _id: item.id, 'flags.dogmaliter.cooldown': left }
          : { _id: item.id, ...actor.constructor.deletion('flags.dogmaliter.cooldown') };
      });
    if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
  });

  // The combat is over: no cooldowns outside it.
  Hooks.on('deleteCombat', async (combat) => {
    if (!game.users.activeGM?.isSelf) return;
    for (const combatant of combat.combatants) if (combatant.actor) await clearCooldowns(combatant.actor);
  });
}
