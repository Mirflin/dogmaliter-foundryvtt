/**
 * The GM panel: one window for running the game, four pages.
 *
 *   Scene    - the scene being viewed: switch / activate it, pause, pull the
 *              players over; global light, darkness, token vision, fog,
 *              weather; every light and ambient sound on or off.
 *   Players  - each player: online or not, which scene they are looking at,
 *              their character's resources and attributes (editable: "12",
 *              or "-3" / "+5" to change by that much) and effects. Then the
 *              other tokens on the scene, the same way, with a show/hide
 *              button. Also the list of attributes new actors start with.
 *   Regions  - draw a new region; every region of the scene: rename,
 *              recolour, show on the map, switch off, delete; its behaviors
 *              (add, switch off, configure, delete), footsteps set up in
 *              place.
 *   Sounds   - quick-sound buttons, the sound bindings (module/audio/
 *              triggers.mjs) and the scene's footstep regions
 *              (module/audio/footsteps.mjs).
 *
 * Opened from the Token controls (the sliders button) or a keybinding (unset
 * by default: Configure Controls -> DogmaLiter). Only the GM sees either.
 * The panel redraws itself as the world changes - except while a text field
 * in it is being typed in: then it waits until that field is left.
 */

import { SYSTEM_ID, panelView } from '../helpers/settings.mjs';
import { clearLog, getLog } from '../rules/action-log.mjs';
import { blankBinding, getBindings, runBinding, setBindings } from '../audio/triggers.mjs';
import { FOOTSTEPS, footstepBehaviors } from '../audio/footsteps.mjs';
import { SYSTEM_MACROS, ensureSystemMacro, isSystemMacro, resetSystemMacro, systemMacro } from '../rolls/system-macros.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = 'systems/dogmaliter/templates/apps/gm-panel';

const fromUuidSyncImpl = foundry.utils.fromUuidSync ?? globalThis.fromUuidSync;

const TABS = [
  { id: 'scene', icon: 'fa-solid fa-map', label: 'DOGMALITER.Panel.TabScene' },
  { id: 'players', icon: 'fa-solid fa-users', label: 'DOGMALITER.Panel.TabPlayers' },
  { id: 'regions', icon: 'fa-solid fa-draw-polygon', label: 'DOGMALITER.Panel.TabRegions' },
  { id: 'sounds', icon: 'fa-solid fa-volume-high', label: 'DOGMALITER.Panel.TabSounds' },
  { id: 'log', icon: 'fa-solid fa-list-ul', label: 'DOGMALITER.Panel.TabLog' },
];

/** The Scene page's sub-pages. The ones with a list have a search field. */
const SCENE_SECTIONS = [
  { id: 'scenes', icon: 'fa-solid fa-map', label: 'DOGMALITER.Panel.SectionScenes' },
  { id: 'controls', icon: 'fa-solid fa-sliders', label: 'DOGMALITER.Panel.SectionControls' },
  { id: 'lights', icon: 'fa-solid fa-lightbulb', label: 'DOGMALITER.Panel.SectionLights' },
  { id: 'doors', icon: 'fa-solid fa-door-closed', label: 'DOGMALITER.Panel.SectionDoors' },
  { id: 'sounds', icon: 'fa-solid fa-music', label: 'DOGMALITER.Panel.SectionSounds' },
];

/** World events that change something the panel shows. */
const REFRESH_HOOKS = [
  'canvasReady', 'updateScene', 'createScene', 'deleteScene', 'pauseGame',
  'createAmbientLight', 'updateAmbientLight', 'deleteAmbientLight',
  'createAmbientSound', 'updateAmbientSound', 'deleteAmbientSound',
  'createWall', 'updateWall', 'deleteWall',
  'createToken', 'updateToken', 'deleteToken',
  'updateActor', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
  'updateUser', 'userConnected',
  'createRegion', 'updateRegion', 'deleteRegion',
  'createRegionBehavior', 'updateRegionBehavior', 'deleteRegionBehavior',
  'createMacro', 'updateMacro', 'deleteMacro',
];

/** Pull users to a scene - Scene#pullUsers is v13+. */
function pullUsers(scene, users) {
  if (scene.pullUsers) return scene.pullUsers(users);
  for (const user of users) if (user.active) game.socket.emit('pullToScene', scene.id, user.id);
}

/** The names of the scene's regions a point lies in - to tell lights and doors apart, and to find them. */
function regionsAt(scene, point) {
  return scene.regions.contents
    .filter((region) => region.polygonTree?.testPoint?.(point))
    .map((region) => region.name)
    .join(', ');
}

const lower = (name) => String(name ?? '').trim().toLowerCase();

/**
 * The attributes the panel shows for an actor - the ones the GM picked, in
 * that order, or (nothing picked yet) every one with a max - with a bar where
 * the max is a number.
 */
function shownAttributes(actor, view) {
  const list = actor.attributeList ?? [];
  const chosen = view.attributes
    ? view.attributes.map((name) => list.find((attribute) => lower(attribute.name) === lower(name))).filter(Boolean)
    : list.filter((attribute) => attribute.max !== '');
  return chosen.map((attribute) => {
    const value = Number(attribute.value);
    const max = Number(attribute.max);
    const hasBar = attribute.max !== '' && Number.isFinite(value) && Number.isFinite(max) && max > 0;
    const pct = hasBar ? Math.clamp(Math.round((value / max) * 100), 0, 100) : 0;
    return { ...attribute, hasBar, pct, low: hasBar && pct <= 25 };
  });
}

/**
 * Every attribute name there is to pick from: the list new actors start
 * with, in its order, then any other name an actor (or a token on the scene)
 * has, alphabetically. Each name once, whatever its case.
 * @param {Scene|null} scene
 * @returns {{name: string, hasMax: boolean}[]}
 */
function knownAttributes(scene) {
  const known = new Map();
  const add = (name, hasMax) => {
    const key = lower(name);
    if (!key) return;
    if (known.has(key)) known.get(key).hasMax ||= hasMax;
    else known.set(key, { name: String(name).trim(), hasMax });
  };
  const template = (game.settings.get(SYSTEM_ID, 'defaultAttributes') ?? []).map((attribute) => lower(attribute.name));
  for (const name of template) add(name, false);
  // Names as the list writes them, not lower-cased.
  for (const attribute of game.settings.get(SYSTEM_ID, 'defaultAttributes') ?? []) {
    if (known.has(lower(attribute.name))) known.get(lower(attribute.name)).name = String(attribute.name).trim();
  }
  const unlinked = (scene?.tokens.contents ?? []).filter((token) => !token.actorLink).map((token) => token.actor);
  for (const actor of [...game.actors, ...unlinked]) {
    for (const attribute of actor?.attributeList ?? []) add(attribute.name, attribute.max !== '');
  }
  const rank = (key) => (template.includes(key) ? template.indexOf(key) : Infinity);
  return [...known.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || known.get(a).name.localeCompare(known.get(b).name))
    .map(([, entry]) => entry);
}

/** What a character / token card shows. */
function actorCard(actor, tokenDoc, view) {
  return {
    uuid: actor.uuid,
    name: tokenDoc?.name ?? actor.name,
    img: actor.img,
    tokenId: tokenDoc?.id ?? null,
    hidden: !!tokenDoc?.hidden,
    resources: (actor.resourceList ?? []).filter((resource) => resource.enabled && view.resources.includes(resource.key)),
    attributes: shownAttributes(actor, view),
    effects: (actor.temporaryEffects ?? []).map((effect) => ({ img: effect.img, name: effect.name })),
  };
}

export class DogmaLiterGmPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'dogmaliter-gm-panel',
    classes: ['dogmaliter', 'dl-panel'],
    window: { title: 'DOGMALITER.Panel.Title', icon: 'fa-solid fa-sliders', resizable: true },
    position: { width: 760, height: 720 },
    actions: {
      panelTab: DogmaLiterGmPanel.#onTab,
      sceneSection: DogmaLiterGmPanel.#onSceneSection,
      viewScene: DogmaLiterGmPanel.#onViewScene,
      activateScene: DogmaLiterGmPanel.#onActivateScene,
      togglePause: DogmaLiterGmPanel.#onTogglePause,
      pullAll: DogmaLiterGmPanel.#onPullAll,
      pullUser: DogmaLiterGmPanel.#onPullUser,
      globalLight: DogmaLiterGmPanel.#onGlobalLight,
      tokenVision: DogmaLiterGmPanel.#onTokenVision,
      darknessPreset: DogmaLiterGmPanel.#onDarknessPreset,
      resetFog: DogmaLiterGmPanel.#onResetFog,
      lightsAll: DogmaLiterGmPanel.#onLightsAll,
      lightToggle: DogmaLiterGmPanel.#onLightToggle,
      lightPan: DogmaLiterGmPanel.#onLightPan,
      soundsAll: DogmaLiterGmPanel.#onSoundsAll,
      soundToggle: DogmaLiterGmPanel.#onSoundToggle,
      soundPan: DogmaLiterGmPanel.#onSoundPan,
      doorState: DogmaLiterGmPanel.#onDoorState,
      doorsAll: DogmaLiterGmPanel.#onDoorsAll,
      doorPan: DogmaLiterGmPanel.#onDoorPan,
      openSheet: DogmaLiterGmPanel.#onOpenSheet,
      panToken: DogmaLiterGmPanel.#onPanToken,
      tokenHidden: DogmaLiterGmPanel.#onTokenHidden,
      logClear: DogmaLiterGmPanel.#onLogClear,
      footstepsEnabled: DogmaLiterGmPanel.#onFootstepsEnabled,
      footstepToggle: DogmaLiterGmPanel.#onFootstepToggle,
      footstepOpen: DogmaLiterGmPanel.#onFootstepOpen,
      footstepRefresh: DogmaLiterGmPanel.#onFootstepRefresh,
      bindingAdd: DogmaLiterGmPanel.#onBindingAdd,
      bindingDelete: DogmaLiterGmPanel.#onBindingDelete,
      bindingPick: DogmaLiterGmPanel.#onBindingPick,
      bindingTest: DogmaLiterGmPanel.#onBindingTest,
      viewAttributes: DogmaLiterGmPanel.#onViewAttributes,
      systemMacroOpen: DogmaLiterGmPanel.#onSystemMacroOpen,
      systemMacroReset: DogmaLiterGmPanel.#onSystemMacroReset,
      templateAdd: DogmaLiterGmPanel.#onTemplateAdd,
      templateDelete: DogmaLiterGmPanel.#onTemplateDelete,
      templateApply: DogmaLiterGmPanel.#onTemplateApply,
      regionTool: DogmaLiterGmPanel.#onRegionTool,
      regionPan: DogmaLiterGmPanel.#onRegionPan,
      regionActive: DogmaLiterGmPanel.#onRegionActive,
      regionOpen: DogmaLiterGmPanel.#onRegionOpen,
      regionDelete: DogmaLiterGmPanel.#onRegionDelete,
      behaviorAdd: DogmaLiterGmPanel.#onBehaviorAdd,
      behaviorToggle: DogmaLiterGmPanel.#onBehaviorToggle,
      behaviorOpen: DogmaLiterGmPanel.#onBehaviorOpen,
      behaviorDelete: DogmaLiterGmPanel.#onBehaviorDelete,
      behaviorPick: DogmaLiterGmPanel.#onBehaviorPick,
    },
  };

  /** @override */
  static PARTS = {
    nav: { template: `${TEMPLATES}/nav.hbs` },
    scene: { template: `${TEMPLATES}/scene.hbs`, scrollable: [''] },
    players: { template: `${TEMPLATES}/players.hbs`, scrollable: [''] },
    regions: { template: `${TEMPLATES}/regions.hbs`, scrollable: [''] },
    log: { template: `${TEMPLATES}/log.hbs`, scrollable: [''] },
    sounds: { template: `${TEMPLATES}/sounds.hbs`, scrollable: [''] },
  };

  /** The page shown. */
  #tab = 'scene';

  /** The Scene page's sub-page shown. */
  #sceneSection = 'controls';

  /** The Log page's kind filter: '' (all), charge, attribute, resource, note. */
  #logKind = '';

  /** What is typed in each sub-page's search field. */
  #search = {};

  /** A redraw came while a field was being typed in. */
  #refreshPending = false;

  /** Redraw soon - many changes often come at once. */
  refresh = foundry.utils.debounce(() => {
    if (!this.rendered) return;
    const focused = document.activeElement;
    // Any field, a select too: redrawing a select whose list is open closes
    // the list and loses the choice. A select, slider or checkbox gives the
    // focus up once it is changed (see #onChange), so the redraw follows.
    if (focused && this.element.contains(focused) && focused.matches('input, select, textarea')) {
      this.#refreshPending = true;
      return;
    }
    this.render();
  }, 150);

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** The scene the panel works on: the one the GM is looking at. */
  get scene() {
    return canvas.scene ?? game.scenes.current ?? null;
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    // A copy: every part is handed the same context object.
    context = { ...(await super._preparePartContext(partId, context, options)) };
    context.active = this.#tab === partId;
    switch (partId) {
      case 'nav':
        context.tabs = TABS.map((tab) => ({ ...tab, active: tab.id === this.#tab }));
        break;
      case 'scene':
        Object.assign(context, this.#sceneContext());
        break;
      case 'players':
        Object.assign(context, this.#playersContext());
        break;
      case 'log':
        Object.assign(context, this.#logContext());
        break;
      case 'regions':
        Object.assign(context, this.#regionsContext());
        break;
      case 'sounds':
        Object.assign(context, this.#soundsContext());
        break;
    }
    return context;
  }

  #sceneContext() {
    const scene = this.scene;
    if (!scene) return { hasScene: false };
    const environment = scene.environment ?? {};
    const lights = scene.lights.contents.map((light, index) => ({
      id: light.id,
      label: light.name || game.i18n.format('DOGMALITER.Panel.LightN', { n: index + 1 }),
      where: regionsAt(scene, light),
      on: !light.hidden,
      color: light.config.color?.css ?? light.config.color ?? '',
      dim: light.config.dim,
      bright: light.config.bright,
    }));
    const sounds = scene.sounds.contents.map((sound, index) => ({
      id: sound.id,
      label: sound.name || sound.path?.split('/').pop() || game.i18n.format('DOGMALITER.Panel.SoundN', { n: index + 1 }),
      where: regionsAt(scene, sound),
      on: !sound.hidden,
    }));
    const { DOOR, SECRET } = CONST.WALL_DOOR_TYPES;
    const { OPEN, LOCKED } = CONST.WALL_DOOR_STATES;
    const doors = scene.walls.contents
      .filter((wall) => [DOOR, SECRET].includes(wall.door))
      .map((wall, index) => {
        const [x0, y0, x1, y1] = wall.c;
        return {
          id: wall.id,
          label: game.i18n.format('DOGMALITER.Panel.DoorN', { n: index + 1 }),
          where: regionsAt(scene, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }),
          secret: wall.door === SECRET,
          open: wall.ds === OPEN,
          locked: wall.ds === LOCKED,
        };
      });
    const weather = Object.entries(CONFIG.weatherEffects ?? {}).map(([id, effect]) => ({
      id,
      label: game.i18n.localize(effect.label),
      selected: scene.weather === id,
    }));
    const darkness = environment.darknessLevel ?? scene.darkness ?? 0;
    const counts = {
      scenes: game.scenes.size,
      lights: lights.length,
      doors: doors.length,
      sounds: sounds.length,
    };
    return {
      hasScene: true,
      sceneId: scene.id,
      sceneName: scene.name,
      sections: SCENE_SECTIONS.map((section) => ({
        ...section,
        count: counts[section.id],
        active: section.id === this.#sceneSection,
      })),
      search: this.#search,
      scenes: game.scenes.contents
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: s.name, thumb: s.thumb, active: s.active, viewed: s.id === scene.id })),
      paused: game.paused,
      globalLight: !!environment.globalLight?.enabled,
      tokenVision: scene.tokenVision,
      darkness,
      darknessPct: Math.round(darkness * 100),
      weather,
      noWeather: !scene.weather,
      lights,
      lightsOn: lights.filter((light) => light.on).length,
      sounds,
      soundsOn: sounds.filter((sound) => sound.on).length,
      doors,
      doorsOpen: doors.filter((door) => door.open).length,
    };
  }

  #playersContext() {
    const scene = this.scene;
    const view = panelView();
    const users = game.users.contents
      .filter((user) => !user.isGM)
      .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
    const players = users.map((user) => {
      const actor = user.character;
      const tokenDoc = actor ? scene?.tokens.find((token) => token.actorId === actor.id && token.actorLink) : null;
      return {
        id: user.id,
        name: user.name,
        color: user.color?.css ?? user.color ?? '',
        active: user.active,
        sceneName: game.scenes.get(user.viewedScene)?.name ?? '—',
        away: !!scene && user.active && user.viewedScene !== scene.id,
        actor: actor ? actorCard(actor, tokenDoc, view) : null,
        characterId: actor?.id ?? '',
        // Owns no actor at all: can change no values anywhere.
        ownsNothing: !game.actors.some((a) => a.testUserPermission(user, 'OWNER')),
      };
    });
    const tokens = (scene?.tokens.contents ?? [])
      .filter((token) => token.actor && !token.actor.hasPlayerOwner)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((token) => ({ tokenUuid: token.uuid, ...actorCard(token.actor, token, view) }));
    return {
      // The "what to show" picker. Nothing picked yet: the attributes with a max are ticked.
      viewResources: Object.entries(CONFIG.DOGMALITER.resources).map(([key, resource]) => ({
        key,
        ...resource,
        checked: view.resources.includes(key),
      })),
      viewAttributes: knownAttributes(scene).map((attribute) => ({
        name: attribute.name,
        checked: view.attributes ? view.attributes.some((name) => lower(name) === lower(attribute.name)) : attribute.hasMax,
      })),
      viewAuto: view.attributes === null,
      defaultAttributes: game.settings.get(SYSTEM_ID, 'defaultAttributes'),
      systemMacros: Object.entries(SYSTEM_MACROS).map(([key, { name }]) => ({ key, name, exists: !!systemMacro(key) })),
      players,
      actorChoices: Object.fromEntries(
        game.actors.contents.sort((a, b) => a.name.localeCompare(b.name)).map((a) => [a.id, a.name])
      ),
      online: users.filter((user) => user.active).length,
      tokens,
    };
  }

  #logContext() {
    const today = new Date().toDateString();
    const entries = getLog()
      .reverse()
      .map((entry) => {
        const date = new Date(entry.time);
        const from = Number(entry.from);
        const to = Number(entry.to);
        const numeric = entry.field === 'value' && entry.from !== '' && entry.to !== '' && Number.isFinite(from) && Number.isFinite(to);
        const delta = numeric ? to - from : 0;
        return {
          ...entry,
          when: date.toDateString() === today ? date.toLocaleTimeString() : date.toLocaleString(),
          what: game.i18n.format(`DOGMALITER.Log.Field.${entry.field}`, {
            from: entry.from,
            to: entry.field === 'enabled' ? game.i18n.localize(entry.to === 'true' ? 'DOGMALITER.Log.On' : 'DOGMALITER.Log.Off') : entry.to,
          }),
          delta: delta ? (delta > 0 ? `+${delta}` : `${delta}`) : '',
          up: delta > 0,
          search: [entry.actor, entry.user, entry.label, entry.reason].join(' '),
        };
      });
    return {
      entries,
      search: this.#search,
      kinds: ['', 'charge', 'attribute', 'resource', 'note'].map((kind) => ({
        kind,
        label: `DOGMALITER.Log.Kind.${kind || 'all'}`,
        selected: kind === this.#logKind,
      })),
    };
  }

  #soundsContext() {
    const triggers = CONFIG.DOGMALITER.triggers;
    const bindings = getBindings().map((binding) => {
      const trigger = triggers[binding.trigger] ?? {};
      return {
        ...binding,
        hasFilter: !!trigger.filter,
        filterLabel: trigger.filter ?? '',
        // Neither a sound nor a macro: the binding does nothing.
        empty: !binding.sound && !binding.macro,
      };
    });
    // The system's own macros (the stat check, the reaction) are left out: a
    // binding that ran one would open another roll in the middle of a roll.
    const macroChoices = Object.fromEntries(
      game.macros.contents
        .filter((macro) => !isSystemMacro(macro))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((macro) => [macro.uuid, macro.name])
    );
    const footsteps = footstepBehaviors(this.scene).map((behavior) => ({
      uuid: behavior.uuid,
      regionName: behavior.parent.name,
      name: behavior.name,
      src: behavior.system.src,
      wildcard: !!behavior.system.src?.includes('*'),
      count: behavior.system.sounds.length,
      on: !behavior.disabled,
    }));
    return {
      board: bindings
        .filter((binding) => binding.trigger === 'manual' && (binding.sound || binding.macro))
        .map((binding) => ({ id: binding.id, label: binding.filter || binding.sound.split('/').pop() || '?' })),
      bindings,
      triggerChoices: Object.fromEntries(Object.entries(triggers).map(([id, trigger]) => [id, trigger.label])),
      audienceChoices: CONFIG.DOGMALITER.audiences,
      macroChoices,
      footstepsEnabled: game.settings.get(SYSTEM_ID, 'footstepsEnabled'),
      footsteps,
    };
  }

  #regionsContext() {
    const scene = this.scene;
    if (!scene) return { hasScene: false };
    const typeLabel = (type) => game.i18n.localize(CONFIG.RegionBehavior.typeLabels?.[type] ?? type);
    // Footsteps first, the rest by name.
    const types = Object.keys(CONFIG.RegionBehavior.dataModels).sort(
      (a, b) => (b === FOOTSTEPS) - (a === FOOTSTEPS) || typeLabel(a).localeCompare(typeLabel(b))
    );
    const regions = scene.regions.contents
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((region) => ({
        id: region.id,
        name: region.name,
        color: region.color?.css ?? region.color ?? '#ffffff',
        canHide: 'hidden' in region._source,
        active: !region.hidden,
        tokens: [...(region.tokens ?? [])].map((token) => token.name).join(', '),
        behaviors: region.behaviors.contents.map((behavior) => ({
          id: behavior.id,
          name: behavior.name,
          label: typeLabel(behavior.type),
          icon: CONFIG.RegionBehavior.typeIcons?.[behavior.type] ?? 'fa-solid fa-cube',
          on: !behavior.disabled,
          footsteps: behavior.type === FOOTSTEPS ? behavior.system : null,
        })),
      }));
    return {
      hasScene: true,
      regions,
      behaviorTypes: Object.fromEntries(types.map((type) => [type, typeLabel(type)])),
    };
  }

  /* -------------------------------------------- */
  /*  Fields                                      */
  /* -------------------------------------------- */

  /** @override - listeners on the window itself, which stays across redraws. */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.element.addEventListener('change', (event) => this.#onChange(event));
    this.element.addEventListener('input', (event) => {
      if (event.target.dataset.change !== 'darkness') return;
      const output = event.target.parentElement.querySelector('output');
      if (output) output.textContent = `${Math.round(Number(event.target.value) * 100)}%`;
    });
    this.element.addEventListener('input', (event) => {
      const section = event.target.dataset.search;
      if (!section) return;
      this.#search[section] = event.target.value;
      this.#applySearch();
    });
    this.element.addEventListener('focusout', () => {
      if (!this.#refreshPending) return;
      this.#refreshPending = false;
      this.refresh();
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#applySearch();
  }

  /** Hide the list rows that do not match their sub-page's search text (name, or a region they are in). */
  #applySearch() {
    for (const list of this.element.querySelectorAll('[data-search-list]')) {
      const wanted = (this.#search[list.dataset.searchList] ?? '').trim().toLowerCase();
      for (const row of list.querySelectorAll('[data-search-text]')) {
        // The Log page also filters by kind.
        const wrongKind = !!this.#logKind && 'kind' in row.dataset && row.dataset.kind !== this.#logKind;
        row.hidden = wrongKind || (!!wanted && !row.dataset.searchText.toLowerCase().includes(wanted));
      }
    }
  }

  /** A field marked `data-change` was changed. */
  async #onChange(event) {
    const input = event.target;
    const scene = this.scene;
    // Done with it: let the redraw that waits for the focus to leave go ahead.
    if (input.matches('select, input[type="range"], input[type="checkbox"], input[type="color"]')) {
      queueMicrotask(() => input.blur());
    }
    switch (input.dataset.change) {
      case 'darkness':
        return scene?.update({ 'environment.darknessLevel': Number(input.value) }, { animateDarkness: 1500 });
      case 'weather':
        return scene?.update({ weather: input.value });
      case 'logKind':
        this.#logKind = input.value;
        return this.#applySearch();
      case 'playerCharacter':
        return this.#assignCharacter(input);
      case 'panelView':
        return this.#saveView();
      case 'attribute':
        return this.#changeAttribute(input);
      case 'binding':
        return this.#saveBinding(input.closest('[data-binding-id]'));
      case 'template':
        return this.#saveTemplate();
      case 'regionName':
        if (input.value.trim()) return DogmaLiterGmPanel.#region(input, scene)?.update({ name: input.value.trim() });
        return;
      case 'regionColor':
        return DogmaLiterGmPanel.#region(input, scene)?.update({ color: input.value });
      case 'behaviorField': {
        const value = ['range', 'number'].includes(input.type) ? Number(input.value) : input.value;
        return DogmaLiterGmPanel.#behavior(input, scene)?.update({ [input.dataset.field]: value });
      }
    }
  }

  /**
   * "12" sets the value; "-3" or "+5" changes a numeric value by that much.
   * A resource (data-resource) is a number; an attribute is stored as text.
   */
  async #changeAttribute(input) {
    const actor = DogmaLiterGmPanel.#actorOf(input);
    const key = input.dataset.resource;
    if (key) {
      const raw = input.value.trim().replace(/\s+/g, '');
      const number = Number(raw);
      if (!actor || !raw || !Number.isFinite(number)) return;
      // Foundry's own bar change, as the token HUD does it: "-3"/"+5" stays
      // within 0 and the max.
      await actor.modifyTokenAttribute(key, number, /^[+-]/.test(raw), true);
      input.value = actor.system[key]?.value ?? '';
      return;
    }
    const attribute = actor?.attributeList.find((a) => a.id === input.dataset.attributeId);
    if (!attribute) return;
    const raw = input.value.trim();
    const delta = Number(raw.replace(/\s+/g, ''));
    const current = Number(attribute.value);
    const value = /^[+-]/.test(raw) && Number.isFinite(delta) && attribute.value !== '' && Number.isFinite(current)
      ? String(current + delta)
      : raw;
    input.value = value;
    await actor.update({ [`system.attributes.${attribute.id}.value`]: value });
  }

  /** Write one binding row's fields to the setting. */
  async #saveBinding(row) {
    if (!row) return;
    const bindings = getBindings();
    const binding = bindings.find((b) => b.id === row.dataset.bindingId);
    if (!binding) return;
    for (const field of row.querySelectorAll('[name]')) {
      binding[field.name] = field.type === 'range' ? Number(field.value) : field.value;
    }
    await setBindings(bindings);
  }

  /**
   * Give a player a character: it becomes their character, and they its
   * owner - which is what lets them change its values. Clearing it leaves
   * their ownership as it was.
   */
  async #assignCharacter(input) {
    const user = game.users.get(input.closest('[data-user-id]')?.dataset.userId);
    if (!user) return;
    const actor = game.actors.get(input.value) ?? null;
    if (actor && !actor.testUserPermission(user, 'OWNER')) {
      await actor.update({ [`ownership.${user.id}`]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    }
    await user.update({ character: actor?.id ?? null });
  }

  /** Write the ticked resources and attributes of the "what to show" picker to the setting. */
  async #saveView(attributes = null) {
    const checked = (selector) => [...this.element.querySelectorAll(`${selector}:checked`)];
    await game.settings.set(SYSTEM_ID, 'panelView', {
      resources: checked('[data-view-resource]').map((input) => input.dataset.viewResource),
      attributes: attributes ?? checked('[data-view-attribute]').map((input) => input.dataset.viewAttribute),
    });
  }

  /** Write the "attributes of new actors" rows to the setting. */
  async #saveTemplate() {
    const rows = this.element.querySelectorAll('.dl-template-row[data-index]');
    const list = [...rows].map((row) => ({
      name: row.querySelector('[name="name"]').value.trim(),
      value: row.querySelector('[name="value"]').value.trim(),
      max: row.querySelector('[name="max"]').value.trim(),
    }));
    await game.settings.set(SYSTEM_ID, 'defaultAttributes', list);
  }

  /** The region of the row a control is in. */
  static #region(element, scene) {
    return scene?.regions.get(element.closest('[data-region-id]')?.dataset.regionId) ?? null;
  }

  /** The behavior of the row a control is in. */
  static #behavior(element, scene) {
    return DogmaLiterGmPanel.#region(element, scene)?.behaviors.get(element.closest('[data-behavior-id]')?.dataset.behaviorId) ?? null;
  }

  /** The actor of the card a control is in. */
  static #actorOf(element) {
    const card = element.closest('[data-token-uuid], [data-actor-uuid]');
    if (!card) return null;
    if (card.dataset.tokenUuid) return fromUuidSyncImpl(card.dataset.tokenUuid)?.actor ?? null;
    return fromUuidSyncImpl(card.dataset.actorUuid);
  }

  /* -------------------------------------------- */
  /*  Actions: scene                              */
  /* -------------------------------------------- */

  /** Show another page - no redraw, the pages are all there. */
  static #onTab(event, target) {
    this.#tab = target.dataset.tab;
    for (const element of this.element.querySelectorAll('[data-tab]')) {
      element.classList.toggle('active', element.dataset.tab === this.#tab);
    }
  }

  /** Show another sub-page of the Scene page - no redraw. */
  static #onSceneSection(event, target) {
    this.#sceneSection = target.dataset.section;
    for (const element of this.element.querySelectorAll('[data-section]')) {
      element.classList.toggle('active', element.dataset.section === this.#sceneSection);
    }
  }

  static #selectedScene(target) {
    return game.scenes.get(target.closest('[data-scene-id]')?.dataset.sceneId);
  }

  static #onViewScene(event, target) {
    DogmaLiterGmPanel.#selectedScene(target)?.view();
  }

  static #onActivateScene(event, target) {
    DogmaLiterGmPanel.#selectedScene(target)?.activate();
  }

  static #onTogglePause() {
    // v13+ takes an options object; v12 a "push" boolean.
    const broadcast = (game.release?.generation ?? 12) >= 13 ? { broadcast: true } : true;
    game.togglePause(!game.paused, broadcast);
  }

  static #onPullAll() {
    if (this.scene) pullUsers(this.scene, game.users.filter((user) => !user.isSelf));
  }

  static #onPullUser(event, target) {
    const user = game.users.get(target.closest('[data-user-id]')?.dataset.userId);
    if (this.scene && user) pullUsers(this.scene, [user]);
  }

  static #onGlobalLight() {
    const scene = this.scene;
    scene?.update({ 'environment.globalLight.enabled': !scene.environment.globalLight.enabled });
  }

  static #onTokenVision() {
    const scene = this.scene;
    scene?.update({ tokenVision: !scene.tokenVision });
  }

  static #onDarknessPreset(event, target) {
    this.scene?.update({ 'environment.darknessLevel': Number(target.dataset.value) }, { animateDarkness: 1500 });
  }

  static async #onResetFog() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Panel.ResetFog') },
      content: `<p>${game.i18n.localize('DOGMALITER.Panel.ResetFogConfirm')}</p>`,
    });
    if (confirmed) canvas.fog.reset();
  }

  static #onLightsAll(event, target) {
    const scene = this.scene;
    if (!scene) return;
    const hidden = target.dataset.on !== '1';
    const updates = scene.lights.filter((light) => light.hidden !== hidden).map((light) => ({ _id: light.id, hidden }));
    if (updates.length) scene.updateEmbeddedDocuments('AmbientLight', updates);
  }

  static #onLightToggle(event, target) {
    const light = this.scene?.lights.get(target.closest('[data-light-id]')?.dataset.lightId);
    light?.update({ hidden: !light.hidden });
  }

  static #onLightPan(event, target) {
    const light = this.scene?.lights.get(target.closest('[data-light-id]')?.dataset.lightId);
    if (!light || !canvas.ready) return;
    canvas.animatePan({ x: light.x, y: light.y, duration: 300 });
    canvas.ping?.({ x: light.x, y: light.y });
  }

  static #onSoundsAll(event, target) {
    const scene = this.scene;
    if (!scene) return;
    const hidden = target.dataset.on !== '1';
    const updates = scene.sounds.filter((sound) => sound.hidden !== hidden).map((sound) => ({ _id: sound.id, hidden }));
    if (updates.length) scene.updateEmbeddedDocuments('AmbientSound', updates);
  }

  static #onSoundToggle(event, target) {
    const sound = this.scene?.sounds.get(target.closest('[data-sound-id]')?.dataset.soundId);
    sound?.update({ hidden: !sound.hidden });
  }

  static #onSoundPan(event, target) {
    const sound = this.scene?.sounds.get(target.closest('[data-sound-id]')?.dataset.soundId);
    if (sound) DogmaLiterGmPanel.#panTo({ x: sound.x, y: sound.y });
  }

  /** Set a door to closed / open / locked (CONST.WALL_DOOR_STATES), from data-state. */
  static #onDoorState(event, target) {
    const wall = this.scene?.walls.get(target.closest('[data-wall-id]')?.dataset.wallId);
    wall?.update({ ds: Number(target.dataset.state) });
  }

  /** Every door to one state. Opening leaves locked doors locked. */
  static #onDoorsAll(event, target) {
    const scene = this.scene;
    if (!scene) return;
    const ds = Number(target.dataset.state);
    const { NONE } = CONST.WALL_DOOR_TYPES;
    const { LOCKED, OPEN } = CONST.WALL_DOOR_STATES;
    const updates = scene.walls
      .filter((wall) => wall.door !== NONE && wall.ds !== ds && !(ds === OPEN && wall.ds === LOCKED))
      .map((wall) => ({ _id: wall.id, ds }));
    if (updates.length) scene.updateEmbeddedDocuments('Wall', updates);
  }

  static #onDoorPan(event, target) {
    const wall = this.scene?.walls.get(target.closest('[data-wall-id]')?.dataset.wallId);
    if (!wall) return;
    const [x0, y0, x1, y1] = wall.c;
    DogmaLiterGmPanel.#panTo({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }

  /** Centre the view on a point and ping it. */
  static #panTo(point) {
    if (!canvas.ready) return;
    canvas.animatePan({ ...point, duration: 300 });
    canvas.ping?.(point);
  }

  /* -------------------------------------------- */
  /*  Actions: players and tokens                 */
  /* -------------------------------------------- */

  static #onOpenSheet(event, target) {
    DogmaLiterGmPanel.#actorOf(target)?.sheet.render(true);
  }

  /** Select the token and centre the view on it. */
  static #onPanToken(event, target) {
    const token = canvas.tokens?.get(target.dataset.tokenId);
    if (!token) return;
    token.control({ releaseOthers: true });
    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 300 });
  }

  static #onTokenHidden(event, target) {
    const token = this.scene?.tokens.get(target.dataset.tokenId);
    token?.update({ hidden: !token.hidden });
  }

  /** Empty the action log, after asking. */
  static async #onLogClear() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Log.Clear') },
      content: `<p>${game.i18n.localize('DOGMALITER.Log.ClearConfirm')}</p>`,
    });
    if (confirmed) await clearLog();
  }

  /* -------------------------------------------- */
  /*  Actions: sounds                             */
  /* -------------------------------------------- */

  static #onFootstepsEnabled() {
    game.settings.set(SYSTEM_ID, 'footstepsEnabled', !game.settings.get(SYSTEM_ID, 'footstepsEnabled'));
  }

  static #footstep(target) {
    return fromUuidSyncImpl(target.closest('[data-behavior-uuid]')?.dataset.behaviorUuid);
  }

  static #onFootstepToggle(event, target) {
    const behavior = DogmaLiterGmPanel.#footstep(target);
    behavior?.update({ disabled: !behavior.disabled });
  }

  static #onFootstepOpen(event, target) {
    DogmaLiterGmPanel.#footstep(target)?.sheet.render(true);
  }

  static async #onFootstepRefresh(event, target) {
    const behavior = DogmaLiterGmPanel.#footstep(target);
    if (!behavior) return;
    await behavior.system.refreshFiles();
    ui.notifications.info(
      game.i18n.format('DOGMALITER.Footsteps.Refreshed', { count: behavior.system.sounds.length })
    );
  }

  static async #onBindingAdd() {
    await setBindings([...getBindings(), blankBinding()]);
  }

  static async #onBindingDelete(event, target) {
    const id = target.closest('[data-binding-id]')?.dataset.bindingId;
    await setBindings(getBindings().filter((binding) => binding.id !== id));
  }

  static #onBindingPick(event, target) {
    const row = target.closest('[data-binding-id]');
    const input = row?.querySelector('[name="sound"]');
    if (!input) return;
    const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    new Picker({
      type: 'audio',
      current: input.value,
      callback: (path) => {
        input.value = path;
        this.#saveBinding(row);
      },
    }).render(true);
  }

  /** Play a binding now: the "test" button of a row, and the quick-sound buttons. */
  static #onBindingTest(event, target) {
    const id = target.closest('[data-binding-id]')?.dataset.bindingId;
    const binding = getBindings().find((b) => b.id === id);
    if (!binding) return;
    if (!binding.sound && !binding.macro) {
      return ui.notifications.warn(game.i18n.localize('DOGMALITER.Panel.BindingEmpty'));
    }
    runBinding(binding, { trigger: binding.trigger, values: binding.filter ? [binding.filter] : [] });
  }

  /* -------------------------------------------- */
  /*  Actions: what the Players page shows        */
  /* -------------------------------------------- */

  /** Tick every attribute (data-all="1") or none. */
  static #onViewAttributes(event, target) {
    const all = target.dataset.all === '1';
    const names = all ? [...this.element.querySelectorAll('[data-view-attribute]')].map((input) => input.dataset.viewAttribute) : [];
    this.#saveView(names);
  }

  /* -------------------------------------------- */
  /*  Actions: the stat check macro               */
  /* -------------------------------------------- */

  /** Open a system macro (data-macro: its key) in Foundry's macro editor, creating it if the world has none. */
  static async #onSystemMacroOpen(event, target) {
    (await ensureSystemMacro(target.dataset.macro))?.sheet.render(true);
  }

  /** Put the system's text back into a system macro, after asking. */
  static async #onSystemMacroReset(event, target) {
    const key = target.dataset.macro;
    const name = SYSTEM_MACROS[key]?.name;
    if (!name) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Panel.StatMacroReset') },
      content: `<p>${game.i18n.format('DOGMALITER.Panel.StatMacroResetConfirm', { name: foundry.utils.escapeHTML(name) })}</p>`,
    });
    if (!confirmed) return;
    await resetSystemMacro(key);
    ui.notifications.info(game.i18n.format('DOGMALITER.Panel.StatMacroResetDone', { name }));
  }

  /* -------------------------------------------- */
  /*  Actions: attributes of new actors           */
  /* -------------------------------------------- */

  static async #onTemplateAdd() {
    const list = game.settings.get(SYSTEM_ID, 'defaultAttributes');
    await game.settings.set(SYSTEM_ID, 'defaultAttributes', [...list, { name: '', value: '0', max: '' }]);
  }

  static async #onTemplateDelete(event, target) {
    const index = Number(target.closest('[data-index]')?.dataset.index);
    const list = game.settings.get(SYSTEM_ID, 'defaultAttributes').filter((_, i) => i !== index);
    await game.settings.set(SYSTEM_ID, 'defaultAttributes', list);
  }

  /** Give every actor in the world the attributes of the list it does not have yet. */
  static async #onTemplateApply() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Panel.TemplateApply') },
      content: `<p>${game.i18n.localize('DOGMALITER.Panel.TemplateApplyConfirm')}</p>`,
    });
    if (!confirmed) return;
    let added = 0;
    for (const actor of game.actors) added += await actor.addMissingAttributes();
    ui.notifications.info(game.i18n.format('DOGMALITER.Panel.TemplateApplied', { count: added }));
  }

  /* -------------------------------------------- */
  /*  Actions: regions                            */
  /* -------------------------------------------- */

  /** Switch to the Regions layer with a drawing tool: the GM draws on the map. */
  static #onRegionTool(event, target) {
    if (!canvas.ready) return;
    const tool = target.dataset.tool;
    if (ui.controls.activate) ui.controls.activate({ control: 'regions', tool });
    else canvas.regions.activate();
    ui.notifications.info(game.i18n.localize('DOGMALITER.Panel.RegionDrawHint'));
  }

  /** Show the region: centre the view on it and select it on the Regions layer. */
  static async #onRegionPan(event, target) {
    const region = DogmaLiterGmPanel.#region(target, this.scene);
    const bounds = region?.bounds ?? region?.object?.bounds;
    if (!bounds || !canvas.ready) return;
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    if (ui.controls.activate) await ui.controls.activate({ control: 'regions', tool: 'select' });
    else canvas.regions.activate();
    region.object?.control({ releaseOthers: true });
    canvas.animatePan({ ...center, duration: 300 });
    canvas.ping?.(center);
  }

  /** On / off: a hidden region's behaviors do nothing. */
  static #onRegionActive(event, target) {
    const region = DogmaLiterGmPanel.#region(target, this.scene);
    region?.update({ hidden: !region.hidden });
  }

  static #onRegionOpen(event, target) {
    DogmaLiterGmPanel.#region(target, this.scene)?.sheet.render(true);
  }

  static async #onRegionDelete(event, target) {
    const region = DogmaLiterGmPanel.#region(target, this.scene);
    if (!region) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Panel.RegionDelete') },
      content: `<p>${game.i18n.format('DOGMALITER.Panel.DeleteConfirm', { name: foundry.utils.escapeHTML(region.name) })}</p>`,
    });
    if (confirmed) await region.delete();
  }

  /** Add a behavior of the type picked next to the button. Anything but footsteps opens its configuration. */
  static async #onBehaviorAdd(event, target) {
    const region = DogmaLiterGmPanel.#region(target, this.scene);
    const type = target.closest('.dl-row')?.querySelector('select')?.value;
    if (!region || !type) return;
    const name = game.i18n.localize(CONFIG.RegionBehavior.typeLabels?.[type] ?? type);
    const [behavior] = await region.createEmbeddedDocuments('RegionBehavior', [{ type, name }]);
    if (behavior && type !== FOOTSTEPS) behavior.sheet.render(true);
  }

  static #onBehaviorToggle(event, target) {
    const behavior = DogmaLiterGmPanel.#behavior(target, this.scene);
    behavior?.update({ disabled: !behavior.disabled });
  }

  static #onBehaviorOpen(event, target) {
    DogmaLiterGmPanel.#behavior(target, this.scene)?.sheet.render(true);
  }

  static async #onBehaviorDelete(event, target) {
    const behavior = DogmaLiterGmPanel.#behavior(target, this.scene);
    if (!behavior) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Panel.BehaviorDelete') },
      content: `<p>${game.i18n.format('DOGMALITER.Panel.DeleteConfirm', { name: foundry.utils.escapeHTML(behavior.name) })}</p>`,
    });
    if (confirmed) await behavior.delete();
  }

  /** Pick the footstep sound file. */
  static #onBehaviorPick(event, target) {
    const behavior = DogmaLiterGmPanel.#behavior(target, this.scene);
    if (!behavior) return;
    const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    new Picker({
      type: 'audio',
      current: behavior.system.src ?? '',
      callback: (path) => behavior.update({ 'system.src': path }),
    }).render(true);
  }
}

/* -------------------------------------------- */
/*  The one panel                               */
/* -------------------------------------------- */

let panel = null;

/** `game.dogmaliter.gmPanel`: open, close, toggle and refresh the GM panel. */
export const gmPanel = {
  get app() {
    return panel;
  },
  open() {
    if (!game.user.isGM) return;
    panel ??= new DogmaLiterGmPanel();
    return panel.render({ force: true });
  },
  close() {
    return panel?.close();
  },
  toggle() {
    return panel?.rendered ? this.close() : this.open();
  },
  refresh() {
    panel?.refresh();
  },
};

/** Call at `init`: the Token controls button. */
export function registerGmPanelControls() {
  Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user?.isGM) return;
    const tool = {
      name: 'dogmaliterPanel',
      title: 'DOGMALITER.Panel.Title',
      icon: 'fa-solid fa-sliders',
      button: true,
      visible: true,
    };
    // v13+: a record of controls, each with a record of tools. v12: arrays.
    if (Array.isArray(controls)) {
      controls.find((control) => control.name === 'token')?.tools.push({ ...tool, onClick: () => gmPanel.toggle() });
      return;
    }
    const tokens = controls.tokens;
    if (!tokens) return;
    tokens.tools.dogmaliterPanel = { ...tool, order: Object.keys(tokens.tools).length, onChange: () => gmPanel.toggle() };
  });
}

/** Call at `ready`: redraw the panel when what it shows changes. */
export function registerGmPanelHooks() {
  if (!game.user.isGM) return;
  for (const hook of REFRESH_HOOKS) Hooks.on(hook, () => gmPanel.refresh());
}
