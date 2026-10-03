/**
 * Fonts for the rich-text editor (the description on the actor sheet, and any
 * other Foundry editor in this world) - and for the sheet itself (Roboto).
 *
 * Every family here has BOTH Cyrillic and Latin - checked against Google
 * Fonts, which serves them. The files are not shipped with the system: a
 * stylesheet link to Google Fonts is added to the page at `init`, and the
 * browser fetches the Cyrillic or Latin part of a font on demand. Without
 * internet they fall back to the default font.
 *
 * Registering a family in CONFIG.fontDefinitions with `editor: true` is what
 * puts it into the editor's Font menu. `fonts: []` means "no files to load
 * here - the stylesheet declares it", the same way Foundry lists Arial.
 *
 * To add a font: pick one on fonts.google.com that lists Cyrillic, and add a
 * line below - `family` as Google names it, `weights` if it has a bold.
 */
export const EDITOR_FONTS = [
  // Sans-serif
  { family: 'Roboto', weights: '400;700' },
  { family: 'Open Sans', weights: '400;700' },
  { family: 'PT Sans', weights: '400;700' },
  { family: 'Montserrat', weights: '400;700' },
  { family: 'Inter', weights: '400;700' },
  // Serif
  { family: 'PT Serif', weights: '400;700' },
  { family: 'Lora', weights: '400;700' },
  { family: 'Merriweather', weights: '400;700' },
  { family: 'Playfair Display', weights: '400;700' },
  // Display, monospace, handwriting
  { family: 'Oswald', weights: '400;700' },
  { family: 'Russo One' },
  { family: 'Roboto Mono', weights: '400;700' },
  { family: 'JetBrains Mono', weights: '400;700' },
  { family: 'Caveat', weights: '400;700' },
  { family: 'Marck Script' },
];

/**
 * Fonts Foundry ships that have no Cyrillic. They stay loaded (the interface
 * uses Signika) but leave the editor's Font menu, so every font offered there
 * can write both Russian and English.
 */
const LATIN_ONLY_CORE_FONTS = ['Amiri', 'Bruno Ace', 'Modesto Condensed', 'Signika'];

const STYLESHEET_ID = 'dogmaliter-fonts';

/** One Google Fonts request for the whole list. */
function googleFontsUrl() {
  const families = EDITOR_FONTS.map(({ family, weights }) => {
    const name = family.replace(/ /g, '+');
    return `family=${weights ? `${name}:wght@${weights}` : name}`;
  });
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/** Call at `init`, before Foundry loads fonts. */
export function registerEditorFonts() {
  if (!document.getElementById(STYLESHEET_ID)) {
    const link = document.createElement('link');
    link.id = STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = googleFontsUrl();
    document.head.append(link);
  }
  for (const { family } of EDITOR_FONTS) {
    CONFIG.fontDefinitions[family] = { editor: true, fonts: [] };
  }
  for (const family of LATIN_ONLY_CORE_FONTS) {
    if (CONFIG.fontDefinitions[family]) CONFIG.fontDefinitions[family].editor = false;
  }
}
