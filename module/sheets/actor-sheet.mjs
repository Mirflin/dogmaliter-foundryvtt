/**
 * A Roll20-style character sheet, three pages:
 *
 *   Main        - the portrait, the token image, and the description in a
 *                 Word-like rich-text editor.
 *   Attributes  - a list the player builds themselves: add a row, name it,
 *                 type its current value and max. Usable in rolls as `@Name`
 *                 and `@Name_max`.
 *   Inventory   - every item the actor carries, with buttons to open, send
 *                 and delete each one. "Send" fires the
 *                 `dogmaliter.sendItem` hook (see `_onItemSend`).
 *
 * Both images use Foundry's own `data-edit` mechanism: clicking one opens the
 * file picker, and the chosen path is written to the document path named in
 * the attribute (`img` for the portrait, `prototypeToken.texture.src` for the
 * token). The token image is the actor's prototype token - the image every
 * token placed from now on starts with. Tokens already on a scene keep theirs.
 *
 * Every plain field saves itself on change (`submitOnChange`), the same as on
 * Roll20. The description editor saves with its toolbar's save button or
 * Ctrl+S, and with anything else on the sheet - see "The description editor"
 * below.
 */

/** Foundry v13+ keeps the v1 sheet under `foundry.appv1`; v12 only has the global. */
const BaseActorSheet = foundry.appv1?.sheets?.ActorSheet ?? ActorSheet;
/** Same move for the text editor helper. */
const TextEditorImpl = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;

/** The description's field, which is also the name of its editor on the sheet. */
const DESCRIPTION = 'system.biography';

export class DogmaLiterActorSheet extends BaseActorSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['dogmaliter', 'sheet', 'actor', 'r20-sheet'],
      template: 'systems/dogmaliter/templates/actor/actor-sheet.hbs',
      width: 620,
      height: 640,
      resizable: true,
      submitOnChange: true,
      closeOnSubmit: false,
      tabs: [
        {
          navSelector: '.sheet-tabs',
          contentSelector: '.sheet-body',
          initial: 'main',
        },
      ],
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    const context = await super.getData();
    const actor = this.actor;

    context.system = actor.system;
    // null = no picture yet: the template shows the empty "+" slot instead.
    const isDefault = (src) => actor.constructor.isDefaultImage(src);
    context.portrait = isDefault(actor.img) ? null : actor.img;
    const tokenSrc = actor.prototypeToken?.texture?.src;
    context.token = isDefault(tokenSrc) ? null : tokenSrc;
    context.attributes = actor.attributeList;
    context.inventory = actor.items.contents
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name))
      .map((item) => {
        const quantity = item.system?.quantity;
        return {
          id: item.id,
          name: item.name,
          img: item.img,
          typeLabel: game.i18n.localize(CONFIG.Item.typeLabels?.[item.type] ?? item.type),
          hasQuantity: quantity !== undefined && quantity !== null,
          quantity,
        };
      });
    context.editable = this.isEditable;
    // What the description looks like to someone who cannot edit it: links,
    // inline rolls and the like turned into their live form.
    context.enrichedDescription = await TextEditorImpl.enrichHTML(actor.system.biography ?? '', {
      secrets: actor.isOwner,
      rollData: actor.getRollData(),
      relativeTo: actor,
    });

    return context;
  }

  /* -------------------------------------------- */
  /*  The description editor                      */
  /* -------------------------------------------- */

  // The editor is always open, like a Word page - no pencil to click first.
  // Its content is saved by the save button in its toolbar (or Ctrl+S), by any
  // other field on the sheet saving (the whole form goes up together), and on
  // closing the sheet.
  //
  // The one hazard of an always-open editor is a re-render that nobody on
  // this sheet asked for - another player changing this actor, a token bar
  // moving - which would rebuild the editor and throw away what is being
  // typed. So while the editor holds unsaved text, those re-renders are
  // skipped; the next save brings the sheet up to date.

  /** The description as the editor currently has it, or null if the editor is not running. */
  _editorHtml() {
    const view = this.editors?.[DESCRIPTION]?.instance?.view;
    return view ? ProseMirror.dom.serializeString(view.state.doc.content) : null;
  }

  /** Does the editor hold text that has not been saved yet? */
  _hasUnsavedDescription() {
    const html = this._editorHtml();
    return html !== null && html !== this._savedDescription;
  }

  /** @override - remember what the editor started with, as the editor itself writes it. */
  async activateEditor(name, options = {}, initialContent = '') {
    const instance = await super.activateEditor(name, options, initialContent);
    if (name === DESCRIPTION) this._savedDescription = this._editorHtml();
    return instance;
  }

  /** @override - anything submitted includes the editor, so after this it has nothing unsaved. */
  async _updateObject(event, formData) {
    const html = this._editorHtml();
    if (html !== null) this._savedDescription = html;
    return super._updateObject(event, formData);
  }

  /** @override */
  async _render(force = false, options = {}) {
    const rendered = this._state === this.constructor.RENDER_STATES.RENDERED;
    if (!force && rendered && this._hasUnsavedDescription()) return;
    return super._render(force, options);
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    // Anyone who can see the sheet may open an item to read it.
    html.on('click', '[data-action="item-open"]', this._onItemOpen.bind(this));
    if (!this.isEditable) return;

    html.on('click', '[data-action="attribute-add"]', this._onAttributeAdd.bind(this));
    html.on('click', '[data-action="attribute-delete"]', this._onAttributeDelete.bind(this));
    html.on('click', '[data-action="token-from-portrait"]', this._onTokenFromPortrait.bind(this));
    html.on('click', '[data-action="image-pick"]', this._onImagePick.bind(this));
    html.on('click', '[data-action="image-remove"]', this._onImageRemove.bind(this));
    html.on('click', '[data-action="item-send"]', this._onItemSend.bind(this));
    html.on('click', '[data-action="item-delete"]', this._onItemDelete.bind(this));

    // A row that was just added gets the cursor in its name field. Done here,
    // after the re-render the new row caused, because before it the row is
    // not in the page yet.
    if (this._focusAttribute) {
      html.find(`[name="system.attributes.${this._focusAttribute}.name"]`).trigger('focus');
      this._focusAttribute = null;
    }
  }

  /**
   * Add an empty attribute row. Whatever was being typed in another row has
   * already been saved: leaving a field to click the button fires its
   * `change`, and the sheet submits on change.
   * @param {Event} event
   */
  async _onAttributeAdd(event) {
    event.preventDefault();
    // The id is picked here, before the update, so it is already known when
    // the re-render lands - however quickly that happens.
    const id = foundry.utils.randomID();
    this._focusAttribute = id;
    await this.actor.addAttribute({ id });
  }

  /**
   * Delete one attribute row.
   * @param {Event} event
   */
  async _onAttributeDelete(event) {
    event.preventDefault();
    const id = event.currentTarget.closest('[data-attribute-id]')?.dataset.attributeId;
    if (id) await this.actor.removeAttribute(id);
  }

  /**
   * The empty "+" slot: pick a file for it. (A picture that is already there
   * is changed by clicking it - Foundry's own `data-edit`; the empty slot has
   * no picture to click, so it opens the file picker itself.)
   * @param {Event} event
   */
  _onImagePick(event) {
    event.preventDefault();
    const field = event.currentTarget.dataset.field;
    const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    new Picker({
      type: 'image',
      current: '',
      callback: (path) => this.actor.update({ [field]: path }),
    }).render(true);
  }

  /**
   * Remove a picture. "Removed" means back to Foundry's default for an actor
   * with no picture - the field cannot be empty - which the sheet shows as
   * the empty "+" slot again.
   * @param {Event} event
   */
  async _onImageRemove(event) {
    event.preventDefault();
    const field = event.currentTarget.dataset.field;
    const defaults = this.actor.constructor.getDefaultArtwork?.(this.actor.toObject()) ?? {};
    const fallback = field === 'img' ? defaults.img : defaults.texture?.src;
    await this.actor.update({ [field]: fallback ?? CONST.DEFAULT_TOKEN });
  }

  /**
   * Use the portrait as the token image, as Roll20's "use the character's
   * avatar" does.
   * @param {Event} event
   */
  async _onTokenFromPortrait(event) {
    event.preventDefault();
    await this.actor.update({ 'prototypeToken.texture.src': this.actor.img });
  }

  /* -------------------------------------------- */
  /*  Inventory                                   */
  /* -------------------------------------------- */

  /**
   * The item an inventory button belongs to.
   * @param {Event} event
   * @returns {Item|undefined}
   */
  _inventoryItem(event) {
    const id = event.currentTarget.closest('[data-item-id]')?.dataset.itemId;
    return this.actor.items.get(id);
  }

  /**
   * Open the item's own sheet.
   * @param {Event} event
   */
  _onItemOpen(event) {
    event.preventDefault();
    this._inventoryItem(event)?.sheet.render(true);
  }

  /**
   * Send the item to the external inventory. The sending itself is done by
   * whoever listens to the `dogmaliter.sendItem` hook - a module, say. A
   * listener that handles it returns `false`, which stops the hook; if
   * nobody does, the player is told sending is not set up yet.
   *
   *   Hooks.on('dogmaliter.sendItem', (item, actor) => { ...; return false; });
   *
   * @param {Event} event
   */
  _onItemSend(event) {
    event.preventDefault();
    const item = this._inventoryItem(event);
    if (!item) return;
    const handled = Hooks.call('dogmaliter.sendItem', item, this.actor) === false;
    if (!handled) ui.notifications.info(game.i18n.localize('DOGMALITER.Sheet.SendNotConnected'));
  }

  /**
   * Delete the item, after asking.
   * @param {Event} event
   */
  async _onItemDelete(event) {
    event.preventDefault();
    const item = this._inventoryItem(event);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('DOGMALITER.Sheet.DeleteItem') },
      content: `<p>${game.i18n.format('DOGMALITER.Sheet.DeleteItemConfirm', {
        name: foundry.utils.escapeHTML(item.name),
      })}</p>`,
    });
    if (confirmed) await item.delete();
  }
}
