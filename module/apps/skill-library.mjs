/**
 * The skill library: the GM's window for the skills compendium
 * (module/rules/skills.mjs), opened by its own button in the Token controls
 * (the book) or a keybinding (unset by default).
 *
 *   left     "Create skill", "Create folder", and the folders: all skills,
 *            each folder (rename, delete - its skills move out, not away),
 *            skills in no folder. A skill dragged onto a folder moves there.
 *   top      search (name, tag, description), filter by tag and by what the
 *            skill costs.
 *   main     the skills as cards: picture, name, tags, cost, requirements,
 *            roll, cooldown, sound; "Give", "Edit" (module/apps/
 *            skill-editor.mjs), "Delete". A card drags onto a character
 *            sheet, or onto a folder.
 *
 * Picking a folder, searching and filtering only hide cards - no redraw.
 * The window redraws itself when the compendium's skills or folders change.
 */

import { allSkills, cooldownLabel, costLabel, costs, ensurePack, giveSkill, pack, requirementLabel, requirements, rollLabel } from '../rules/skills.mjs';
import { htmlToText, openSkillEditor } from './skill-editor.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = 'systems/dogmaliter/templates/apps/skill-library';
const fromUuidImpl = foundry.utils.fromUuid ?? globalThis.fromUuid;
const lower = (text) => String(text ?? '').trim().toLowerCase();
const escape = (text) => foundry.utils.escapeHTML(String(text ?? ''));

/** Ask for a folder name; null when closed. */
async function askName(title, value = '') {
  const name = await foundry.applications.api.DialogV2.wait({
    window: { title, icon: 'fa-solid fa-folder' },
    content: `<div class="form-group"><label>${escape(game.i18n.localize('DOGMALITER.Skills.FolderName'))}</label>
      <input type="text" name="name" value="${escape(value)}" autofocus></div>`,
    buttons: [
      { action: 'ok', label: 'DOGMALITER.Skills.Save', icon: 'fa-solid fa-check', default: true, callback: (e, button) => button.form.elements.name.value.trim() },
      { action: 'cancel', label: 'DOGMALITER.Skills.Cancel', icon: 'fa-solid fa-xmark' },
    ],
    rejectClose: false,
  });
  return typeof name === 'string' && name && name !== 'cancel' ? name : null;
}

export class DogmaLiterSkillLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'dogmaliter-skill-library',
    classes: ['dogmaliter', 'dl-panel', 'dl-skill-library'],
    window: { title: 'DOGMALITER.Skills.LibraryTitle', icon: 'fa-solid fa-book', resizable: true },
    position: { width: 980, height: 680 },
    actions: {
      create: DogmaLiterSkillLibrary.#onCreate,
      folderCreate: DogmaLiterSkillLibrary.#onFolderCreate,
      folderPick: DogmaLiterSkillLibrary.#onFolderPick,
      folderRename: DogmaLiterSkillLibrary.#onFolderRename,
      folderDelete: DogmaLiterSkillLibrary.#onFolderDelete,
      filtersReset: DogmaLiterSkillLibrary.#onFiltersReset,
      edit: DogmaLiterSkillLibrary.#onEdit,
      give: DogmaLiterSkillLibrary.#onGive,
      delete: DogmaLiterSkillLibrary.#onDelete,
    },
  };

  /** @override */
  static PARTS = {
    sidebar: { template: `${TEMPLATES}/sidebar.hbs`, scrollable: ['.dl-sl-folders'] },
    toolbar: { template: `${TEMPLATES}/toolbar.hbs` },
    list: { template: `${TEMPLATES}/list.hbs`, scrollable: [''] },
  };

  /** What is shown: the folder ('' all, 'none' no folder, or its id), search, tag, cost kind. */
  #filters = { folder: '', search: '', tag: '', cost: '' };

  /** Redraw soon - several changes often come at once. */
  refresh = foundry.utils.debounce(() => {
    if (this.rendered) this.render();
  }, 150);

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const skillPack = pack();
    const folders = (skillPack?.folders?.contents ?? []).sort((a, b) => a.name.localeCompare(b.name));
    const skills = (await allSkills()).map((item) => {
      const tags = item.system.tags ?? [];
      const text = htmlToText(item.system.description);
      const folder = item._source.folder ?? null;
      return {
        uuid: item.uuid,
        name: item.name,
        img: item.img,
        tags,
        costs: costs(item).map(costLabel),
        requirements: requirements(item).map(requirementLabel),
        roll: rollLabel(item),
        cooldown: cooldownLabel(item),
        sound: item.system.sound ?? '',
        excerpt: text.length > 140 ? `${text.slice(0, 140)}…` : text,
        folder: folder && folders.some((f) => f.id === folder) ? folder : 'none',
        search: [item.name, tags.join(' '), text].join(' '),
        tagKey: tags.map(lower).join('|'),
        costKey: costs(item).map((c) => c.key).join('|'),
      };
    });
    const count = (id) => skills.filter((skill) => skill.folder === id).length;
    const f = this.#filters;
    return Object.assign(context, {
      hasPack: !!skillPack,
      skills,
      total: skills.length,
      folders: [
        { id: '', name: game.i18n.localize('DOGMALITER.Skills.AllSkills'), icon: 'fa-solid fa-layer-group', count: skills.length, fixed: true },
        ...folders.map((folder) => ({ id: folder.id, name: folder.name, icon: 'fa-solid fa-folder', count: count(folder.id), color: folder.color?.css ?? '' })),
        { id: 'none', name: game.i18n.localize('DOGMALITER.Skills.NoFolder'), icon: 'fa-regular fa-folder-open', count: count('none'), fixed: true },
      ].map((folder) => ({ ...folder, active: folder.id === f.folder })),
      filters: f,
      tagChoices: [...new Set(skills.flatMap((skill) => skill.tags.map(lower)))].sort().map((tag) => ({ tag, selected: tag === f.tag })),
      costChoices: Object.entries(CONFIG.DOGMALITER.skillCosts).map(([key, { label }]) => ({ key, label, selected: key === f.cost })),
    });
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // Search and filters: hide cards, no redraw.
    this.element.addEventListener('input', (event) => {
      if (event.target.dataset.filter !== 'search') return;
      this.#filters.search = event.target.value;
      this.#applyFilters();
    });
    this.element.addEventListener('change', (event) => {
      const key = event.target.dataset.filter;
      if (!key || key === 'search') return;
      this.#filters[key] = event.target.value;
      this.#applyFilters();
    });
    // Cards drag onto folders here, and onto character sheets.
    this.element.addEventListener('dragstart', (event) => {
      const card = event.target.closest?.('[data-skill-uuid]');
      if (card) event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'Item', uuid: card.dataset.skillUuid }));
    });
    this.element.addEventListener('dragover', (event) => {
      const target = event.target.closest?.('[data-folder-drop]');
      if (!target) return;
      event.preventDefault();
      target.classList.add('is-drop');
    });
    this.element.addEventListener('dragleave', (event) => event.target.closest?.('[data-folder-drop]')?.classList.remove('is-drop'));
    this.element.addEventListener('drop', (event) => this.#onDropOnFolder(event));
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#applyFilters();
  }

  /** Show only the cards that match the folder, search, tag and cost filters. */
  #applyFilters() {
    const { folder, search, tag, cost } = this.#filters;
    const wanted = lower(search);
    let shown = 0;
    for (const card of this.element.querySelectorAll('[data-skill-uuid]')) {
      const hide =
        (folder && card.dataset.folder !== folder) ||
        (tag && !card.dataset.tags.split('|').includes(tag)) ||
        (cost && !card.dataset.costs.split('|').includes(cost)) ||
        (wanted && !card.dataset.searchText.toLowerCase().includes(wanted));
      card.hidden = !!hide;
      if (!hide) shown++;
    }
    const empty = this.element.querySelector('.dl-sl-nothing');
    if (empty) empty.hidden = shown > 0 || !this.element.querySelector('[data-skill-uuid]');
    for (const row of this.element.querySelectorAll('[data-action="folderPick"]')) {
      row.classList.toggle('active', row.dataset.folder === folder);
    }
  }

  /** A skill card dropped on a folder: it moves there. */
  async #onDropOnFolder(event) {
    const target = event.target.closest?.('[data-folder-drop]');
    if (!target) return;
    event.preventDefault();
    target.classList.remove('is-drop');
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }
    const item = data?.uuid ? await fromUuidImpl(data.uuid) : null;
    if (!item || item.pack !== pack()?.collection) return;
    const folder = target.dataset.folderDrop === 'none' ? null : target.dataset.folderDrop || null;
    if ((item._source.folder ?? null) !== folder) await item.update({ folder });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** A new skill - in the folder being shown, if one is. */
  static #onCreate() {
    const folder = this.#filters.folder && this.#filters.folder !== 'none' ? this.#filters.folder : '';
    openSkillEditor({ folder });
  }

  static async #onFolderCreate() {
    const name = await askName(game.i18n.localize('DOGMALITER.Skills.FolderCreate'));
    if (!name) return;
    const skillPack = await ensurePack();
    if (!skillPack) return;
    await getDocumentClass('Folder').create({ name, type: 'Item', sorting: 'a' }, { pack: skillPack.collection });
  }

  static #onFolderPick(event, target) {
    this.#filters.folder = target.dataset.folder ?? '';
    this.#applyFilters();
  }

  static async #onFolderRename(event, target) {
    event.stopPropagation();
    const folder = pack()?.folders.get(target.closest('[data-folder]')?.dataset.folder);
    if (!folder) return;
    const name = await askName(game.i18n.localize('DOGMALITER.Skills.FolderRename'), folder.name);
    if (name) await folder.update({ name });
  }

  /** Delete a folder; its skills move out of it, they are not deleted. */
  static async #onFolderDelete(event, target) {
    event.stopPropagation();
    const folder = pack()?.folders.get(target.closest('[data-folder]')?.dataset.folder);
    if (!folder) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Skills.FolderDelete') },
      content: `<p>${game.i18n.format('DOGMALITER.Skills.FolderDeleteConfirm', { name: escape(folder.name) })}</p>`,
    });
    if (!confirmed) return;
    if (this.#filters.folder === folder.id) this.#filters.folder = '';
    await folder.delete();
  }

  static #onFiltersReset() {
    Object.assign(this.#filters, { search: '', tag: '', cost: '' });
    this.render();
  }

  static #onEdit(event, target) {
    openSkillEditor({ uuid: target.closest('[data-skill-uuid]')?.dataset.skillUuid });
  }

  static async #onDelete(event, target) {
    const item = await fromUuidImpl(target.closest('[data-skill-uuid]')?.dataset.skillUuid);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Skills.Delete') },
      content: `<p>${game.i18n.format('DOGMALITER.Skills.DeleteConfirm', { name: escape(item.name) })}</p>`,
    });
    if (confirmed) await item.delete();
  }

  /** Give a skill to an actor picked in a dialog - players' characters first. */
  static async #onGive(event, target) {
    const item = await fromUuidImpl(target.closest('[data-skill-uuid]')?.dataset.skillUuid);
    if (!item) return;
    const owners = (actor) => game.users.filter((u) => !u.isGM && actor.testUserPermission(u, 'OWNER')).map((u) => u.name);
    const actors = game.actors.contents
      .map((actor) => ({ actor, owners: owners(actor) }))
      .sort((a, b) => (b.owners.length > 0) - (a.owners.length > 0) || a.actor.name.localeCompare(b.actor.name));
    if (!actors.length) return ui.notifications.warn(game.i18n.localize('DOGMALITER.Skills.NoActors'));
    const options = actors
      .map(({ actor, owners: names }) => `<option value="${actor.id}">${escape(actor.name)}${names.length ? ` — ${escape(names.join(', '))}` : ''}</option>`)
      .join('');
    const actorId = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format('DOGMALITER.Skills.GiveTitle', { name: item.name }), icon: 'fa-solid fa-hand-holding' },
      content: `<div class="form-group"><label>${escape(game.i18n.localize('DOGMALITER.Skills.GiveTo'))}</label><select name="actor">${options}</select></div>`,
      buttons: [
        { action: 'give', label: 'DOGMALITER.Skills.Give', icon: 'fa-solid fa-hand-holding', default: true, callback: (e, button) => button.form.elements.actor.value },
        { action: 'cancel', label: 'DOGMALITER.Skills.Cancel', icon: 'fa-solid fa-xmark' },
      ],
      rejectClose: false,
    });
    const actor = game.actors.get(actorId);
    if (actor) await giveSkill(actor, item);
  }
}

/* -------------------------------------------- */
/*  The one library                             */
/* -------------------------------------------- */

let library = null;

/** `game.dogmaliter.skillLibrary`: open, close, toggle the skill library. */
export const skillLibrary = {
  get app() {
    return library;
  },
  open() {
    if (!game.user.isGM) return;
    library ??= new DogmaLiterSkillLibrary();
    return library.render({ force: true });
  },
  close() {
    return library?.close();
  },
  toggle() {
    return library?.rendered ? this.close() : this.open();
  },
};

/** Call at `init`: the Token controls button and the keybinding. */
export function registerSkillLibrary() {
  Hooks.on('getSceneControlButtons', (controls) => {
    if (!game.user?.isGM) return;
    const tool = { name: 'dogmaliterSkills', title: 'DOGMALITER.Skills.LibraryTitle', icon: 'fa-solid fa-book', button: true, visible: true };
    if (Array.isArray(controls)) {
      controls.find((control) => control.name === 'token')?.tools.push({ ...tool, onClick: () => skillLibrary.toggle() });
      return;
    }
    const tokens = controls.tokens;
    if (!tokens) return;
    tokens.tools.dogmaliterSkills = { ...tool, order: Object.keys(tokens.tools).length, onChange: () => skillLibrary.toggle() };
  });
  game.keybindings.register('dogmaliter', 'openSkillLibrary', {
    name: 'DOGMALITER.Skills.LibraryOpen',
    editable: [],
    restricted: true,
    onDown: () => {
      skillLibrary.toggle();
      return true;
    },
  });
}

/** Call at `ready`: redraw when the compendium's skills or folders change. */
export function registerSkillLibraryHooks() {
  if (!game.user.isGM) return;
  const mine = (doc) => doc.pack && doc.pack === pack()?.collection;
  for (const hook of ['createItem', 'updateItem', 'deleteItem', 'createFolder', 'updateFolder', 'deleteFolder']) {
    Hooks.on(hook, (doc) => {
      if (mine(doc)) library?.refresh();
    });
  }
}
