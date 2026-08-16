/**
 * Theme selection. Two stored states, plus an implicit third: with nothing
 * stored the palette follows `prefers-color-scheme`.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'afldb-theme';

/**
 * Applies the stored choice to `<html>` before the first paint.
 *
 * Runs as a blocking inline script ahead of any styled markup, so a reader who
 * chose dark never sees a frame of cream paper — hence tiny and
 * dependency-free. Swallows its own errors: a browser refusing localStorage
 * must still render the page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
