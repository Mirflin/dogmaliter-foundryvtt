# DogmaLiter System

Foundry VTT v12-v14. The actor sheet is a Roll20-style character sheet (see below); the rest is the Foundry boilerplate this project started from.

## Install

1. Copy this folder into your Foundry data folder as `Data/systems/dogmaliter` (the folder name must match the `id` in `system.json`). Foundry shows the data folder under **Configuration -> User Data Path**; on Windows it is `%localappdata%\FoundryVTT\Data` by default.
2. Restart Foundry, open **Game Systems**: "DogmaLiter" is listed. Create a world with it.

`css/dogmaliter.css` is already built. To change styles, edit `src/scss/` and rebuild: `npm install` once, then `npm run build`.

## Actor sheet (Roll20 style)

Used for both actor types (character, NPC). Dark gray with a dark cyan accent. Plain fields save themselves when you leave them - there is no save button.

- **Main**
  - Portrait and token image: click either to pick a file; "Use portrait" copies the portrait onto the token. The token image is the actor's *prototype* token: tokens placed from now on use it, tokens already on a scene keep theirs.
  - Description in a Word-like editor (Foundry's ProseMirror), always open: fonts, font size and colour, bold/italic/underline, alignment, headings, lists, **tables** (insert, add/remove rows and columns, merge cells) and **images** (the image button opens the file picker; images can also be dragged in).
  - Saving the description: **Ctrl+S** or the disk button in the editor's toolbar. It is also saved whenever any other field on the sheet saves, and when the sheet is closed. While it has unsaved text, the sheet does not redraw itself from outside changes, so typing is never lost.
- **Attributes** - "Add attribute" adds a row: name, current value, max (max may stay empty); the bin deletes it.
  In rolls: `@Name` is the current value, `@Name_max` the max - `1d20 + @Strength`, `@Hit_Points_max` (Roll20's `@{Hit Points|max}`). Spaces become `_`. Foundry only reads Latin letters, digits, `_` and `-` after `@`, so a name in another alphabet has no `@` shortcut (shown as "-").

### Pictures

Each slot shows the picture - click it to change it, the x in its corner removes it - or, with no picture yet, a dashed empty slot with a "+" that opens the file picker. "Removed" puts back Foundry's default silhouette, which the sheet shows as the empty slot.

### Attributes in macros

In a **Script** macro Foundry already provides `actor` (the selected token's actor, or your assigned character) and `character` (your assigned character). Attributes are found by the name shown on the sheet - any alphabet, not case-sensitive:

```js
// Show the selected token's HP in chat.
if (!actor) return ui.notifications.warn('Select a token first.');
const hp = actor.findAttribute('Hit Points');          // {name, value, max, ...} or null
if (!hp) return ui.notifications.warn(`${actor.name} has no "Hit Points".`);
ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }),
  content: `HP: ${hp.value} / ${hp.max}`,
});
```

```js
// Roll with attributes: @Name is the current value, @Name_max the max.
await new Roll('1d20 + @Strength', actor.getRollData())
  .toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: 'Strength check' });
```

```js
// Take 5 damage, not below 0. Only the fields you pass change.
const hp = actor.findAttribute('Hit Points');
await actor.updateAttribute('Hit Points', { value: Math.max(0, Number(hp.value) - 5) });
```

```js
// Every selected token at once, and every attribute of each.
for (const token of canvas.tokens.controlled) {
  const lines = token.actor.attributeList.map((a) => `${a.name}: ${a.value}${a.max !== '' ? ' / ' + a.max : ''}`);
  console.log(token.name, lines);
}
```

- `actor.findAttribute(name)` - one attribute `{id, name, value, max, key}`, or `null`.
- `actor.updateAttribute(name, { value, max, name })` - change the given fields; creates the attribute if it does not exist.
- `actor.attributeList` - all attributes, in sheet order.
- `actor.getRollData()` - what `@...` in a roll formula reads.

Values typed on the sheet are text: wrap them in `Number(...)` before doing arithmetic, as above.

### Fonts (Russian + English)

The editor's Font menu offers 15 families that all have both Cyrillic and Latin: Roboto, Open Sans, PT Sans, Montserrat, Inter, PT Serif, Lora, Merriweather, Playfair Display, Oswald, Russo One, Roboto Mono, JetBrains Mono, Caveat, Marck Script - plus the system fonts Arial, Courier, Times. Foundry's own Latin-only fonts (Amiri, Bruno Ace, Modesto Condensed, Signika) are taken out of that menu.

They load from **Google Fonts** at world start, so they need internet; offline they fall back to the default font. The list is in `module/helpers/fonts.mjs` - add a line there to add a font (pick one that lists Cyrillic on fonts.google.com).

## Health, Mana, AP and token bars

Every actor has three resources besides its attributes: **Health**, **Mana** and **AP** (action points) - numbers with a max, in `system.health`, `system.mana`, `system.ap`. They sit under the sheet's header on every page.

- The checkbox by a resource's name switches it on or off for this actor (no mana for a warrior, say). Switched off, it leaves the sheet, the GM panel and the token.
- Every resource that is on gets its own bar **above the token**, stacked: health, mana, AP. Foundry's own two bars are not drawn, and the token's "display bars" setting is not used.
- Under each resource, two selects - per character: who sees the bar (nobody / owner and GM / everyone) and who sees the number "current / max" on it (the same three). New actors: owner and GM for both. Players never see anything of a token the GM has hidden.
- The token HUD still edits the resources on the token's bar 1 / bar 2 (health and mana for new actors; change them in the token configuration).
- In rolls: `@health.value`, `@mana.max`, `@ap.value`.

Worlds from before this had `system.power`: the GM's client moves it into `system.mana` once, and every token bar that showed `power` shows `mana`.

## Attributes of new actors

A new character or NPC starts with the attributes of a list the GM edits on the panel - out of the box: Сила, Ловкость, Интеллект, Выносливость, Заметность, the attack types, Класс брони, Очки движения, Время путешествия, Регенерация, Шанс крита (20) (Players -> "Attributes of new actors"). "Add the missing ones to everyone" gives every existing actor those it lacks, by name, without changing the ones it has. A copied or imported actor keeps its own attributes. The list the system starts with is in `CONFIG.DOGMALITER.defaultAttributes` (`module/helpers/config.mjs`).

## Stat check and reaction

Two **macros of the world the GM can edit in Foundry**, in the Macro Directory, their text, comments and messages in Russian:

- **"Бросок характеристики"** (`macros/stat-roll.js`) - the sheet's **Roll** button, `game.dogmaliter.rollStat()`:
  - pick a stat and its multiplier: `floor(((multiplier + d20) / 10) * stat)`;
  - tick **Attack** for an attack: the attack type (Ударная сила, Фехтование, Владение, Меткость, Рукопашный бой) and the hit multiplier; a second d20 + the hit multiplier sets the distance: 13+ middle, 10+ near, below that a miss. An attack that does not miss spends an **Атака** charge (below) - a miss spends none; with none left "Attack" is greyed out;
  - **Фехтование** crits when the stat d20 reaches **Шанс крита**: the result doubles and the threshold goes back to 20; every fencing attack that does not crit lowers it by 1, down to 13; any other attack puts it back to 20.
- **"Реакция (блок / уворот)"** (`macros/reaction.js`) - the sheet's **Reaction** button, `game.dogmaliter.rollReaction()`: pick block or dodge and a multiplier; block rolls `1d8 + multiplier`, dodge `1d7 + multiplier` (the dice are in `REACTIONS` at the top of the macro); spends a **Блок** or **Уворот** charge (one with none left can't be picked).

  From a macro of your own: `game.dogmaliter.rollReaction();` (the selected token, or your character), `game.dogmaliter.rollReaction({ reaction: 'block' })` or `{ reaction: 'dodge' }` to have it picked at once. Or drag the world's "Реакция (блок / уворот)" macro onto the hotbar.

The lists of names (attack types, attributes left out of the stat list) and the numbers are constants at the top of each macro. Players may run them (Limited permission), not change them.

The active GM's client creates a missing one, and brings an **unedited** one up to date with the system's file when the system changes (the macro remembers a hash of the text it was given); an edited one stays as it is. GM panel -> Players -> "Roll macros": open each, or put the system's text back. With no macro in the world (deleted), the file's text runs as it is.

## Charges: Атака, Блок, Уворот

Ordinary attributes with a value and a max (new actors: 2 / 2; the list of new actors' attributes has them). **Charges are spent only while the character is in a started combat** - out of combat attacks, reactions and skills cost no charge. An attack that hits spends an Атака charge (a miss does not), a block a Блок one, a dodge an Уворот one; with none left the action is refused.

Once a charge runs out (value 0), it recovers: **+1 at the start of each of the character's combat turns**, until it has been +1 as many times as its max - charges spent meanwhile do not stop it; if it ends with none left, it starts over. Stepping the tracker back is not a new turn. A charge that has not run out does not recover. An actor without the attribute, or without its max, has no limit. In code: `game.dogmaliter.charges` (`get`, `canSpend`, `spend`, `recover`).

## Skills

Items of type **skill**: name, **picture** (the GM picks it - the picture button in the form), description, **cost** (any of Health, Mana, AP, an Атака / Блок / Уворот charge, or an attribute by name - each with an amount), **requirements** (an attribute compared with a number: ≥, >, ≤, <, =, ≠), **tags**, a **cooldown** (turns), a **sound** played for everyone on use (file, volume; ▶ in the form plays it only for the GM), and an optional **roll**: a formula (`1d20`, `1d8`, `2d6 + @Strength` - attributes with Latin names), with **"Ask for a multiplier"** a window asks for one before the roll, as the attack does, and adds it.

- **The skill library** - its own window, the book button in the Token controls (GM only; a key can be set under Configure Controls -> DogmaLiter). Left: **Create skill**, **Create folder**, and the folders - all skills, each folder (rename, delete: its skills move to "No folder", they are not deleted), skills in no folder; a skill card dragged onto a folder moves there. Top: search (name, tag, description), filter by tag and by what the skill costs. Main: the skills as cards - **Give** (pick the actor - players' characters first, with their players' names), **Edit**, **Delete**; a card drags onto a character sheet.
- **Create / Edit** open the skill in an editor window of its own: picture, name, description, tags, folder, roll, cooldown, sound, cost, requirements. A new skill made while a folder is shown goes into that folder.
- They are kept in the world compendium **"Навыки"** (`world.dogmaliter-skills`, created with the first skill or folder); it can also be opened in the Compendium sidebar and dragged from there.
- A character gets a copy; one they already have (same source or name) is not added twice. **Editing a skill in the compendium changes every copy characters have** (by its source; a copy with no source, by the skill's old name) - a running cooldown stays.
- **Cooldown** works in combat only: a skill used by a character in a started combat can't be used again for that many of their turns (counted down at the start of each of their turns); the combat's end clears it. Out of combat skills have no cooldown - and charges in their cost are not spent.
- **Character sheet -> Skills**: a search (name, tag, description) and a tag filter; each skill with its tags, roll, (red: not enough) and requirements (green met, red not, with the current value); **Use** checks them, asks for the multiplier if the skill says so (closing that window costs nothing), pays the cost, rolls (the roll is in the chat card, with dice sound / 3D dice), (charges through the charge rules: reaching 0 starts recovery), posts a chat card and fires the sound trigger "Skill used" (narrowed by the skill's name or a tag). Every payment is in the action log as "skill: <name>". The skill's own sheet shows the cost, requirements and tags (they are edited on the GM panel) and has the description editor.
- In code: `game.dogmaliter.skills` (`pack`, `allSkills`, `check`, `useSkill`, `giveSkill`).

## Selected token's quick bars

While you have a token selected that you own:

- **above the macro hotbar** - its health, mana and AP (those switched on): -/+ change by 1 (Shift: 5), the number field takes `12` or `-3` / `+5` (within 0 and the max), the second field is the max;
- **bottom left, above the charges** - its skills as square pictures, two to a row, in a tall panel of a fixed height (twelve rows, at most half the screen; there even with no skills), scrolling when there are many: the name (and cost) on hover, the turns of cooldown on the picture, greyed when it can't be used now; a click uses it;
- **bottom left, above the players list** - its charges Атака, Блок, Уворот: -/+ by 1 (reaching 0 starts recovery), "↻ 1 / 2" while recovering (+1 so far / as many as the max). The GM also gets **↻ +1**: one recovery step, for a fight without the combat tracker.

With several tokens selected they show the first and how many more there are.

## GM panel

The sliders button in the Token controls (GM only), or a key you assign under Configure Controls -> DogmaLiter.

- **Scene** - a sub-menu instead of one long page:
  - *Scenes* - every scene, with a search: view it or activate it.
  - *Controls* - the viewed scene: pause, pull every player here; global illumination, token vision, darkness (slider and Day / Dusk / Night), fog reset, weather.
  - *Lights*, *Doors*, *Sounds* - every light source, door and ambient sound of the scene, with a search by name or by the region it stands in, "show on map", and on/off (open / close / lock for doors) one by one or all at once. Doors have no names: they are numbered and labelled with the regions they are in. "Open all" leaves locked doors locked.
- **Players** - each player: their character (picking one there also makes them its owner - a player who owns no actor can change nothing, and the panel says so), online or not, which scene they are looking at (with "pull here" if it is another one), their character's resources, attributes and active effects. Then every other token on the scene, with a show/hide button. What the cards show each GM picks for themselves at the top of the page ("What to show"): which resource bars, and which attributes - every attribute name the list of new actors or any actor has, as switches. Until some are picked, the attributes with a max are shown. Values can be edited in place: `12` sets it, `-3` / `+5` changes it by that much (a resource stays within 0 and its max). Also the list of attributes new actors start with.
- **Regions** - draw a new region (rectangle, ellipse, polygon: the buttons switch the map to that tool); every region of the scene: rename, recolour, show it on the map (selects it for editing), switch it off, configure, delete, see which tokens are inside. Each region's behaviors: add one of any type (anything but footsteps opens its configuration), switch on/off, configure, delete. Footsteps are set up right in the list: sound, volume, step interval, range.
- **Sounds** - quick-sound buttons, sound bindings, footstep regions (below).
- **Log** - every change to attributes, health / mana / AP and charges, newest first: when, whose, who made it, before -> after (+/- for numbers), and why when the system knows (a charge spent on an attack, recovery at a turn start or by the GM's button, changed by hand on the quick bars); plus lines the macros add ("miss - no charge spent"). Search, a filter by kind, "Clear". The last 500 entries are kept (the `actionLog` world setting, written by the active GM's client). Macros can add a line: `game.dogmaliter.actionLog.note(actor, 'текст')`.

## Sound bindings

On the panel's Sounds page: "when this happens, play this sound and/or run this macro".

| Event | Narrowed by |
|---|---|
| Panel button - a button under "Quick sounds" | its name |
| Stat check, Rolled a 20, Rolled a 1 | stat |
| Attack, Attack: missed / near / middle distance, Crit | attack type |
| Block, Dodge (the reaction macro) | character |
| Combat starts, Combat ends | - |
| Turn starts | character |
| Custom event | its name |

Leave the second field empty for "any". **Who hears**: everyone, only the one who triggered it, or only the GM. The macro gets `trigger`, `values`, `actor`, `token`, `data` (the roll's numbers) and `binding` as variables. If the player who triggered it may not run the macro, the GM's client runs it. The stat check and reaction macros can't be bound (a roll inside a roll).

Fire a custom event from any macro:

```js
game.dogmaliter.fireTrigger('custom', { values: ['Взрыв'] });
```

Every event also calls the hook `dogmaliter.trigger` with `(trigger, {values, actor, token, data})`.

## Footsteps by region

A Region Behavior: draw a region, open its configuration -> **Behaviors** -> "+" -> **Footsteps**.

- **Sound**: one file, or a pattern with `*` (`sounds/steps/grass-*.ogg`) - each step plays a random matching file, never the same twice in a row. Players may not browse files, so the GM's client looks the pattern up when the behavior is saved; after adding files to the folder, press the refresh button next to the region on the panel.
- **One step every (spaces)**, **volume**, **heard up to** (scene units; 0 = everywhere), **who hears** (everyone nearby / those who see the token / the owner and the GM), **priority** (where regions overlap).
- Every client plays the steps itself, following the token's animation, on the Environment volume channel. The volume falls off with the distance to the listener: your selected tokens, else your own tokens; a GM with nothing selected hears every step. Flying, burrowing and teleporting tokens make no sound; players never hear tokens the GM has hidden.
- The panel's Sounds page lists the scene's footstep regions (on/off each, open the configuration) and has a switch for all of them.

## Where it lives

| File | What |
|---|---|
| `module/canvas/token.mjs` | the stacked resource bars above tokens |
| `module/documents/token.mjs` | no HUD bar for a switched-off resource |
| `module/helpers/migration.mjs` | one-time data changes (`power` -> `mana`; the new stats in the list of new actors' attributes) |
| `macros/stat-roll.js`, `macros/reaction.js` | the stat check and reaction macros' original texts |
| `module/rolls/system-macros.mjs` | the world's system macros: create, keep up to date while unedited, run, restore |
| `module/rules/charges.mjs` | charges: spend, recover at the start of a turn |
| `module/rules/action-log.mjs` | the action log; `templates/apps/gm-panel/log.hbs` |
| `module/rules/skills.mjs` | skills: the compendium, check, use, give, copies, cooldowns; `templates/item/item-skill-sheet.hbs` |
| `module/apps/skill-library.mjs`, `module/apps/skill-editor.mjs` | the skill library window and the skill editor; `templates/apps/skill-library/`, `templates/apps/skill-editor.hbs` |
| `module/apps/token-resources.mjs` | the selected token's quick bars; `templates/hud/token-resources.hbs`, `templates/hud/token-charges.hbs` |
| `module/apps/gm-panel.mjs` | the GM panel; `templates/apps/gm-panel/` |
| `module/audio/triggers.mjs` | sound bindings and the events that fire them |
| `module/audio/footsteps.mjs` | the Footsteps region behavior |
| `module/helpers/settings.mjs` | world settings and the panel's keybinding |
| `src/scss/components/_gm-panel.scss` | the panel's and the roll dialog's styles |
| `module/sheets/actor-sheet.mjs` | the sheet class: tabs, add/delete attribute, "Use portrait", the always-open description editor |
| `templates/actor/actor-sheet.hbs` | the markup of both pages |
| `module/documents/actor.mjs` | attribute storage (`attributeList`, `addAttribute`, `removeAttribute`) and roll data |
| `module/helpers/fonts.mjs` | the editor's fonts |
| `src/scss/components/_r20-sheet.scss` | the sheet's styles and colours (variables at the top) |
| `lang/en.json` | all sheet labels (`DOGMALITER.Sheet.*`) |

Attributes are stored in `system.attributes`, keyed by a random id so a rename never moves the data: `{ "k3Jd9...": { "name": "Hit Points", "value": "22", "max": "30" } }`. Values are stored as text; a numeric one becomes a number in roll data. The description is HTML in `system.biography`.

---

# Original boilerplate notes

This system is a dogmaliter system that you can use as a starting point for building your own custom systems. It's similar to Simple World-building, but has examples of creating attributes in code rather than dynamically through the UI.

## Usage

There are two ways to get started: using the DogmaLiter system generator command or manually renaming and updating files.

Regardless of which method you choose, think carefully about your system's name. Your system's package name when submitted to Foundry must be formatted like `alphanumeric-lowercase`, and it must be unique. Check the Foundry systems package list for conflicts before committing to a name!

> **Data Models**
>
> If you would like to use DataModel classes instead of the older template.json configuration, you'll need to use the `npm run generate` command described below and choose to enable them when asked. DataModels are currently an optional feature, and are only availabe in the generator CLI due to that.

### Generator

This system includes a generator CLI in `package.json`. To use it, you must have [node.js](https://nodejs.org) installed, and it's recommended that you install node 20 or later.

> **Python Generator**
> 
> If you would rather use Python than node, there’s an excellent Python-based generator created by Cussa at https://github.com/Cussa/fvtt-dogmaliter-initializator. Give it a shot!

Once you have npm installed, you can run the following in your terminal or command prompt:

```bash
npm install
npm run generate
```

Your terminal should prompt you to name your system. Read the instructions carefully, the letter case and special characters in each question matter for correct system generation.

Once the generator completes, it will output your system to `build/<your-system-name>`, where `<your-system-name>` is the package name you supplied during the prompt.

Copy this directory over to your Foundry systems directory and start coding!

### Manual Replacement

Before installing this system, you should rename any files that have `dogmaliter` in their filename to use whatever machine-safe name your system needs, such as `adnd2e` if you were building a system for 2nd edition Advanced Dungeons & Dragons. In addition, you should search through the files for `dogmaliter` and `DogmaLiter` and do the same for those, replacing them with appropriate names for your system.

The `name` property in your `system.json` file is your system's package name. This need to be formatted `alphanumeric-lowercase`, and it must also match the foldername you use for your system.

### Vue 3 DogmaLiter

**NOTE: The Vue 3 version is currently outdated and considered an advanced usage of Foundry due to it being a custom renderer. Only try it out if you _really_ like Vue and are feeling dangerous!**

Alternatively, there's another build of this system that supports using Vue 3 components (ES module build target) for character sheet templates.

Head over to the [Vue3DogmaLiter System](https://gitlab.com/asacolips-projects/foundry-mods/vue3dogmaliter) repo if you're interested in using Vue!

### Getting Help

Check out the [Official Foundry VTT Discord](https://discord.gg/foundryvtt)! The #system-development channel has helpful pins and is a good place to ask questions about any part of the foundry application.

For more static references, the [Knowledge Base](https://foundryvtt.com/kb/) and [API Documentation](https://foundryvtt.com/api/) provide different levels of detail. For the most detail, you can find the client side code in your foundry installation location. Classes are documented in individual files under `resources/app/client` and `resources/app/common`, and the code is collated into a single file at `resources/app/public/scripts/foundry.js`.

#### Tutorial

For much more information on how to use this system as a starting point for making your own, see the [full tutorial on the Foundry Wiki](https://foundryvtt.wiki/en/development/guides/SD-tutorial)!

Note: Tutorial may be out of date, so look out for the Foundry compatibility badge at the top of each page.

## Sheet Layout

This system includes a handful of helper CSS classes to help you lay out your sheets if you're not comfortable diving into CSS fully. Those are:

- `flexcol`: Included by Foundry itself, this lays out the child elements of whatever element you place this on vertically.
- `flexrow`: Included by Foundry itself, this lays out the child elements of whatever element you place this on horizontally.
- `flex-center`: When used on something that's using flexrow or flexcol, this will center the items and text.
- `flex-between`: When used on something that's using flexrow or flexcol, this will attempt to place space between the items. Similar to "justify" in word processors.
- `flex-group-center`: Add a border, padding, and center all items.
- `flex-group-left`: Add a border, padding, and left align all items.
- `flex-group-right`: Add a border, padding, and right align all items.
- `grid`: When combined with the `grid-Ncol` classes, this will lay out child elements in a grid.
- `grid-Ncol`: Replace `N` with any number from 1-12, such as `grid-3col`. When combined with `grid`, this will layout child elements in a grid with a number of columns equal to the number specified.

## Compiling the CSS

This repo includes both CSS for the theme and SCSS source files. If you're new to CSS, it's probably easier to just work in those files directly and delete the SCSS directory. If you're interested in using a CSS preprocessor to add support for nesting, variables, and more, you can run `npm install` in this directory to install the dependencies for the scss compiler. After that, just run `npm run build` to compile the SCSS and start a process that watches for new changes.

![image](http://mattsmith.in/images/dogmaliter.png)
