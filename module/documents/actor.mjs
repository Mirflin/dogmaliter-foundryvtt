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
 * @extends {Actor}
 */
export class DogmaLiterActor extends Actor {
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
   * Remove an attribute. `-=` is Foundry's syntax for deleting a key: a plain
   * update would merge objects and could never make a key go away.
   * @param {string} id
   */
  async removeAttribute(id) {
    await this.update({ [`system.attributes.-=${id}`]: null });
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
