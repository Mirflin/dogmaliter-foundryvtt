/**
 * Extend the base Actor document.
 *
 * Attributes are free-form, the way a Roll20 sheet's are: the player adds as
 * many as they like, each with a name, a current value and a max. They are
 * stored under `system.attributes`, keyed by a random id rather than by name,
 * so renaming one never moves its data and a name may contain spaces or
 * punctuation:
 *
 *   system.attributes = { "k3Jd9...": { name: "HP", value: "14", max: "20" }, ... }
 *
 * `value` is the current value (the name Foundry uses for it everywhere, e.g.
 * token bars). `max` may be left empty.
 *
 * Besides them: the resources (CONFIG.DOGMALITER.resources) - health, mana,
 * action points - numbers under `system.health` etc. Each can be switched off
 * per actor (`enabled`); `showBar` and `showValue` say who sees its bar above
 * the token and the number on it: 'none', 'owner' (owners and the GM), 'all'
 * (module/canvas/token.mjs).
 *
 * A new actor starts with the attributes of the `defaultAttributes` setting
 * (edited on the GM panel), unless it is created with attributes of its own
 * (a copy, an import).
 *
 * @extends {Actor}
 */
export class DogmaLiterActor extends Actor {
  /**
   * The attribute rows a new actor starts with, keyed by fresh ids.
   * @returns {object}
   */
  static defaultAttributeData() {
    const list = game.settings.get('dogmaliter', 'defaultAttributes') ?? [];
    return Object.fromEntries(
      list
        .filter((attribute) => String(attribute?.name ?? '').trim())
        .map(({ name, value = '', max = '' }) => [
          foundry.utils.randomID(),
          { name: String(name).trim(), value: String(value ?? ''), max: String(max ?? '') },
        ])
    );
  }

  /** @override */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    const changes = {};
    if (foundry.utils.isEmpty(data.system?.attributes ?? {})) {
      changes['system.attributes'] = this.constructor.defaultAttributeData();
    }
    this.updateSource(changes);
  }

  /**
   * Add every attribute of the `defaultAttributes` setting this actor has
   * none of (by name). Existing ones are left as they are.
   * @returns {Promise<number>} how many were added
   */
  async addMissingAttributes() {
    const missing = Object.entries(this.constructor.defaultAttributeData()).filter(
      ([, attribute]) => !this.findAttribute(attribute.name)
    );
    if (missing.length) {
      await this.update(Object.fromEntries(missing.map(([id, attribute]) => [`system.attributes.${id}`, attribute])));
    }
    return missing.length;
  }

  /**
   * The resources, in CONFIG order, as
   * `[{key, label, color, value, max, enabled, showBar, showValue, pct}]`.
   * @returns {object[]}
   */
  get resourceList() {
    return Object.entries(CONFIG.DOGMALITER.resources).map(([key, config]) => {
      const data = this.system[key] ?? {};
      const value = Number(data.value) || 0;
      const max = Number(data.max) || 0;
      return {
        key,
        ...config,
        value,
        max,
        enabled: data.enabled !== false,
        showBar: data.showBar ?? 'owner',
        showValue: data.showValue ?? 'owner',
        pct: max > 0 ? Math.clamp(Math.round((value / max) * 100), 0, 100) : 0,
      };
    });
  }

  /**
   * The name a roll formula can use for an attribute: `@Strength`,
   * `@Hit_Points`. Spaces become underscores; anything Foundry's formula
   * parser does not accept after an `@` (it takes Latin letters, digits, `_`
   * and `-`) is dropped. Returns '' when nothing is left - a name written
   * entirely in another alphabet has no `@` shortcut.
   * @param {string} name
   * @returns {string}
   */
  static attributeKey(name) {
    return String(name ?? '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '');
  }

  /**
   * Is this the picture Foundry gives an actor that has none (the grey
   * silhouette), or no picture at all? The sheet shows an empty "+" slot for
   * those instead of the silhouette.
   * @param {string} src
   * @returns {boolean}
   */
  static isDefaultImage(src) {
    if (!src) return true;
    const defaults = this.getDefaultArtwork?.({}) ?? {};
    return [defaults.img, defaults.texture?.src, CONST.DEFAULT_TOKEN, this.DEFAULT_ICON].includes(src);
  }

  /**
   * The actor's attributes in the order they were added, as
   * `[{id, name, value, max, key}]`.
   * @returns {object[]}
   */
  get attributeList() {
    return Object.entries(this.system.attributes ?? {})
      // Only rows this sheet made: they always carry `name`. Anything else
      // under system.attributes (the template's old `level`, say) is not an
      // attribute the player added, and is left alone.
      .filter(([, attribute]) => attribute && typeof attribute === 'object' && 'name' in attribute)
      .map(([id, attribute]) => ({
        id,
        name: attribute.name ?? '',
        value: attribute.value ?? '',
        max: attribute.max ?? '',
        key: this.constructor.attributeKey(attribute.name),
      }));
  }

  /**
   * Add an attribute. Returns its id.
   * @param {object} [data]
   * @param {string} [data.id]      a fresh random id when left out
   * @param {string} [data.name]
   * @param {string|number} [data.value]   current value
   * @param {string|number} [data.max]
   */
  async addAttribute({ id = foundry.utils.randomID(), name = '', value = '', max = '' } = {}) {
    await this.update({ [`system.attributes.${id}`]: { name, value, max } });
    return id;
  }

  /**
   * One attribute by its name, as shown on the sheet - not case-sensitive,
   * and any alphabet: `actor.findAttribute('Hit Points')`,
   * `actor.findAttribute('ловкость')`. Returns `{id, name, value, max, key}`,
   * or null when there is none. Meant for macros.
   * @param {string} name
   * @returns {object|null}
   */
  findAttribute(name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    return this.attributeList.find((attribute) => attribute.name.trim().toLowerCase() === wanted) ?? null;
  }

  /**
   * Change an attribute found by name - only the fields given:
   * `actor.updateAttribute('Hit Points', { value: 12 })`,
   * `actor.updateAttribute('Hit Points', { value: 30, max: 30 })`.
   * An attribute that does not exist yet is created. Meant for macros.
   * @param {string} name
   * @param {object} changes   any of `value`, `max`, `name`
   * @returns {Promise<string>} the attribute's id
   */
  async updateAttribute(name, changes = {}) {
    const existing = this.findAttribute(name);
    if (!existing) return this.addAttribute({ name, value: changes.value ?? '', max: changes.max ?? '' });
    const update = {};
    for (const field of ['name', 'value', 'max']) {
      if (field in changes) update[`system.attributes.${existing.id}.${field}`] = changes[field];
    }
    if (Object.keys(update).length) await this.update(update);
    return existing.id;
  }

  /**
   * An update that deletes the key at `path` - a plain update would merge
   * objects and could never make a key go away. v14 does it with a
   * ForcedDeletion value; before it, with a `-=` in front of the key.
   * @param {string} path
   * @returns {object}
   */
  static deletion(path) {
    const ForcedDeletion = foundry.data.operators?.ForcedDeletion;
    if (ForcedDeletion) return { [path]: new ForcedDeletion() };
    const parts = path.split('.');
    const key = parts.pop();
    return { [[...parts, `-=${key}`].join('.')]: null };
  }

  /**
   * Remove an attribute.
   * @param {string} id
   */
  async removeAttribute(id) {
    await this.update(this.constructor.deletion(`system.attributes.${id}`));
  }

  /**
   * Roll data: the system data, plus every attribute under its formula name,
   * so `1d20 + @Strength` works in a roll, and its max as `@Strength_max`
   * (Roll20 writes that `@{Strength|max}`). A numeric value is passed as a
   * number, anything else as text.
   * @override
   */
  getRollData() {
    const data = { ...this.system };
    const asRollValue = (raw) => {
      const number = Number(raw);
      return raw !== '' && Number.isFinite(number) ? number : raw;
    };
    for (const { key, value, max } of this.attributeList) {
      if (!key) continue;
      if (!(key in data)) data[key] = asRollValue(value);
      if (max !== '' && !(`${key}_max` in data)) data[`${key}_max`] = asRollValue(max);
    }
    return data;
  }
}
