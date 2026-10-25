/**
 * One skill being made or edited (module/rules/skills.mjs), in a window of
 * its own - opened from the skill library (module/apps/skill-library.mjs):
 * name, picture, description, tags, folder, roll, cooldown, sound, cost,
 * requirements. "Save" writes it to the skills compendium (making the
 * compendium the first time) and closes; the copies characters have follow
 * by themselves.
 *
 * The fields carry `data-draft` - the path of their value in the draft - and
 * the draft follows them as they are typed in; the window is only redrawn
 * when rows come or go, or a cost's kind changes what it needs.
 */

import { SKILL_IMG, ensurePack, pack } from '../rules/skills.mjs';
import { playSound } from '../audio/triggers.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const fromUuidImpl = foundry.utils.fromUuid ?? globalThis.fromUuid;
const Picker = () => foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;

/** A new skill's fields. */
const blankDraft = (folder = '') => ({
  name: '', img: SKILL_IMG, description: '', tags: '', folder, cost: [], requirements: [],
  roll: '', askMultiplier: false, cooldown: 0, sound: '', soundVolume: 0.8,
});

/** Plain text (the draft's description) as HTML paragraphs, and back. */
export function textToHtml(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${foundry.utils.escapeHTML(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
export function htmlToText(html) {
  const marked = String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*/gi, '\n\n').replace(/<[^>]+>/g, '');
  const decoder = document.createElement('textarea');
  decoder.innerHTML = marked;
  return decoder.value.trim();
}

/** The names of every attribute the world's actors have, for suggestions. */
function attributeNames() {
  const names = new Map();
  for (const attribute of game.settings.get('dogmaliter', 'defaultAttributes') ?? []) names.set(attribute.name.trim().toLowerCase(), attribute.name.trim());
  for (const actor of game.actors) {
    for (const attribute of actor.attributeList ?? []) names.set(attribute.name.trim().toLowerCase(), attribute.name.trim());
  }
  return [...names.values()].filter(Boolean);
}

export class DogmaLiterSkillEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} [options]
   * @param {string} [options.uuid]     the compendium skill to edit; none: a new one
   * @param {string} [options.folder]   a new skill's folder
   */
  constructor(options = {}) {
    super({ ...options, id: `dogmaliter-skill-editor-${(options.uuid ?? 'new').replace(/\./g, '-')}` });
    this.uuid = options.uuid ?? null;
    this.#draft = this.uuid ? null : blankDraft(options.folder ?? '');
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ['dogmaliter', 'dl-panel', 'dl-skill-editor'],
    window: { title: 'DOGMALITER.Skills.NewTitle', icon: 'fa-solid fa-book', resizable: true },
    position: { width: 620, height: 720 },
    actions: {
      costAdd: DogmaLiterSkillEditor.#onCostAdd,
      reqAdd: DogmaLiterSkillEditor.#onReqAdd,
      rowRemove: DogmaLiterSkillEditor.#onRowRemove,
      imgPick: DogmaLiterSkillEditor.#onImgPick,
      soundPick: DogmaLiterSkillEditor.#onSoundPick,
      soundTest: DogmaLiterSkillEditor.#onSoundTest,
      save: DogmaLiterSkillEditor.#onSave,
      cancel: DogmaLiterSkillEditor.#onCancel,
    },
  };

  /** @override */
  static PARTS = {
    form: { template: 'systems/dogmaliter/templates/apps/skill-editor.hbs', scrollable: [''] },
  };

  /** The skill's fields as they are being edited; null until loaded. */
  #draft = null;

  /** @override */
  get title() {
    return game.i18n.localize(this.uuid ? 'DOGMALITER.Skills.EditTitle' : 'DOGMALITER.Skills.NewTitle');
  }

  /** The edited skill's fields, read once from the compendium. */
  async #loadDraft() {
    const item = await fromUuidImpl(this.uuid);
    if (!item) return blankDraft();
    return {
      name: item.name,
      img: item.img || SKILL_IMG,
      description: htmlToText(item.system.description),
      tags: (item.system.tags ?? []).join(', '),
      folder: item.folder?.id ?? item._source.folder ?? '',
      roll: item.system.roll ?? '',
      askMultiplier: !!item.system.askMultiplier,
      cooldown: Number(item.system.cooldown) || 0,
      sound: item.system.sound ?? '',
      soundVolume: Number(item.system.soundVolume ?? 0.8),
      cost: foundry.utils.deepClone(item.system.cost ?? []).map((cost) => ({ key: cost.key, name: cost.name ?? '', amount: Number(cost.amount) || 1 })),
      requirements: foundry.utils.deepClone(item.system.requirements ?? []).map((r) => ({ name: r.name ?? '', op: r.op || '>=', min: Number(r.min) || 0 })),
    };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#draft ??= await this.#loadDraft();
    const draft = this.#draft;
    const folders = (pack()?.folders?.contents ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return Object.assign(context, {
      draft: {
        ...draft,
        editing: !!this.uuid,
        cost: draft.cost.map((cost, index) => ({ ...cost, index, isAttribute: cost.key === 'attribute' })),
        requirements: draft.requirements.map((requirement, index) => ({ ...requirement, index })),
      },
      folderChoices: Object.fromEntries(folders.map((folder) => [folder.id, folder.name])),
      opChoices: CONFIG.DOGMALITER.requirementOps,
      costChoices: Object.fromEntries(Object.entries(CONFIG.DOGMALITER.skillCosts).map(([key, { label }]) => [key, label])),
      attributeNames: attributeNames(),
    });
  }

  /** @override - the draft follows its fields as they are typed in. */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const follow = (event) => {
      const path = event.target.dataset.draft;
      // A field just replaced by a redraw still sends its "change": not the draft's any more.
      if (!path || !this.element.contains(event.target)) return;
      const { type } = event.target;
      const value = type === 'checkbox' ? event.target.checked : type === 'number' ? Number(event.target.value) || 0 : event.target.value;
      foundry.utils.setProperty(this.#draft, path, value);
      // A cost's kind decides whether it needs an attribute name: redraw then.
      if (event.type === 'change' && path.endsWith('.key')) this.render();
    };
    this.element.addEventListener('input', follow);
    this.element.addEventListener('change', follow);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onCostAdd() {
    this.#draft.cost.push({ key: 'mana', name: '', amount: 1 });
    this.render();
  }

  static #onReqAdd() {
    this.#draft.requirements.push({ name: '', op: '>=', min: 1 });
    this.render();
  }

  /** Remove a cost or requirement row (data-list: cost | requirements, data-index). */
  static #onRowRemove(event, target) {
    this.#draft[target.dataset.list]?.splice(Number(target.dataset.index), 1);
    this.render();
  }

  static #onImgPick() {
    new (Picker())({
      type: 'image',
      current: this.#draft.img,
      callback: (path) => {
        this.#draft.img = path;
        this.render();
      },
    }).render(true);
  }

  static #onSoundPick() {
    new (Picker())({
      type: 'audio',
      current: this.#draft.sound,
      callback: (path) => {
        this.#draft.sound = path;
        this.render();
      },
    }).render(true);
  }

  /** Hear the skill's sound - only here, not for the players. */
  static #onSoundTest() {
    const { sound, soundVolume } = this.#draft;
    if (sound) playSound({ sound, volume: soundVolume, audience: 'self' });
  }

  static #onCancel() {
    this.close();
  }

  /** Make the skill, or save the one edited, in the compendium - and close. */
  static async #onSave() {
    // The field being typed in gives its last change to the draft first.
    document.activeElement?.blur?.();
    const draft = this.#draft;
    const name = draft.name.trim();
    if (!name) return ui.notifications.warn(game.i18n.localize('DOGMALITER.Skills.NeedName'));
    const roll = draft.roll.trim();
    const RollImpl = foundry.dice?.Roll ?? Roll;
    if (roll && !RollImpl.validate(roll)) {
      return ui.notifications.warn(game.i18n.format('DOGMALITER.Skills.BadFormula', { name, formula: roll }));
    }
    const system = {
      description: textToHtml(draft.description),
      cost: draft.cost
        .filter((cost) => cost.key in CONFIG.DOGMALITER.skillCosts && Number(cost.amount) > 0 && (cost.key !== 'attribute' || cost.name.trim()))
        .map((cost) => ({ key: cost.key, name: cost.key === 'attribute' ? cost.name.trim() : '', amount: Number(cost.amount) })),
      requirements: draft.requirements
        .filter((requirement) => requirement.name.trim())
        .map((requirement) => ({
          name: requirement.name.trim(),
          op: requirement.op in CONFIG.DOGMALITER.requirementOps ? requirement.op : '>=',
          min: Number(requirement.min) || 0,
        })),
      tags: [...new Set(draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean))],
      roll,
      askMultiplier: !!roll && !!draft.askMultiplier,
      cooldown: Math.max(0, Math.round(Number(draft.cooldown) || 0)),
      sound: draft.sound.trim(),
      soundVolume: Math.clamp(Number(draft.soundVolume) || 0, 0, 1),
    };
    const data = { name, img: draft.img || SKILL_IMG, folder: draft.folder || null, system };
    if (this.uuid) {
      const item = await fromUuidImpl(this.uuid);
      await item?.update(data);
    } else {
      const skillPack = await ensurePack();
      if (!skillPack) return;
      await getDocumentClass('Item').create({ ...data, type: 'skill' }, { pack: skillPack.collection });
    }
    ui.notifications.info(game.i18n.format(this.uuid ? 'DOGMALITER.Skills.Saved' : 'DOGMALITER.Skills.Created', { name }));
    this.close();
  }
}

/**
 * Open the editor for a compendium skill (its window again if it is open
 * already), or for a new one.
 * @param {object} [options]   as the constructor
 */
export function openSkillEditor(options = {}) {
  const id = `dogmaliter-skill-editor-${(options.uuid ?? 'new').replace(/\./g, '-')}`;
  const open = foundry.applications.instances.get(id);
  if (open) return open.render({ force: true });
  return new DogmaLiterSkillEditor(options).render({ force: true });
}
