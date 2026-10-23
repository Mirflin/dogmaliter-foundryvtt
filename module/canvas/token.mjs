/**
 * The token on the canvas, with its own resource bars: every resource of the
 * actor (health, mana, AP - CONFIG.DOGMALITER.resources) that is switched on
 * gets a bar, stacked above the token, in the resource's colour, health on
 * top. Foundry's two bars are not drawn.
 *
 * Who sees each bar, and whether its "value / max" is written on it, is set
 * per actor and per resource on the sheet (`system.health.showBar`,
 * `system.health.showValue`): 'none' - nobody, 'owner' - the token's owners
 * and the GM, 'all' - everyone. The token's own "display bars" setting is not
 * used. A token the GM has hidden shows players nothing anyway.
 *
 * The elevation tooltip moves up above the bars.
 */

const BaseToken = foundry.canvas?.placeables?.Token ?? Token;
const PreciseTextImpl = foundry.canvas?.containers?.PreciseText ?? PreciseText;

export class DogmaLiterToken extends BaseToken {
  /** Height of the bars above the token, in canvas pixels. */
  _resourceBarsHeight = 0;

  /** May this user see something shown to `mode` ('none' | 'owner' | 'all')? */
  _canSeeResource(mode) {
    if (mode === 'all') return true;
    return mode === 'owner' && (game.user.isGM || this.document.isOwner);
  }

  /** The resources to draw, top to bottom, with `number`: write "value / max" on it. */
  _shownResources() {
    if (!this.actor) return [];
    return (this.actor.resourceList ?? [])
      .filter((resource) => resource.enabled && resource.max > 0 && this._canSeeResource(resource.showBar))
      .map((resource) => ({ ...resource, number: this._canSeeResource(resource.showValue) }));
  }

  /** @override */
  drawBars() {
    const bars = this.bars;
    if (!bars) return;
    bars.bar1.visible = bars.bar2.visible = false;
    const layer = (bars.dogmaliter ??= bars.addChild(new PIXI.Container()));
    for (const child of layer.removeChildren()) child.destroy({ children: true });

    const resources = this._shownResources();
    const s = canvas.dimensions.uiScale ?? 1;
    const { width } = this.document.getSize?.() ?? { width: this.w };
    const height = Math.round(11 * s * (this.document.height >= 2 ? 1.3 : 1));
    const gap = Math.max(1, Math.round(2 * s));
    const style = this._getTextStyle().clone();
    style.fontSize = Math.max(8, Math.round((height * 0.85) / s));
    style.strokeThickness = 3;
    style.wordWrap = false;

    resources.forEach((resource, index) => {
      const y = -(resources.length - index) * (height + gap);
      const color = Color.from(resource.color);
      const pct = Math.clamp(resource.value / resource.max, 0, 1);
      const bar = new PIXI.Graphics();
      bar.lineStyle(s, 0x000000, 1.0);
      bar.beginFill(0x000000, 0.6).drawRoundedRect(0, 0, width, height, 3 * s);
      if (pct > 0) bar.beginFill(color, 1.0).drawRoundedRect(0, 0, pct * width, height, 2 * s);
      bar.endFill();
      bar.position.set(0, y);
      layer.addChild(bar);
      if (!resource.number) return;
      const text = new PreciseTextImpl(`${resource.value} / ${resource.max}`, style);
      text.anchor.set(0.5, 0.5);
      text.scale.set(s, s);
      text.position.set(width / 2, y + height / 2);
      layer.addChild(text);
    });

    this._resourceBarsHeight = resources.length * (height + gap);
    this._placeTooltip();
  }

  /** Put the elevation tooltip above the bars. */
  _placeTooltip() {
    if (!this.tooltip) return;
    const offset = CONFIG.Canvas.objectBorderThickness * 0.75 * (canvas.dimensions.uiScale ?? 1);
    this.tooltip.y = -offset - this._resourceBarsHeight;
    if (this.levelIndicator) this.levelIndicator.y = this.tooltip.y - (this.tooltip.text ? this.tooltip.height : 0);
  }

  /** @override */
  _refreshSize() {
    super._refreshSize();
    this._placeTooltip();
  }

  /** @override */
  _refreshTooltip() {
    super._refreshTooltip();
    this._placeTooltip();
  }

  /** @override - which bars show is decided per resource, not by the token's display mode. */
  _refreshState() {
    super._refreshState();
    if (this.bars) this.bars.visible = !this.document.isSecret && !!this.actor;
  }
}

/** Call at `init`. */
export function registerTokenBars() {
  CONFIG.Token.objectClass = DogmaLiterToken;

  // Redraw the bars when the actor's numbers or bar settings change.
  const redraw = (actor) => {
    for (const token of actor?.getActiveTokens?.() ?? []) token.renderFlags.set({ refreshBars: true });
  };
  Hooks.on('updateActor', (actor) => redraw(actor));
  Hooks.on('updateToken', (tokenDoc, changes) => {
    if ('delta' in changes || 'actorLink' in changes) tokenDoc.object?.renderFlags.set({ refreshBars: true });
  });
  // Ownership decides 'owner' bars: redraw everything when a user's role or a token's actor changes hands.
  Hooks.on('updateUser', () => {
    for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ refreshBars: true });
  });
}
