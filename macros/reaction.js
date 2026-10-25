// ================================================================
//  Реакция (блок / уворот) — DogmaLiter
// ================================================================
//
//  Этот макрос запускают кнопка «Реакция» на листе персонажа и
//  game.dogmaliter.rollReaction(). Его можно перетащить на панель
//  макросов и менять как угодно — система всегда запускает макрос
//  «Реакция (блок / уворот)» этого мира.
//
//  Вернуть исходный текст: Панель мастера → Игроки → «Макросы» →
//  «Восстановить исходный».
//
//  Переменные, которые даёт Foundry:
//    actor — кто реагирует: выбранный токен, свой персонаж
//            или тот, чей лист открыт;
//    token — его токен на сцене (может не быть).
//
//  Из своего макроса:
//    game.dogmaliter.rollReaction();                       // окно, выбор реакции
//    game.dogmaliter.rollReaction({ reaction: 'block' });  // сразу выбран блок
//    game.dogmaliter.rollReaction({ reaction: 'dodge' });  // сразу выбран уворот
//
//  Бросок:  результат = кубик реакции + мультипликатор
//           (блок — 1d8, уворот — 1d7; меняются в настройках ниже)
//
//  Блок тратит заряд атрибута «Блок», уворот — «Уворот» (если у
//  атрибута есть максимум). Без зарядов реагировать так нельзя: когда
//  они кончились, они возвращаются по +1 в начале каждого хода
//  персонажа в бою — столько раз, сколько максимум.
//
//  После броска срабатывают звуковые привязки «Блок» или «Уворот»
//  (Панель мастера → Звуки), уточнение — имя персонажа.
// ================================================================


// ---------------- Настройки ----------------

// Реакции: ключ заряда в системе → название в окне и в чате, кубик.
const REACTIONS = {
  block: { label: 'Блок', die: '1d8' },
  dodge: { label: 'Уворот', die: '1d7' },
};


// ---------------- Кто реагирует ----------------

if (!actor) {
  ui.notifications.warn('Сначала выбери токен персонажа.');
  return null;
}

const charges = game.dogmaliter.charges;
const escape = (text) => foundry.utils.escapeHTML(String(text ?? ''));

// Что можно выбрать: реакции с зарядами (или без ограничения).
const options = Object.entries(REACTIONS).map(([key, { label, die }]) => {
  const charge = charges.get(actor, key);
  return { key, label, die, charge, allowed: charges.canSpend(actor, key) };
});
if (!options.some((o) => o.allowed)) {
  ui.notifications.warn('Нет зарядов ни блока, ни уворота — они восстанавливаются в начале хода.');
  return null;
}
// Что выбрано сразу: заданная реакция (scope.reaction), если по ней есть заряды, иначе первая доступная.
const preset = options.find((o) => o.key === scope?.reaction && o.allowed);
const first = preset ?? options.find((o) => o.allowed);

const optionHtml = options.map((o) => `
  <option value="${o.key}" ${o.allowed ? '' : 'disabled'} ${o === first ? 'selected' : ''}>
    ${escape(o.label)} — ${escape(o.die)}${o.charge.limited ? ` (заряды ${o.charge.value} / ${o.charge.max})` : ''}${o.allowed ? '' : ' — нет зарядов'}
  </option>`).join('');


// ---------------- Окно реакции ----------------

const choice = await foundry.applications.api.DialogV2.wait({
  window: { title: `Реакция — ${actor.name}`, icon: 'fa-solid fa-shield-halved' },
  classes: ['dogmaliter', 'dl-stat-roll-dialog'],
  content: `
    <div class="dl-stat-roll">
      <div class="form-group">
        <label>Реакция</label>
        <select name="reaction">${optionHtml}</select>
      </div>
      <div class="form-group">
        <label>Мультипликатор</label>
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
        return { reaction: form.reaction.value, multiplier: Number(form.multiplier.value) };
      },
    },
    { action: 'cancel', label: 'Отмена', icon: 'fa-solid fa-xmark' },
  ],
  rejectClose: false,
});
if (!choice || typeof choice !== 'object') return null;

if (!Number.isFinite(choice.multiplier)) {
  ui.notifications.error('Некорректный мультипликатор.');
  return null;
}
const picked = options.find((o) => o.key === choice.reaction);
if (!picked) {
  ui.notifications.error('Реакция не найдена.');
  return null;
}


// ---------------- Заряд ----------------

if (!(await charges.spend(actor, picked.key, `реакция: ${picked.label}`))) {
  ui.notifications.warn(`Нет зарядов: ${picked.label} — они восстанавливаются в начале хода.`);
  return null;
}


// ---------------- Бросок ----------------

const roll = await new Roll(picked.die).evaluate();
const die = roll.total;
const result = die + choice.multiplier;

// Наибольшее, что может выпасть, — зелёным, единица — красным.
const dieMax = roll.dice.reduce((sum, d) => sum + d.number * d.faces, 0);
let dieColor = 'color: black;';
if (die >= dieMax) dieColor = 'color: green;';
else if (die <= 1) dieColor = 'color: red;';


// ---------------- Сообщение в чат ----------------

const left = picked.charge.limited
  ? `<p><strong>Заряды (${escape(picked.label)}):</strong> ${picked.charge.value - 1} / ${picked.charge.max}</p>`
  : '';

await ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
  content: `
    <div class="dice-roll">
      <h3>${escape(picked.label)} — ${escape(actor.name)}</h3>
      <div class="dice-result">
        <div class="dice-formula">
          ${escape(picked.die)}: <span style="${dieColor}"> ${die} </span> + ${choice.multiplier}
        </div>
        <h4 class="dice-total"><span style="${dieColor}">${result}</span></h4>
      </div>
      <p><strong>Выпавший кубик (${escape(picked.die)}):</strong> ${die}</p>
      <p><strong>Мультипликатор:</strong> ${choice.multiplier}</p>
      ${left}
    </div>`,
});


// ---------------- Звуковые привязки ----------------

const summary = { reaction: picked.key, label: picked.label, formula: picked.die, die, multiplier: choice.multiplier, result };
await game.dogmaliter.fireTrigger(picked.key, { values: [actor.name], actor, token, data: summary });
if (die <= 1) await game.dogmaliter.fireTrigger('nat1', { values: [picked.label], actor, token, data: summary });

return summary;
