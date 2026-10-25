/**
 * The action log: every change to an actor's attributes, resources and
 * charges - who, whose, what was before and after, and why - for the GM
 * panel's Log page.
 *
 * The client making a change knows the old values: at `preUpdateActor` it
 * describes the change and sends the description along with the update
 * (`options.dogmaliterLog`); every client receives it at `updateActor`, and
 * the active GM's client writes it to the `actionLog` world setting (players
 * may not write world settings). Unlinked tokens' actors go the same way.
 *
 * Why it changed comes from `options.dogmaliterReason` when the code that
 * made the change says so (charges: spent, recovered; the quick bars) - a
 * text, already in the language of the client that made it.
 *
 * Macros can add a line of their own, with no change behind it:
 *
 *   game.dogmaliter.actionLog.note(actor, 'Атака (Фехтование): промах — заряд не снят');
 */

import { SYSTEM_ID } from '../helpers/settings.mjs';

const SOCKET = `system.${SYSTEM_ID}`;

/** How many entries the log keeps; older ones drop off. */
const MAX_ENTRIES = 500;

/** Entries waiting to be written - many changes come at once. */
const queue = [];

const isDeletion = (key, value) =>
  key.startsWith('-=') || (foundry.data.operators?.ForcedDeletion && value instanceof foundry.data.operators.ForcedDeletion);

const text = (value) => (value === undefined || value === null ? '' : String(value));

/** What kind of thing an attribute is: one of the charges, or any other attribute. */
function kindOf(name) {
  const wanted = text(name).trim().toLowerCase();
  const isCharge = Object.values(CONFIG.DOGMALITER.charges).some((charge) => charge.name.toLowerCase() === wanted);
  return isCharge ? 'charge' : 'attribute';
}

/**
 * The log entries for one update of `actor`, from its values before it.
 * @param {Actor} actor
 * @param {object} changes   the update, expanded
 * @param {string|null} reason
 * @returns {object[]}
 */
function describe(actor, changes, reason) {
  const entries = [];
  const add = (entry) => entries.push({ reason, ...entry });

  // Attributes: changed, added, removed.
  for (const [key, change] of Object.entries(changes.system?.attributes ?? {})) {
    const id = key.replace(/^-=/, '');
    const old = actor._source.system?.attributes?.[id];
    if (isDeletion(key, change)) {
      if (old) add({ kind: kindOf(old.name), label: old.name, field: 'removed', from: text(old.value), to: '' });
      continue;
    }
    if (!change || typeof change !== 'object') continue;
    if (!old) {
      add({ kind: kindOf(change.name), label: text(change.name), field: 'added', from: '', to: text(change.value) });
      continue;
    }
    for (const field of ['value', 'max', 'name']) {
      if (field in change && text(change[field]) !== text(old[field])) {
        add({ kind: kindOf(old.name), label: old.name, field, from: text(old[field]), to: text(change[field]) });
      }
    }
  }

  // Resources: health, mana, AP.
  for (const [key, config] of Object.entries(CONFIG.DOGMALITER.resources)) {
    const change = changes.system?.[key];
    if (!change || typeof change !== 'object') continue;
    const old = actor._source.system?.[key] ?? {};
    const label = game.i18n.localize(config.label);
    for (const field of ['value', 'max', 'enabled']) {
      if (field in change && text(change[field]) !== text(old[field])) {
        add({ kind: 'resource', label, field, from: text(old[field]), to: text(change[field]) });
      }
    }
  }

  // Charge recovery starting and ending.
  for (const [key, change] of Object.entries(changes.flags?.dogmaliter?.recovery ?? {})) {
    const chargeKey = key.replace(/^-=/, '');
    const name = CONFIG.DOGMALITER.charges[chargeKey]?.name ?? chargeKey;
    const wasRecovering = Number.isFinite(actor._source.flags?.dogmaliter?.recovery?.[chargeKey]);
    if (isDeletion(key, change)) {
      if (wasRecovering) add({ kind: 'charge', label: name, field: 'recoveryEnd', from: '', to: '' });
    } else if (!wasRecovering && Number.isFinite(change)) {
      add({ kind: 'charge', label: name, field: 'recoveryStart', from: '', to: '' });
    }
  }
  return entries;
}

/** The log, oldest first. */
export function getLog() {
  return foundry.utils.deepClone(game.settings.get(SYSTEM_ID, 'actionLog') ?? []);
}

/** Empty the log (GM). */
export function clearLog() {
  queue.length = 0;
  return game.settings.set(SYSTEM_ID, 'actionLog', []);
}

/** Write what is waiting (active GM only). */
const flush = foundry.utils.debounce(async () => {
  if (!queue.length || !game.users.activeGM?.isSelf) return;
  const log = getLog();
  log.push(...queue.splice(0));
  await game.settings.set(SYSTEM_ID, 'actionLog', log.slice(-MAX_ENTRIES));
}, 400);

/** Add finished entries to the log (active GM's client). */
function record(entries, actor, userId) {
  const user = game.users.get(userId);
  const time = Date.now();
  for (const entry of entries) {
    queue.push({ ...entry, time, user: user?.name ?? '?', actor: actor?.name ?? entry.actor ?? '?' });
  }
  flush();
}

/**
 * A line of a macro's own, with no change behind it.
 * @param {Actor|null} actor
 * @param {string} message
 */
export function note(actor, message) {
  const entry = { kind: 'note', label: '', field: 'note', from: '', to: '', reason: String(message), actor: actor?.name ?? '' };
  if (game.users.activeGM?.isSelf) return record([entry], actor, game.user.id);
  game.socket.emit(SOCKET, { action: 'log', entry, userId: game.user.id });
}

/** Call at `ready`. */
export function registerActionLog() {
  Hooks.on('preUpdateActor', (actor, changes, options) => {
    const entries = describe(actor, changes, options.dogmaliterReason ?? null);
    if (entries.length) options.dogmaliterLog = entries;
  });
  Hooks.on('updateActor', (actor, changes, options, userId) => {
    if (!game.users.activeGM?.isSelf || !options.dogmaliterLog?.length) return;
    record(options.dogmaliterLog, actor, userId);
  });
  game.socket.on(SOCKET, (message) => {
    if (message?.action !== 'log' || !game.users.activeGM?.isSelf) return;
    record([message.entry], null, message.userId);
  });
}
