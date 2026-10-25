/**
 * While a token is selected, two small bars let its numbers be changed right
 * there:
 *
 *   resources  above the macro hotbar: health, mana, AP (the ones switched
 *              on). The number field takes "12", or "-3" / "+5" (within 0 and
 *              the max, as the token HUD does it); - / + by 1, with Shift by
 *              5; the second field is the max.
 *   skills     bottom left, above the charges: the actor's skills as
 *              squares, two to a row, in a tall panel of a fixed height
 *              (there even with no skills), scrolling when there are many; the name
 *              on hover, the turns of cooldown on the square; a click uses it
 *              (module/rules/skills.mjs).
 *   charges    bottom left, above the players list: Атака, Блок, Уворот
 *              (module/rules/charges.mjs) - those it has with a max. - / +
 *              by 1; reaching 0 starts their recovery, shown as "↻ 1 / 2"
 *              (+1 so far / as many as the max). The GM also gets a button
 *              for one recovery step (a fight without the combat tracker).
 *
 * Only for a token the user owns (a player: their own; the GM: any). With
 * several selected, the first one; the bars say how many more there are.
 * They are redrawn when the selection or the actor changes - but not while a
 * field in one is being typed in: then when that field is left.
 */

import * as charges from '../rules/charges.mjs';
import { check as checkSkill, useSkill } from '../rules/skills.mjs';

const PANELS = {
  resources: {
    id: 'dogmaliter-token-resources',
    className: 'dogmaliter dl-token-resources',
    template: 'systems/dogmaliter/templates/hud/token-resources.hbs',
    // Above the macro hotbar.
    place: (el) => document.getElementById('ui-bottom')?.insertBefore(el, document.getElementById('hotbar')),
  },
  skills: {
    id: 'dogmaliter-token-skills',
    className: 'dogmaliter dl-token-resources dl-left-panel dl-token-skills',
    template: 'systems/dogmaliter/templates/hud/token-skills.hbs',
    // Bottom left, above the charges (or the players list without them).
    place: (el) => {
      const column = document.getElementById('ui-left-column-1');
      const below = document.getElementById('dogmaliter-token-charges') ?? document.getElementById('players');
      return column?.insertBefore(el, below);
    },
  },
  charges: {
    id: 'dogmaliter-token-charges',
    className: 'dogmaliter dl-token-resources dl-left-panel dl-token-charges',
    template: 'systems/dogmaliter/templates/hud/token-charges.hbs',
    // Bottom left, above the players list.
    place: (el) => {
      const column = document.getElementById('ui-left-column-1');
      return column?.insertBefore(el, document.getElementById('players'));
    },
  },
};

const renderTemplateImpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;

/** A redraw came while a field was being typed in. */
let pending = false;

/** The first selected token the user owns, and how many more are selected. */
function selection() {
  const controlled = canvas.ready ? canvas.tokens.controlled : [];
  const token = controlled.find((t) => t.actor?.isOwner) ?? null;
  return { token, others: Math.max(0, controlled.length - 1) };
}

/** A panel's element, created in its place the first time. */
function element(panel) {
  let el = document.getElementById(panel.id);
  if (el) return el;
  el = document.createElement('section');
  el.id = panel.id;
  el.className = panel.className;
  if (!panel.place(el)) return null;
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('focusout', () => {
    if (!pending) return;
    pending = false;
    refresh();
  });
  return el;
}

/** Draw one panel with `context`, or remove it when there is nothing to show. */
async function draw(panel, context) {
  const el = document.getElementById(panel.id);
  if (!context) {
    el?.remove();
    return;
  }
  if (el?.contains(document.activeElement) && document.activeElement.matches('input')) {
    pending = true;
    return;
  }
  const html = await renderTemplateImpl(panel.template, context);
  const target = element(panel);
  if (!target) return;
  target.innerHTML = html;
  target.dataset.tokenId = context.tokenId;
}

async function render() {
  const { token, others } = selection();
  const actor = token?.actor;
  const base = actor ? { tokenId: token.id, name: token.document.name, img: token.document.texture?.src, others } : null;
  const resources = (actor?.resourceList ?? []).filter((resource) => resource.enabled);
  const chargeList = actor ? charges.list(actor) : [];
  await draw(PANELS.resources, resources.length ? { ...base, resources } : null);
  await draw(PANELS.charges, chargeList.length ? { ...base, charges: chargeList, isGM: game.user.isGM } : null);
  const skills = (actor?.items.contents ?? [])
    .filter((item) => item.type === 'skill')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => {
      const state = checkSkill(actor, item);
      const cost = state.costs.map((c) => c.label).join(', ');
      return { id: item.id, name: item.name, img: item.img, cooldown: state.cooldown, canUse: state.canUse, tooltip: cost ? `${item.name} — ${cost}` : item.name };
    });
  // Shown for any selected actor, with no skills too: the panel keeps its place and size.
  await draw(PANELS.skills, actor ? { ...base, skills } : null);
}

/** Redraw soon - several changes often come at once. */
export const refresh = foundry.utils.debounce(render, 50);

/** The actor of the token a panel shows. */
function actorOf(el) {
  const id = el.closest('[data-token-id]')?.dataset.tokenId;
  return canvas.tokens?.get(id)?.actor ?? null;
}

async function onClick(event) {
  const actor = actorOf(event.target);
  if (!actor) return;

  // A skill square: use it.
  const skillButton = event.target.closest('[data-skill-id]');
  if (skillButton) {
    event.preventDefault();
    const item = actor.items.get(skillButton.dataset.skillId);
    if (item) await useSkill(actor, item);
    return;
  }

  // One recovery step for every recovering charge (GM).
  if (event.target.closest('[data-action="recover"]')) {
    event.preventDefault();
    const recovered = await charges.recover(actor);
    if (!recovered.length) ui.notifications.info(game.i18n.localize('DOGMALITER.Charges.NothingToRecover'));
    return;
  }

  const button = event.target.closest('[data-step]');
  if (!button) return;
  event.preventDefault();
  const step = Number(button.dataset.step);
  const chargeKey = button.closest('[data-charge]')?.dataset.charge;
  if (chargeKey) return charges.setValue(actor, chargeKey, charges.get(actor, chargeKey).value + step);
  const key = button.closest('[data-resource]')?.dataset.resource;
  if (key) await actor.modifyTokenAttribute(key, step * (event.shiftKey ? 5 : 1), true, true);
}

/** A resource's value field ("12", "-3", "+5") or max field. */
async function onChange(event) {
  const input = event.target;
  const key = input.closest('[data-resource]')?.dataset.resource;
  const actor = actorOf(input);
  if (!key || !actor) return;
  const raw = input.value.trim().replace(/\s+/g, '');
  const number = Number(raw);
  if (!raw || !Number.isFinite(number)) return refresh();
  if (input.dataset.field === 'max') return actor.update({ [`system.${key}.max`]: Math.max(0, number) });
  await actor.modifyTokenAttribute(key, number, /^[+-]/.test(raw), true);
  input.value = actor.system[key]?.value ?? '';
}

/** Call at `init`. */
export function registerTokenResources() {
  Hooks.on('controlToken', () => refresh());
  Hooks.on('canvasReady', () => refresh());
  Hooks.on('canvasTearDown', () => {
    for (const panel of Object.values(PANELS)) document.getElementById(panel.id)?.remove();
  });
  Hooks.on('deleteToken', () => refresh());
  Hooks.on('updateToken', (tokenDoc, changes) => {
    if ('delta' in changes || 'name' in changes || 'texture' in changes) refresh();
  });
  Hooks.on('updateActor', (actor) => {
    if (actor.getActiveTokens?.().some((token) => token.controlled)) refresh();
  });
  // The selected actor's skills changed (added, removed, cooldown).
  for (const hook of ['createItem', 'updateItem', 'deleteItem']) {
    Hooks.on(hook, (item) => {
      if (item.parent?.getActiveTokens?.().some((token) => token.controlled)) refresh();
    });
  }
  // Combat starting or ending changes what charges and cooldowns count.
  for (const hook of ['updateCombat', 'deleteCombat', 'createCombatant', 'deleteCombatant']) Hooks.on(hook, () => refresh());
}
