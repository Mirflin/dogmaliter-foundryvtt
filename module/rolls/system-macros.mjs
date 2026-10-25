/**
 * The system's macros live in the world, where the GM can edit them in
 * Foundry: script macros marked with a flag, each made from a file of the
 * system that holds all of it - dialog, dice, charges, chat card, sound
 * triggers:
 *
 *   statRoll   "Бросок характеристики"   macros/stat-roll.js
 *   reaction   "Реакция (блок / уворот)" macros/reaction.js
 *
 * The active GM's client creates a missing one at `ready`, and brings one
 * up to date with its file - but only while nobody has edited it: the macro
 * remembers a hash of the text it was given (`flags.dogmaliter.sourceHash`),
 * and a text that no longer matches it is the GM's and stays. Players may run
 * them (Limited permission), not change them. The GM panel opens them and
 * puts the file's text back.
 *
 * `game.dogmaliter.rollStat({actor, token})` and `rollReaction(...)` - and
 * the sheet's buttons - run the world's macro; with none (deleted, say) the
 * file's text runs as it is.
 */

export const SYSTEM_MACROS = {
  statRoll: { name: 'Бросок характеристики', file: 'macros/stat-roll.js', img: 'icons/dice/d20black.svg' },
  reaction: { name: 'Реакция (блок / уворот)', file: 'macros/reaction.js', img: 'icons/svg/shield.svg' },
};

/**
 * Hashes of earlier versions of the files, as macros made before
 * `sourceHash` was kept have them: such a macro is unedited too.
 */
const KNOWN_HASHES = {
  statRoll: ['f83a6925'],
  reaction: [],
};

/** FNV-1a of the trimmed text (Foundry trims a macro's command). */
export function textHash(text) {
  const trimmed = String(text ?? '').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** The files' texts, fetched once. */
const sources = {};

async function fileText(key, refresh = false) {
  if (!sources[key] || refresh) {
    const response = await fetch(`systems/dogmaliter/${SYSTEM_MACROS[key].file}?v=${Date.now()}`);
    sources[key] = await response.text();
  }
  return sources[key];
}

/** The world's macro for `key`, or null. */
export function systemMacro(key) {
  return game.macros.find((macro) => macro.getFlag('dogmaliter', key)) ?? null;
}

/** Is this one of the system's macros? */
export function isSystemMacro(macro) {
  return Object.keys(SYSTEM_MACROS).some((key) => macro?.getFlag?.('dogmaliter', key));
}

/**
 * The world's macro for `key`, created from its file if there is none yet
 * (GM only).
 * @returns {Promise<Macro|null>}
 */
export async function ensureSystemMacro(key) {
  const existing = systemMacro(key);
  if (existing || !game.user.isGM) return existing;
  const command = await fileText(key);
  const { name, img } = SYSTEM_MACROS[key];
  return getDocumentClass('Macro').create({
    name,
    type: 'script',
    img,
    command,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    flags: { dogmaliter: { [key]: true, sourceHash: textHash(command) } },
  });
}

/** Put the file's text back into the world's macro. */
export async function resetSystemMacro(key) {
  const macro = await ensureSystemMacro(key);
  const command = await fileText(key, true);
  await macro?.update({ command, 'flags.dogmaliter.sourceHash': textHash(command) });
  return macro;
}

/**
 * Call at `ready` (active GM): create the missing macros, update the
 * unedited ones to their files.
 */
export async function syncSystemMacros() {
  for (const key of Object.keys(SYSTEM_MACROS)) {
    const macro = systemMacro(key);
    if (!macro) {
      await ensureSystemMacro(key);
      continue;
    }
    const command = await fileText(key);
    const current = textHash(macro.command);
    if (current === textHash(command)) continue;
    const unedited = current === macro.getFlag('dogmaliter', 'sourceHash') || KNOWN_HASHES[key].includes(current);
    if (!unedited) continue;
    await macro.update({ command, 'flags.dogmaliter.sourceHash': textHash(command) });
    ui.notifications.info(game.i18n.format('DOGMALITER.Macros.Updated', { name: macro.name }));
  }
}

/**
 * Run a system macro.
 * @param {string} key
 * @param {object} [options]
 * @param {Actor} [options.actor]   default: the selected token's actor, or the user's character
 * @param {Token} [options.token]   the token that speaks; default: the actor's token on the scene
 * @param {...*} [options.extra]    more for the macro, as `scope.<name>`
 * @returns {Promise<object|null>}  the macro's return value
 */
export async function runSystemMacro(key, { actor = null, token = null, ...extra } = {}) {
  // Anything else the macro reads from its `scope` variable (the reaction's `reaction`).
  const scope = { ...extra };
  if (actor) {
    scope.actor = actor;
    scope.token = token ?? actor.getActiveTokens?.()[0] ?? null;
  } else if (token) {
    scope.token = token;
  }
  const macro = systemMacro(key);
  if (macro?.canExecute) return macro.execute(scope);
  // No macro in the world: the file's text, as a macro of this user's.
  const temporary = new (getDocumentClass('Macro'))({
    name: SYSTEM_MACROS[key].name,
    type: 'script',
    command: await fileText(key),
    author: game.user.id,
  });
  return temporary.execute(scope);
}

/** The stat check. */
export const rollStat = (options) => runSystemMacro('statRoll', options);

/**
 * A reaction: block or dodge.
 * @param {object} [options]   as runSystemMacro, and `reaction`: 'block' | 'dodge' - picked at once
 */
export const rollReaction = (options) => runSystemMacro('reaction', options);
