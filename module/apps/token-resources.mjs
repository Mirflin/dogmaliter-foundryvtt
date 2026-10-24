/**
 * While a token is selected, a small bar above the macro hotbar shows its
 * health, mana and AP (the ones switched on) and lets them be changed there:
 *
 *   - the number field: "12" sets it, "-3" / "+5" changes it by that much
 *     (within 0 and the max, as the token HUD does it);
 *   - the - / + buttons: by 1, with Shift by 5;
 *   - the max field: the max.
 *
 * Only for a token the user owns (a player: their own; the GM: any). With
 * several selected, the first one; the bar says how many more there are.
 * It is redrawn when the selection or the actor changes - but not while a
 * field in it is being typed in: then when that field is left.
 */

const ID = 'dogmaliter-token-resources';
const TEMPLATE = 'systems/dogmaliter/templates/hud/token-resources.hbs';

const renderTemplateImpl = foundry.applications?.handlebars?.renderTemplate ?? renderTemplate;

/** A redraw came while a field was being typed in. */
let pending = false;

/** The first selected token the user owns that has resources to show, and how many are selected. */
function selection() {
  const controlled = canvas.ready ? canvas.tokens.controlled : [];
  const token = controlled.find((t) => t.actor?.isOwner) ?? null;
  return { token, others: Math.max(0, controlled.length - 1) };
}

/** The bar's element, created above the hotbar the first time. */
function element() {
  let el = document.getElementById(ID);
  if (el) return el;
  const bottom = document.getElementById('ui-bottom');
  if (!bottom) return null;
  el = document.createElement('section');
  el.id = ID;
  el.className = 'dogmaliter dl-token-resources';
  bottom.insertBefore(el, document.getElementById('hotbar'));
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('focusout', () => {
    if (!pending) return;
    pending = false;
    refresh();
  });
  return el;
}

async function render() {
  const { token, others } = selection();
  const resources = (token?.actor?.resourceList ?? []).filter((resource) => resource.enabled);
  const el = document.getElementById(ID);
  if (!token || !resources.length) {
    el?.remove();
    return;
  }
  if (el?.contains(document.activeElement) && document.activeElement.matches('input')) {
    pending = true;
    return;
  }
  const html = await renderTemplateImpl(TEMPLATE, {
    name: token.document.name,
    img: token.document.texture?.src,
    others,
    resources,
  });
  const target = element();
  if (!target) return;
  target.innerHTML = html;
  target.dataset.tokenId = token.id;
}

/** Redraw soon - several changes often come at once. */
export const refresh = foundry.utils.debounce(render, 50);

/** The actor of the token the bar shows. */
function currentActor() {
  const id = document.getElementById(ID)?.dataset.tokenId;
  return canvas.tokens?.get(id)?.actor ?? null;
}

/** - / + : by 1, with Shift by 5. */
async function onClick(event) {
  const button = event.target.closest('[data-step]');
  if (!button) return;
  event.preventDefault();
  const key = button.closest('[data-resource]')?.dataset.resource;
  const actor = currentActor();
  if (!key || !actor) return;
  const step = Number(button.dataset.step) * (event.shiftKey ? 5 : 1);
  await actor.modifyTokenAttribute(key, step, true, true);
}

/** The value field ("12", "-3", "+5") or the max field. */
async function onChange(event) {
  const input = event.target;
  const key = input.closest('[data-resource]')?.dataset.resource;
  const actor = currentActor();
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
  Hooks.on('canvasTearDown', () => document.getElementById(ID)?.remove());
  Hooks.on('deleteToken', () => refresh());
  Hooks.on('updateToken', (tokenDoc, changes) => {
    if ('delta' in changes || 'name' in changes || 'texture' in changes) refresh();
  });
  Hooks.on('updateActor', (actor) => {
    if (actor.getActiveTokens?.().some((token) => token.controlled)) refresh();
  });
}
