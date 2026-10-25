/**
 * Sound bindings: "when this happens, play this sound and/or run this macro".
 *
 * The GM edits them on the panel's Sounds page. They are stored in the
 * `soundBindings` world setting:
 *
 *   { id, trigger: 'attack', filter: 'Фехтование', sound: 'sounds/sword.ogg',
 *     volume: 0.8, audience: 'all', macro: 'Macro.abc...' }
 *
 * `trigger` is a key of CONFIG.DOGMALITER.triggers. `filter` narrows it to one
 * attribute / attack type / character / name - compared without regard to
 * case; empty matches any. `audience` is who hears the sound (all / self /
 * gm). `macro` is a Macro UUID, run with the trigger's details in its scope.
 *
 * Anything can fire a trigger, a macro included:
 *
 *   game.dogmaliter.fireTrigger('custom', { values: ['Взрыв'] });
 *
 * Every fired trigger also calls the `dogmaliter.trigger` hook.
 */

import { SYSTEM_ID } from '../helpers/settings.mjs';
import { isSystemMacro } from '../rolls/system-macros.mjs';

const SOCKET = `system.${SYSTEM_ID}`;

const AudioHelperImpl = foundry.audio?.AudioHelper ?? AudioHelper;
const fromUuidImpl = foundry.utils.fromUuid ?? globalThis.fromUuid;
const fromUuidSyncImpl = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;

const normalize = (text) => String(text ?? '').trim().toLowerCase();

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

/** @returns {object[]} */
export function getBindings() {
  return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, 'soundBindings') ?? []);
}

/** @param {object[]} bindings */
export function setBindings(bindings) {
  return game.settings.set(SYSTEM_ID, 'soundBindings', bindings);
}

/** A new binding with every field at its default. */
export function blankBinding(trigger = 'manual') {
  return { id: foundry.utils.randomID(), trigger, filter: '', sound: '', volume: 0.8, audience: 'all', macro: '' };
}

/* -------------------------------------------- */
/*  Firing                                      */
/* -------------------------------------------- */

/**
 * Fire a trigger: every binding for it whose filter matches one of `values`
 * plays its sound and runs its macro.
 * @param {string} trigger           a key of CONFIG.DOGMALITER.triggers
 * @param {object} [context]
 * @param {string[]} [context.values] what the filter is matched against
 * @param {Actor} [context.actor]
 * @param {Token} [context.token]    the token on the canvas
 * @param {object} [context.data]    anything else the macro should see (plain data)
 */
export async function fireTrigger(trigger, { values = [], actor = null, token = null, data = {} } = {}) {
  const wanted = values.map(normalize);
  const matching = getBindings().filter(
    (binding) => binding.trigger === trigger && (!binding.filter || wanted.includes(normalize(binding.filter)))
  );
  const context = { trigger, values, actor, token, data };
  Hooks.callAll('dogmaliter.trigger', trigger, context);
  for (const binding of matching) await runBinding(binding, context);
}

/**
 * Play one binding's sound and run its macro - what a trigger does, and what
 * a "manual" binding's button on the panel does.
 * @param {object} binding
 * @param {object} [context]   as `fireTrigger` builds it
 */
export async function runBinding(binding, context = {}) {
  playSound(binding);
  if (binding.macro) await runMacro(binding.macro, { binding, ...context });
}

/**
 * @param {object} sound
 * @param {string} sound.sound      the file
 * @param {number} [sound.volume]
 * @param {string} [sound.audience] all | self | gm
 */
export function playSound({ sound, volume = 0.8, audience = 'all' }) {
  if (!sound) return;
  const data = { src: sound, volume: Number(volume) || 0, loop: false, channel: 'interface' };
  if (audience === 'self') return AudioHelperImpl.play(data, false);
  if (audience === 'gm') {
    if (game.user.isGM) AudioHelperImpl.play(data, false);
    const recipients = game.users.filter((user) => user.isGM && user.active && !user.isSelf).map((user) => user.id);
    if (recipients.length) game.socket.emit('playAudio', data, { recipients });
    return;
  }
  return AudioHelperImpl.play(data, true);
}

/**
 * Run a macro with the trigger's details as script variables: `trigger`,
 * `values`, `actor`, `token`, `data`, `binding`. A player who may not run the
 * macro (or cannot even see it) has the GM run it instead.
 */
async function runMacro(uuid, { binding, trigger, values = [], actor = null, token = null, data = {} }) {
  const macro = await fromUuidImpl(uuid);
  // The stat check or the reaction run from a binding would be a roll inside a roll.
  if (isSystemMacro(macro)) return console.warn(`DogmaLiter | A sound binding may not run "${macro.name}".`);
  if (macro?.canExecute) return macro.execute({ binding, trigger, values, actor, token, data });
  if (!game.users.activeGM) return;
  game.socket.emit(SOCKET, {
    action: 'runMacro',
    uuid,
    binding,
    trigger,
    values,
    actorUuid: actor?.uuid ?? null,
    tokenUuid: token?.document?.uuid ?? null,
    data,
  });
}

/* -------------------------------------------- */
/*  Socket and hooks                            */
/* -------------------------------------------- */

/** Call at `ready`. */
export function registerTriggerHooks() {
  game.socket.on(SOCKET, async (message) => {
    if (message?.action !== 'runMacro' || !game.users.activeGM?.isSelf) return;
    const macro = await fromUuidImpl(message.uuid);
    if (!macro) return;
    const actor = message.actorUuid ? fromUuidSyncImpl(message.actorUuid) : null;
    const token = message.tokenUuid ? fromUuidSyncImpl(message.tokenUuid)?.object ?? null : null;
    macro.execute({ binding: message.binding, trigger: message.trigger, values: message.values, actor, token, data: message.data });
  });

  // Combat triggers fire once: `combatStart` is only called on the client
  // that started the combat; the others on the active GM's client.
  const isFiringClient = () => game.users.activeGM?.isSelf;

  Hooks.on('combatStart', (combat) => {
    fireTrigger('combatStart', { data: { combatId: combat.id } });
  });

  Hooks.on('updateCombat', (combat, changes) => {
    if (!isFiringClient() || !combat.started) return;
    if (!('turn' in changes) && !('round' in changes)) return;
    const combatant = combat.combatant;
    if (!combatant) return;
    fireTrigger('combatTurn', {
      values: [combatant.name, combatant.actor?.name].filter(Boolean),
      actor: combatant.actor ?? null,
      token: combatant.token?.object ?? null,
      data: { combatId: combat.id, round: combat.round, turn: combat.turn },
    });
  });

  Hooks.on('deleteCombat', (combat) => {
    if (isFiringClient() && combat.started) fireTrigger('combatEnd', { data: { combatId: combat.id } });
  });
}
