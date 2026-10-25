/**
 * Define a set of template paths to pre-load
 * Pre-loaded templates are compiled and cached for fast access when rendering
 * @return {Promise}
 */
export const preloadHandlebarsTemplates = async function () {
  // Foundry v13+ moved loadTemplates under foundry.applications.handlebars;
  // v12 only has the global.
  const load = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  return load([
    // Item partials
    'systems/dogmaliter/templates/item/parts/item-effects.hbs',
    // GM panel partials
    'systems/dogmaliter/templates/apps/gm-panel/actor-card.hbs',
    // The selected token's quick bars, drawn on the first selection
    'systems/dogmaliter/templates/hud/token-resources.hbs',
    'systems/dogmaliter/templates/hud/token-charges.hbs',
    'systems/dogmaliter/templates/hud/token-skills.hbs',
  ]);
};
