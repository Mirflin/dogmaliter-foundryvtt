export const DOGMALITER = {};

/**
 * Resources: numbers with a max under `system.<key>` (template.json), which
 * is what a token bar can show. Unlike the free-form attributes, each one can
 * be switched off for an actor (`system.<key>.enabled`): it then leaves the
 * sheet, the GM panel and the token's bars (module/documents/token.mjs).
 */
DOGMALITER.resources = {
  health: { label: 'DOGMALITER.Resource.health', color: '#c8463f' },
  mana: { label: 'DOGMALITER.Resource.mana', color: '#3f7ccc' },
  ap: { label: 'DOGMALITER.Resource.ap', color: '#c99a2e' },
};

/**
 * The attributes a new actor starts with. Only the first value: the GM
 * changes the list on the GM panel (the `defaultAttributes` setting).
 */
DOGMALITER.defaultAttributes = [
  { name: 'Сила', value: '0', max: '' },
  { name: 'Ловкость', value: '0', max: '' },
  { name: 'Интеллект', value: '0', max: '' },
  { name: 'Выносливость', value: '0', max: '' },
  { name: 'Заметность', value: '0', max: '' },
  { name: 'Ударная сила', value: '0', max: '' },
  { name: 'Фехтование', value: '0', max: '' },
  { name: 'Владение', value: '0', max: '' },
  { name: 'Меткость', value: '0', max: '' },
  { name: 'Класс брони', value: '0', max: '' },
  { name: 'Очки движения', value: '0', max: '' },
  { name: 'Время путешествия', value: '0', max: '' },
  { name: 'Регенерация', value: '0', max: '' },
  { name: 'Шанс крита', value: '20', max: '' },
];

/**
 * The stat check (module/rolls/stat-roll.mjs). Attributes are found by the
 * name shown on the sheet, the same way `actor.findAttribute` does.
 */
DOGMALITER.statRoll = {
  /** Attributes offered as the attack type, not as a stat. */
  attackNames: ['Ударная сила', 'Фехтование', 'Владение', 'Меткость'],
  /** Attributes left out of the stat list altogether. */
  hiddenNames: ['Заметность', 'Класс брони', 'Очки движения', 'Время путешествия', 'Регенерация', 'Шанс крита'],
  /** The attack type that can crit. */
  fencingName: 'Фехтование',
  /** The attribute holding the crit threshold: a d20 at or above it crits. */
  critName: 'Шанс крита',
  /** The threshold a crit, or any other attack, resets it to. */
  critReset: 20,
  /** Each fencing attack that does not crit lowers the threshold by one, down to this. */
  critFloor: 13,
  /** A distance roll at or above this is "middle distance"... */
  distanceMid: 13,
  /** ...at or above this "near distance"; below it the attack misses. */
  distanceNear: 10,
};

/**
 * What a sound binding can be tied to (module/audio/triggers.mjs). `filter`
 * is the label of the binding's "which one" field, for triggers that have
 * one: the attribute, the attack type, the character. Empty there = any.
 */
DOGMALITER.triggers = {
  manual: { label: 'DOGMALITER.Trigger.manual', filter: 'DOGMALITER.Trigger.FilterButton' },
  statRoll: { label: 'DOGMALITER.Trigger.statRoll', filter: 'DOGMALITER.Trigger.FilterAttribute' },
  nat20: { label: 'DOGMALITER.Trigger.nat20', filter: 'DOGMALITER.Trigger.FilterAttribute' },
  nat1: { label: 'DOGMALITER.Trigger.nat1', filter: 'DOGMALITER.Trigger.FilterAttribute' },
  attack: { label: 'DOGMALITER.Trigger.attack', filter: 'DOGMALITER.Trigger.FilterAttack' },
  attackMiss: { label: 'DOGMALITER.Trigger.attackMiss', filter: 'DOGMALITER.Trigger.FilterAttack' },
  attackNear: { label: 'DOGMALITER.Trigger.attackNear', filter: 'DOGMALITER.Trigger.FilterAttack' },
  attackMid: { label: 'DOGMALITER.Trigger.attackMid', filter: 'DOGMALITER.Trigger.FilterAttack' },
  crit: { label: 'DOGMALITER.Trigger.crit', filter: 'DOGMALITER.Trigger.FilterAttack' },
  combatStart: { label: 'DOGMALITER.Trigger.combatStart' },
  combatTurn: { label: 'DOGMALITER.Trigger.combatTurn', filter: 'DOGMALITER.Trigger.FilterActor' },
  combatEnd: { label: 'DOGMALITER.Trigger.combatEnd' },
  custom: { label: 'DOGMALITER.Trigger.custom', filter: 'DOGMALITER.Trigger.FilterName' },
};

/** Who hears a binding's sound. */
DOGMALITER.audiences = {
  all: 'DOGMALITER.Audience.all',
  self: 'DOGMALITER.Audience.self',
  gm: 'DOGMALITER.Audience.gm',
};
