import { createContext, useContext } from 'react'
import { resolveLocale, type Locale } from '../lib/host'
import { en } from './en'
import { de } from './de'
import { es } from './es'

export type TranslationKey = keyof typeof en
export type Dictionary = Record<TranslationKey, string>

const DICTIONARIES: Record<Locale, Dictionary> = { en, de, es }

/**
 * Interpolate `{name}` placeholders. Deliberately tiny — an i18n library would
 * cost more bundle than the entire translation table.
 */
export function translate(
  dict: Dictionary,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  const template = dict[key] ?? en[key] ?? String(key)
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? en
}

export interface I18n {
  locale: Locale
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

export function createI18n(locale: Locale = resolveLocale()): I18n {
  const dict = getDictionary(locale)
  return { locale, t: (key, vars) => translate(dict, key, vars) }
}

export const I18nContext = createContext<I18n>(createI18n('en'))

export function useI18n(): I18n {
  return useContext(I18nContext)
}
