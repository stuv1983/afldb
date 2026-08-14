/**
 * Theme selection.
 *
 * Two states the reader can choose between, plus an implicit third: with
 * nothing stored, the palette follows `prefers-color-scheme`, which is
 * what a first-time visitor gets.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'afldb-theme';

/**
 * Applies the stored choice to `<html>` before the first paint.
 *
 * This runs as a blocking inline script in <head>, ahead of any styled
 * markup, so a reader who chose dark never sees a frame of cream paper.
 * It is deliberately tiny and dependency-free for that reason, and it
 * swallows its own errors: a browser that refuses localStorage must still
 * render the page rather than fail on the first statement of the document.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
