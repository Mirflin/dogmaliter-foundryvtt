/** Foundry v13+ keeps the client class under `foundry.documents`; v12 only has the global. */
const BaseTokenDocument = foundry.documents?.TokenDocument ?? TokenDocument;

/**
 * Extend the base TokenDocument: a resource the actor has switched off
 * (`system.mana.enabled = false`, say) shows no bar, even if one of the
 * token's bars is set to it. Switching it back on brings the bar back.
 * @extends {TokenDocument}
 */
export class DogmaLiterTokenDocument extends BaseTokenDocument {
  /** @override */
  getBarAttribute(barName, options) {
    const bar = super.getBarAttribute(barName, options);
    const key = bar?.attribute?.split('.')[0];
    if (key in CONFIG.DOGMALITER.resources && this.actor?.system?.[key]?.enabled === false) return null;
    return bar;
  }

  /**
   * @override - an empty bar with a max of 0, not just none: the bars of a
   * token on the canvas animate to these numbers, and one left at its old max
   * would stay drawn.
   */
  _prepareBars() {
    super._prepareBars?.();
    for (const key of ['bar1', 'bar2']) {
      if (this[key] && this[key].type === null) this[key].max = 0;
    }
  }
}
