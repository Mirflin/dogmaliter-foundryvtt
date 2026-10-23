/**
 * World settings, all changed from the GM panel (module/apps/gm-panel.mjs).
 * Each one re-renders the panel when it changes, on every client that has it
 * open.
 */

import { DOGMALITER } from './config.mjs';

export const SYSTEM_ID = 'dogmaliter';

/** Call at `init`. */
export function registerSettings() {
  const refreshPanel = () => game.dogmaliter?.gmPanel?.refresh();

  // [{name, value, max}]: the attributes every new actor starts with.
  game.settings.register(SYSTEM_ID, 'defaultAttributes', {
    scope: 'world',
    config: false,
    type: Array,
    default: foundry.utils.deepClone(DOGMALITER.defaultAttributes),
    onChange: refreshPanel,
  });

  // The data changes module/helpers/migration.mjs has made to this world.
  game.settings.register(SYSTEM_ID, 'migrationVersion', {
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });

  // [{id, trigger, filter, sound, volume, audience, macro}] - see
  // module/audio/triggers.mjs.
  game.settings.register(SYSTEM_ID, 'soundBindings', {
    scope: 'world',
    config: false,
    type: Array,
    default: [],
    onChange: refreshPanel,
  });

  // What the GM panel's Players page shows on each card - each GM their own
  // (`user` scope is v13+; v12 keeps it in the browser):
  // {resources: [keys], attributes: [names] | null}. null: not chosen yet.
  game.settings.register(SYSTEM_ID, 'panelView', {
    scope: (game.release?.generation ?? 12) >= 13 ? 'user' : 'client',
    config: false,
    type: Object,
    default: { resources: null, attributes: null },
    onChange: refreshPanel,
  });

  // Before `panelView`: the attribute names the panel showed, comma-separated.
  // Only read, as the start of `panelView.attributes`.
  game.settings.register(SYSTEM_ID, 'panelAttributes', {
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });

  // The GM's master switch for every footstep region.
  game.settings.register(SYSTEM_ID, 'footstepsEnabled', {
    scope: 'world',
    config: false,
    type: Boolean,
    default: true,
    onChange: refreshPanel,
  });

  game.keybindings.register(SYSTEM_ID, 'openGmPanel', {
    name: 'DOGMALITER.Panel.Open',
    editable: [],
    restricted: true,
    onDown: () => {
      game.dogmaliter.gmPanel.toggle();
      return true;
    },
  });
}

/**
 * What the GM panel shows on each character / token card:
 * `resources` - resource keys; `attributes` - attribute names, or null for
 * "every attribute that has a max" (until the GM picks some).
 * @returns {{resources: string[], attributes: string[]|null}}
 */
export function panelView() {
  const view = game.settings.get(SYSTEM_ID, 'panelView') ?? {};
  const legacy = String(game.settings.get(SYSTEM_ID, 'panelAttributes') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    resources: Array.isArray(view.resources) ? view.resources : Object.keys(CONFIG.DOGMALITER.resources),
    attributes: Array.isArray(view.attributes) ? view.attributes : legacy.length ? legacy : null,
  };
}
