// ================================================================
//  Бросок характеристики — DogmaLiter
// ================================================================
//
//  Этот макрос запускают кнопка «Бросок» на листе персонажа и
//  game.dogmaliter.rollStat(). Его можно перетащить на панель
//  макросов и менять как угодно — система всегда запускает макрос
//  «Бросок характеристики» этого мира.
//
//  Вернуть исходный текст: Панель мастера → Игроки →
//  «Бросок характеристики» → «Восстановить исходный».
//
//  Переменные, которые даёт Foundry:
//    actor — кто бросает: выбранный токен, свой персонаж
//            или тот, чей лист открыт;
//    token — его токен на сцене (может не быть).
//
//  Формула:  результат = ⌊ (мультипликатор + d20) / 10 × характеристика ⌋
//
//  С галочкой «Атака» второй d20 + мультипликатор попадания решает
//  дистанцию: 13+ средняя, 10+ ближняя, меньше — промах.
//  Фехтование критует, когда d20 характеристики не меньше «Шанса
//  крита»: результат ×2, шанс возвращается к 20. Каждая атака
//  фехтованием без крита снижает шанс на 1 (не ниже 13). Любая другая
//  атака возвращает шанс к 20.
//
//  Каждая атака, которая не промахнулась, тратит заряд атрибута
//  «Атака» (если у него есть максимум); промах заряд не тратит.
//  Без зарядов атаковать нельзя: когда они кончились, они
//  возвращаются по +1 в начале каждого хода персонажа в бою — столько
//  раз, сколько максимум. Это делает система (game.dogmaliter.charges).
//
//  После броска срабатывают звуковые привязки (Панель мастера →
//  Звуки): attack, attackMiss / attackNear / attackMid, statRoll,
//  nat20, nat1, crit.
// ================================================================


// ---------------- Настройки ----------------

// Характеристики, которые идут в «Тип атаки», а не в список характеристик.
const ATTACK_NAMES = ['Ударная сила', 'Фехтование', 'Владение', 'Меткость', 'Рукопашный бой'];

// Характеристики, которых нет в списке вовсе.
const HIDDEN_NAMES = [
  'Заметность', 'Класс брони', 'Очки движения', 'Время путешествия', 'Регенерация', 'Шанс крита',
  'Атака', 'Блок', 'Уворот', // заряды
];

const FENCING = 'Фехтование';  // атака, которая может критовать
const CRIT = 'Шанс крита';     // атрибут с порогом крита
const CRIT_RESET = 20;         // к чему порог возвращается
const CRIT_FLOOR = 13;         // ниже этого порог не опускается
const DISTANCE_MID = 13;       // дистанция ≥ 13 — средняя
const DISTANCE_NEAR = 10;      // дистанция ≥ 10 — ближняя, иначе промах


// ---------------- Кто бросает ----------------

if (!actor) {
  ui.notifications.warn('Сначала выбери токен персонажа.');
  return null;
}

// Сравнение названий без учёта регистра и пробелов по краям.
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const inList = (names) => (attribute) => names.some((name) => same(name, attribute.name));

const attributes = actor.attributeList;
const stats = attributes.filter((a) => !inList(ATTACK_NAMES)(a) && !inList(HIDDEN_NAMES)(a));
const attacks = attributes.filter(inList(ATTACK_NAMES));

if (!stats.length) {
  ui.notifications.error('У персонажа нет характеристик.');
  return null;
}

// Заряды атаки. Нет атрибута «Атака» с максимумом — атаки без ограничений.
const charges = game.dogmaliter.charges;
const attackCharge = charges.get(actor, 'attack');
const canAttack = attacks.length > 0 && charges.canSpend(actor, 'attack');

const escape = (text) => foundry.utils.escapeHTML(String(text ?? ''));
const option = (a) => `<option value="${a.id}">${escape(a.name)} (${escape(a.value)})</option>`;


// ---------------- Окно броска ----------------
// Поля атаки бледные, пока не отмечена «Атака» (стиль .dl-stat-roll в системе).

const choice = await foundry.applications.api.DialogV2.wait({
  window: { title: `Проверка характеристики — ${actor.name}`, icon: 'fa-solid fa-dice-d20' },
  classes: ['dogmaliter', 'dl-stat-roll-dialog'],
  content: `
    <div class="dl-stat-roll">
      <div class="form-group">
        <label class="dl-stat-roll-check">
          <input type="checkbox" name="isAttack" ${canAttack ? '' : 'disabled'}> Атака
          ${attackCharge.limited ? `<span class="hint">(заряды ${attackCharge.value} / ${attackCharge.max})</span>` : ''}
        </label>
        ${attacks.length ? '' : '<p class="hint">У персонажа нет характеристик атаки.</p>'}
        ${attacks.length && !canAttack ? '<p class="hint">Нет зарядов атаки — они восстанавливаются в начале хода.</p>' : ''}
      </div>
      <div class="form-group dl-stat-roll-attack">
        <label>Тип атаки</label>
        <select name="attackType">${attacks.map(option).join('')}</select>
      </div>
      <div class="form-group dl-stat-roll-attack">
        <label>Мультипликатор попадания</label>
        <input type="number" name="attackMultiplier" value="0" step="any">
      </div>
      <div class="form-group">
        <label>Характеристика</label>
        <select name="ability">${stats.map(option).join('')}</select>
      </div>
      <div class="form-group">
        <label>Мультипликатор характеристики</label>
        <input type="number" name="multiplier" value="0" step="any" autofocus>
      </div>
    </div>`,
  buttons: [
    {
      action: 'roll',
      label: 'Бросить',
      icon: 'fa-solid fa-dice-d20',
      default: true,
      callback: (event, button) => {
        const form = button.form.elements;
        return {
          isAttack: !!form.isAttack?.checked,
          attackId: form.attackType?.value ?? '',
          attackMultiplier: Number(form.attackMultiplier?.value),
          abilityId: form.ability.value,
          multiplier: Number(form.multiplier.value),
        };
      },
    },
    { action: 'cancel', label: 'Отмена', icon: 'fa-solid fa-xmark' },
  ],
  rejectClose: false,
});
if (!choice || typeof choice !== 'object') return null;


// ---------------- Проверки ----------------

if (!Number.isFinite(choice.multiplier) || (choice.isAttack && !Number.isFinite(choice.attackMultiplier))) {
  ui.notifications.error('Некорректный мультипликатор.');
  return null;
}
const ability = stats.find((a) => a.id === choice.abilityId);
if (!ability) {
  ui.notifications.error('Характеристика не найдена.');
  return null;
}
const attack = choice.isAttack ? attacks.find((a) => a.id === choice.attackId) : null;
if (choice.isAttack && !attack) {
  ui.notifications.error('Тип атаки не найден.');
  return null;
}


// Без зарядов атаковать нельзя (проверка ещё раз: окно могло висеть долго).
if (attack && !charges.canSpend(actor, 'attack')) {
  ui.notifications.warn('Нет зарядов атаки — они восстанавливаются в начале хода.');
  return null;
}


// ---------------- Бросок ----------------

// Порог крита до броска. Если атрибута нет или в нём не число — 20.
const critRaw = actor.findAttribute(CRIT)?.value ?? '';
const critThreshold = critRaw !== '' && Number.isFinite(Number(critRaw)) ? Number(critRaw) : CRIT_RESET;
const isFencing = !!attack && same(attack.name, FENCING);

// Дистанция (только для атаки).
let distance = null; // 'miss' | 'near' | 'mid'
if (attack) {
  if (!isFencing) await actor.updateAttribute(CRIT, { value: CRIT_RESET });
  const distanceRoll = await new Roll('1d20').evaluate();
  const distanceTotal = distanceRoll.total + choice.attackMultiplier;
  if (distanceTotal >= DISTANCE_MID) distance = 'mid';
  else if (distanceTotal >= DISTANCE_NEAR) distance = 'near';
  else distance = 'miss';

  // Заряд атаки: тратится, только если не промах.
  if (distance === 'miss') game.dogmaliter.actionLog.note(actor, `Атака (${attack.name.trim()}): промах — заряд не потрачен`);
  else await charges.spend(actor, 'attack', `атака: ${attack.name.trim()}`);
}
const chargesLeft = attack && distance !== 'miss' ? attackCharge.value - 1 : attackCharge.value;

// Сама характеристика.
const statValue = Number(ability.value);
const roll = await new Roll('1d20').evaluate();
const die = roll.total;
const isCrit = isFencing && die >= critThreshold;
let result = Math.floor(((choice.multiplier + die) / 10) * statValue);
if (isCrit) result *= 2;

// Новый порог крита.
if (isCrit) {
  await actor.updateAttribute(CRIT, { value: CRIT_RESET });
} else if (isFencing && critThreshold - 1 >= CRIT_FLOOR) {
  await actor.updateAttribute(CRIT, { value: critThreshold - 1 });
}


// ---------------- Сообщение в чат ----------------

const DISTANCE_TEXT = { miss: 'Не попал', near: 'Ближняя дистанция', mid: 'Средняя дистанция' };
const DISTANCE_COLOR = { miss: 'color: red;', near: 'color: darkblue;', mid: 'color: darkgreen;' };

let dieColor = 'color: black;';
if (die >= 20 || isCrit) dieColor = 'color: green;';
else if (die <= 1) dieColor = 'color: red;';

const attackLines = attack
  ? `
    <p><strong>Атака:</strong> ${escape(attack.name)}</p>
    <p><strong>Мультипликатор атаки:</strong> ${choice.attackMultiplier}</p>
    <p><strong>Дистанция:</strong> <span style="${DISTANCE_COLOR[distance]}">${DISTANCE_TEXT[distance]}</span></p>
    ${attackCharge.limited ? `<p><strong>Заряды атаки:</strong> ${chargesLeft} / ${attackCharge.max}${distance === 'miss' ? ' (промах — заряд не потрачен)' : ''}</p>` : ''}`
  : '';
const critLine = isCrit ? `<p><strong>${escape(FENCING)}: </strong><strong style="color: green;">КРИТ</strong></p>` : '';

await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
  content: `
    <div class="dice-roll">
      <h3>${escape(ability.name)} — ${escape(actor.name)}</h3>
      ${attackLines}
      ${critLine}
      <div class="dice-result">
        <div class="dice-formula">
          ( (<span style="${dieColor}"> ${die} </span> + ${choice.multiplier} ) / 10 ) × ${statValue}
        </div>
        <h4 class="dice-total"><span style="${dieColor}">${result}</span></h4>
      </div>
      <p><strong>Характеристика:</strong> ${escape(ability.name)} (${statValue})</p>
      <p><strong>Выпавший кубик характеристики:</strong> ${die}</p>
      <p><strong>Мультипликатор характеристики:</strong> ${choice.multiplier}</p>
    </div>`,
});


// ---------------- Звуковые привязки ----------------

const summary = {
  abilityName: ability.name,
  statValue,
  multiplier: choice.multiplier,
  die,
  result,
  isAttack: !!attack,
  attackName: attack?.name ?? null,
  attackMultiplier: attack ? choice.attackMultiplier : null,
  distance,
  isCrit,
};
const fire = (trigger, values) => game.dogmaliter.fireTrigger(trigger, { values, actor, token, data: summary });

if (attack) {
  await fire('attack', [attack.name]);
  await fire({ miss: 'attackMiss', near: 'attackNear', mid: 'attackMid' }[distance], [attack.name]);
}
await fire('statRoll', [ability.name]);
if (die >= 20) await fire('nat20', [ability.name]);
if (die <= 1) await fire('nat1', [ability.name]);
if (isCrit) await fire('crit', [attack.name]);

return summary;
