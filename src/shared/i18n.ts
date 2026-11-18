/**
 * Thin wrapper over chrome.i18n. Every user-facing string lives in
 * `public/_locales/<lang>/messages.json`; adding a language means adding a file.
 */

export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

/**
 * Fills in the texts of a page from its `data-i18n*` attributes and sets the
 * language and direction of the document.
 *
 * Direction comes from the locale file itself (`uiDir`), not from
 * `@@bidi_dir`: that one follows the browser's language, which can differ
 * from the locale Chrome actually falls back to.
 */
export function localizePage(root: Document = document): void {
  root.documentElement.lang = t('uiLang');
  root.documentElement.dir = t('uiDir');

  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n ?? '');
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder ?? ''));
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel ?? ''));
  }
  const title = root.querySelector<HTMLElement>('title[data-i18n]');
  if (title) root.title = title.textContent ?? root.title;
}
