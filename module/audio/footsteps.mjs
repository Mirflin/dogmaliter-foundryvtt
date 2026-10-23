/**
 * Footsteps by region: a Region Behavior, "Footsteps", that plays a step sound
 * while a token walks inside the region.
 *
 * The GM adds it to a region (Region config -> Behaviors -> "+" ->
 * "Footsteps") and picks the sound: one file, or a pattern with `*` -
 * `sounds/steps/grass-*.ogg` - for a random file of those on every step.
 * Players may not browse the server's files, so a pattern is looked up by
 * whoever saves the behavior (the GM) and the matches are stored with it.
 *
 * Each client plays the steps itself, from the token's animation: every
 * `interval` grid spaces walked, one step. The volume falls off with the
 * distance to the listener - the user's selected tokens, else their own
 * tokens, as with ambient sounds; a GM with nothing selected hears every
 * step. Where regions overlap, the behavior with the higher priority wins.
 * Flying, burrowing and teleporting tokens make no sound. The GM panel can
 * turn all footsteps off.
 */

import { SYSTEM_ID } from '../helpers/settings.mjs';

/** The behavior's type, as declared in system.json. */
export const FOOTSTEPS = 'footsteps';

const AudioHelperImpl = foundry.audio?.AudioHelper ?? AudioHelper;
const fields = foundry.data.fields;

/** Movement actions that make no step sound. */
const SILENT_ACTIONS = new Set(['fly', 'burrow', 'blink', 'displace']);

/** A jump of more than this many grid spaces in one frame is a teleport, not a step. */
const MAX_FRAME_SPACES = 3;

export class FootstepsBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  /** @override */
  static LOCALIZATION_PREFIXES = ['DOGMALITER.Footsteps'];

  /** @override */
  static defineSchema() {
    return {
      src: new fields.FilePathField({ categories: ['AUDIO'], wildcard: true }),
      volume: new fields.AlphaField({ initial: 0.5, step: 0.05 }),
      interval: new fields.NumberField({ required: true, nullable: false, min: 0.25, max: 3, step: 0.25, initial: 1 }),
      radius: new fields.NumberField({ required: true, nullable: false, min: 0, initial: 15 }),
      audience: new fields.StringField({
        required: true,
        initial: 'all',
        choices: {
          all: 'DOGMALITER.Footsteps.Audience.all',
          visible: 'DOGMALITER.Footsteps.Audience.visible',
          owner: 'DOGMALITER.Footsteps.Audience.owner',
        },
      }),
      priority: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
      // What a `*` pattern in `src` matched. Not on the form: found on save.
      files: new fields.ArrayField(new fields.StringField()),
    };
  }

  /** The files a step picks from. */
  get sounds() {
    if (!this.src) return [];
    return this.src.includes('*') ? this.files : [this.src];
  }

  /** @override */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (userId === game.user.id) this.refreshFiles();
  }

  /** @override */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (userId === game.user.id && changed.system && 'src' in changed.system) this.refreshFiles();
  }

  /**
   * Look up what the `*` pattern matches now and store it - after files were
   * added to or removed from the folder, say. The GM panel has a button for it.
   */
  async refreshFiles() {
    const files = this.src?.includes('*') ? await browseWildcard(this.src) : [];
    if (this.src?.includes('*') && !files.length) {
      ui.notifications.warn(game.i18n.format('DOGMALITER.Footsteps.NoMatches', { src: this.src }));
    }
    if (files.join('\n') !== this.files.join('\n')) await this.parent.update({ 'system.files': files });
  }

  /**
   * Play one step of `token`, standing at `point`, for this user.
   * @param {Token} token
   * @param {{x: number, y: number}} point
   */
  playStep(token, point) {
    if (!this.#canHear(token)) return;
    const volume = this.volume * this.#falloff(point);
    if (volume <= 0.01) return;
    const src = pickSound(this.parent.id, this.sounds);
    if (src) AudioHelperImpl.play({ src, volume, loop: false, channel: 'environment' }, false);
  }

  /** May this user hear the token? A token the GM hid is never heard by players. */
  #canHear(token) {
    if (game.user.isGM) return true;
    if (token.document.hidden) return false;
    if (this.audience === 'owner') return token.document.isOwner;
    if (this.audience === 'visible') return token.visible;
    return true;
  }

  /** 1 next to the listener, down to 0 at `radius`; 1 everywhere with no radius or no listener. */
  #falloff(point) {
    if (!this.radius) return 1;
    const listeners = canvas.sounds?.getListenerPositions?.() ?? canvas.tokens.controlled.map((token) => token.center);
    if (!listeners.length) return 1;
    const nearest = Math.min(...listeners.map((listener) => Math.hypot(listener.x - point.x, listener.y - point.y)));
    const pixelsPerUnit = canvas.dimensions.distancePixels ?? canvas.dimensions.size / canvas.dimensions.distance;
    return Math.max(0, 1 - nearest / (this.radius * pixelsPerUnit));
  }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** The file last played per behavior, so the same file does not play twice in a row. */
const lastSound = new Map();

function pickSound(behaviorId, sounds) {
  if (sounds.length <= 1) return sounds[0] ?? null;
  const choices = sounds.filter((src) => src !== lastSound.get(behaviorId));
  const src = choices[Math.floor(Math.random() * choices.length)];
  lastSound.set(behaviorId, src);
  return src;
}

/** The files a `*` pattern matches, looked for in the user data, then in Foundry's own files. */
async function browseWildcard(src) {
  const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
  const sources = Picker.matchS3URL?.(src) ? ['s3'] : ['data', 'public'];
  for (const source of sources) {
    try {
      const { files = [] } = await Picker.browse(source, src, { wildcard: true });
      if (files.length) return files;
    } catch {
      // Not there, or not allowed to look: try the next source.
    }
  }
  return [];
}

/** Is the behavior on? v13+ also counts a hidden region as off. */
function isActive(behavior) {
  return behavior.active ?? !behavior.disabled;
}

/** Every footsteps behavior in the scene. */
export function footstepBehaviors(scene) {
  if (!scene) return [];
  return scene.regions.contents.flatMap((region) => region.behaviors.filter((behavior) => behavior.type === FOOTSTEPS));
}

/** The footsteps behavior that applies to the token at `point`, or null. */
function footstepsAt(tokenDoc, point) {
  let best = null;
  for (const behavior of footstepBehaviors(tokenDoc.parent)) {
    if (!isActive(behavior)) continue;
    if (best && best.system.priority >= behavior.system.priority) continue;
    const region = behavior.parent;
    if (tokenDoc.level && region.includedInLevel && !region.includedInLevel(tokenDoc.level)) continue;
    // v13+ takes an elevated point; v12 takes the elevation as a second argument.
    const elevation = tokenDoc.elevation;
    if (!region.testPoint({ x: point.x, y: point.y, elevation }, elevation)) continue;
    best = behavior;
  }
  return best;
}

/** How the token is moving now: walk, fly, ... */
function movementAction(tokenDoc) {
  return tokenDoc.movement?.passed?.waypoints?.at(-1)?.action ?? tokenDoc.movementAction ?? 'walk';
}

/* -------------------------------------------- */
/*  Following tokens                            */
/* -------------------------------------------- */

/**
 * Per token: where it was last frame, and how far it has walked since its
 * last step. `travelled` starts at Infinity so the first step of a movement -
 * or the first one into a region - sounds at once.
 */
const trails = new Map();

/**
 * Every frame a token's position is redrawn. While it animates, its document
 * holds the position of that frame, so `token.center` is where it is now.
 * A redraw while it is not animating (it was placed, or its movement ended)
 * starts it afresh.
 * @param {Token} token
 * @param {object} flags   the render flags of this refresh
 */
function onRefreshToken(token, flags) {
  if (!flags.refreshPosition || token.isPreview) return;
  const point = token.center;
  const trail = trails.get(token.id);
  const animating = (token.animationContexts?.size ?? 0) > 0;
  if (!trail || !animating) {
    trails.set(token.id, { x: point.x, y: point.y, travelled: Infinity });
    return;
  }

  const moved = Math.hypot(point.x - trail.x, point.y - trail.y);
  Object.assign(trail, { x: point.x, y: point.y });
  if (!moved) return;
  const gridSize = canvas.grid.size;
  if (moved > gridSize * MAX_FRAME_SPACES) {
    trail.travelled = Infinity;
    return;
  }
  if (!game.settings.get(SYSTEM_ID, 'footstepsEnabled')) return;
  if (SILENT_ACTIONS.has(movementAction(token.document))) return;

  const behavior = footstepsAt(token.document, point);
  if (!behavior) {
    trail.travelled = Infinity;
    return;
  }
  trail.travelled += moved;
  const stride = behavior.system.interval * gridSize;
  if (trail.travelled < stride) return;
  // Keep the remainder, so the steps stay even at a low frame rate.
  trail.travelled = Number.isFinite(trail.travelled) ? (trail.travelled - stride) % stride : 0;
  behavior.system.playStep(token, point);
}

/** Call at `init`. */
export function registerFootsteps() {
  CONFIG.RegionBehavior.dataModels[FOOTSTEPS] = FootstepsBehaviorType;
  CONFIG.RegionBehavior.typeIcons[FOOTSTEPS] = 'fa-solid fa-shoe-prints';
  CONFIG.RegionBehavior.typeHints ??= {};
  CONFIG.RegionBehavior.typeHints[FOOTSTEPS] = 'DOGMALITER.Footsteps.Hint';
  Hooks.on('refreshToken', onRefreshToken);
  Hooks.on('canvasTearDown', () => trails.clear());
}
