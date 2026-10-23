/**
 * The stat check, as the "throw_stat" macro made it:
 *
 *   result = floor(((multiplier + d20) / 10) * stat)
 *
 * With "Attack" ticked, a second d20 (+ the hit multiplier) sets the distance:
 * 13+ middle, 10+ near, below that a miss. A fencing attack crits when the
 * stat d20 reaches the actor's crit threshold ("Шанс крита"): the result is
 * doubled and the threshold goes back to 20; each fencing attack that does not
 * crit lowers it by one, down to 13. Any other attack puts it back to 20.
 * The names and numbers are in CONFIG.DOGMALITER.statRoll.
 *
 * After the chat card the roll fires the sound triggers (see
 * module/audio/triggers.mjs): attack, attackMiss/Near/Mid, statRoll, nat20,
 * nat1, crit.
 *
 * In a macro: `game.dogmaliter.rollStat()` - the selected token, or the
 * user's own character.
 */

import { fireTrigger } from '../audio/triggers.mjs';

const renderTemplateImpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;

const DIALOG_TEMPLATE = 'systems/dogmaliter/templates/dialogs/stat-roll.hbs';
const CHAT_TEMPLATE = 'systems/dogmaliter/templates/chat/stat-roll.hbs';

const DISTANCE_TRIGGERS = { miss: 'attackMiss', near: 'attackNear', mid: 'attackMid' };
const DISTANCE_STYLES = { miss: 'color: red;', near: 'color: darkblue;', mid: 'color: darkgreen;' };
const DISTANCE_LABELS = {
  miss: 'DOGMALITER.StatRoll.DistanceMiss',
  near: 'DOGMALITER.StatRoll.DistanceNear',
  mid: 'DOGMALITER.StatRoll.DistanceMid',
};

/**
 * Ask for the stat and multipliers, roll, post the result to chat.
 * @param {object} [options]
 * @param {Actor} [options.actor]   default: the selected token's actor, or the user's character
 * @param {Token} [options.token]   the token that speaks; default: the actor's token on the scene
 * @returns {Promise<object|null>}  what was rolled, or null if nothing was
 */
export async function rollStat({ actor = null, token = null } = {}) {
  const i18n = game.i18n;
  token ??= actor ? actor.getActiveTokens?.()[0] ?? null : canvas.tokens?.controlled[0] ?? null;
  actor ??= token?.actor ?? game.user.character ?? null;
  if (!actor) {
    ui.notifications.warn(i18n.localize('DOGMALITER.StatRoll.NoToken'));
    return null;
  }

  const config = CONFIG.DOGMALITER.statRoll;
  const nameIn = (names) => {
    const wanted = names.map((name) => name.trim().toLowerCase());
    return (attribute) => wanted.includes(attribute.name.trim().toLowerCase());
  };
  const isAttack = nameIn(config.attackNames);
  const isHidden = nameIn(config.hiddenNames);
  const attributes = actor.attributeList;
  const stats = attributes.filter((attribute) => !isAttack(attribute) && !isHidden(attribute));
  const attacks = attributes.filter(isAttack);

  if (!stats.length) {
    ui.notifications.error(i18n.localize('DOGMALITER.StatRoll.NoStats'));
    return null;
  }

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: i18n.format('DOGMALITER.StatRoll.Title', { name: actor.name }), icon: 'fa-solid fa-dice-d20' },
    classes: ['dogmaliter', 'dl-stat-roll-dialog'],
    content: await renderTemplateImpl(DIALOG_TEMPLATE, { stats, attacks }),
    buttons: [
      {
        action: 'roll',
        label: 'DOGMALITER.StatRoll.Roll',
        icon: 'fa-solid fa-dice-d20',
        default: true,
        callback: (event, button) => {
          const form = button.form.elements;
          return {
            isAttack: !!form.isAttack?.checked,
            attackId: form.attackType?.value ?? '',
            attackMultiplier: Number(form.attackMultiplier?.value),
            abilityId: form.ability.value,
            multiplier: Number(form.multiplier.value),
          };
        },
      },
      { action: 'cancel', label: 'DOGMALITER.StatRoll.Cancel', icon: 'fa-solid fa-xmark' },
    ],
    rejectClose: false,
  });
  if (!choice || typeof choice !== 'object') return null;

  if (!Number.isFinite(choice.multiplier) || (choice.isAttack && !Number.isFinite(choice.attackMultiplier))) {
    ui.notifications.error(i18n.localize('DOGMALITER.StatRoll.BadMultiplier'));
    return null;
  }
  const ability = stats.find((attribute) => attribute.id === choice.abilityId);
  if (!ability) {
    ui.notifications.error(i18n.localize('DOGMALITER.StatRoll.NoAbility'));
    return null;
  }
  const attack = choice.isAttack ? attacks.find((attribute) => attribute.id === choice.attackId) : null;
  if (choice.isAttack && !attack) {
    ui.notifications.error(i18n.localize('DOGMALITER.StatRoll.NoAttack'));
    return null;
  }

  // Crit threshold as it was before this roll. A missing or non-numeric one
  // counts as the reset value.
  const critRaw = actor.findAttribute(config.critName)?.value ?? '';
  const critThreshold = critRaw !== '' && Number.isFinite(Number(critRaw)) ? Number(critRaw) : config.critReset;
  const isFencing = !!attack && attack.name.trim().toLowerCase() === config.fencingName.toLowerCase();

  // Distance (attacks only).
  let distance = null;
  if (attack) {
    if (!isFencing) await actor.updateAttribute(config.critName, { value: config.critReset });
    const distanceRoll = await new Roll('1d20').evaluate();
    const distanceTotal = distanceRoll.total + choice.attackMultiplier;
    if (distanceTotal >= config.distanceMid) distance = 'mid';
    else if (distanceTotal >= config.distanceNear) distance = 'near';
    else distance = 'miss';
  }

  // The stat itself.
  const statValue = Number(ability.value);
  const roll = await new Roll('1d20').evaluate();
  const die = roll.total;
  const isCrit = isFencing && die >= critThreshold;
  let result = Math.floor(((choice.multiplier + die) / 10) * statValue);
  if (isCrit) result *= 2;

  if (isCrit) {
    await actor.updateAttribute(config.critName, { value: config.critReset });
  } else if (isFencing && critThreshold - 1 >= config.critFloor) {
    await actor.updateAttribute(config.critName, { value: critThreshold - 1 });
  }

  let dieStyle = 'color: black;';
  if (die >= 20 || isCrit) dieStyle = 'color: green;';
  else if (die <= 1) dieStyle = 'color: red;';

  const summary = {
    abilityName: ability.name,
    statValue,
    multiplier: choice.multiplier,
    die,
    result,
    isAttack: !!attack,
    attackName: attack?.name ?? null,
    attackMultiplier: attack ? choice.attackMultiplier : null,
    distance,
    isCrit,
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    content: await renderTemplateImpl(CHAT_TEMPLATE, {
      ...summary,
      actorName: actor.name,
      fencingName: config.fencingName,
      distanceLabel: distance ? i18n.localize(DISTANCE_LABELS[distance]) : '',
      distanceStyle: DISTANCE_STYLES[distance] ?? '',
      dieStyle,
    }),
  });

  // Sound triggers.
  const context = { actor, token, data: summary };
  if (attack) {
    await fireTrigger('attack', { ...context, values: [attack.name] });
    await fireTrigger(DISTANCE_TRIGGERS[distance], { ...context, values: [attack.name] });
  }
  await fireTrigger('statRoll', { ...context, values: [ability.name] });
  if (die >= 20) await fireTrigger('nat20', { ...context, values: [ability.name] });
  if (die <= 1) await fireTrigger('nat1', { ...context, values: [ability.name] });
  if (isCrit) await fireTrigger('crit', { ...context, values: [attack.name] });

  return summary;
}
