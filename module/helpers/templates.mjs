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
  ]);
};
