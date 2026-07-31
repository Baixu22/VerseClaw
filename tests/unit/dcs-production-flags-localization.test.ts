// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type JsonObject = Record<string, unknown>;
const root = process.cwd();
const surfaceKeys = ['contextLayers', 'dcsPreview', 'dcsProdFlags'] as const;

function readDeveloperLocale(locale: string): JsonObject {
  const settings = JSON.parse(
    readFileSync(join(root, `shared/i18n/locales/${locale}/settings.json`), 'utf8'),
  ) as { developer: JsonObject };
  return settings.developer;
}

function flatten(value: unknown, prefix = '', output: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value as JsonObject)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') output[path] = child;
    else flatten(child, path, output);
  }
  return output;
}

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1]).sort();
}

describe('FP-P4-07 DCS production flags localization', () => {
  const locales = {
    en: readDeveloperLocale('en'),
    ja: readDeveloperLocale('ja'),
    ru: readDeveloperLocale('ru'),
  };

  it.each(['ja', 'ru'] as const)(
    '%s localizes the complete visible DCS control surface without losing tokens',
    (locale) => {
      for (const surfaceKey of surfaceKeys) {
        const english = flatten(locales.en[surfaceKey], surfaceKey);
        const translated = flatten(locales[locale][surfaceKey], surfaceKey);

        expect(Object.keys(translated).sort(), `${locale}.${surfaceKey} key parity`).toEqual(
          Object.keys(english).sort(),
        );
        for (const [key, englishValue] of Object.entries(english)) {
          const translatedValue = translated[key];
          expect(translatedValue, `${locale}.${key} must not remain an English placeholder`).not.toBe(
            englishValue,
          );
          expect(interpolationTokens(translatedValue), `${locale}.${key} interpolation parity`).toEqual(
            interpolationTokens(englishValue),
          );
          expect(
            locale === 'ja' ? /[\u3040-\u30ff\u3400-\u9fff]/.test(translatedValue) : /[\u0400-\u04ff]/.test(translatedValue),
            `${locale}.${key} must contain locale text`,
          ).toBe(true);
        }
      }
    },
  );

  it('keeps every acknowledgement recovery hint actionable', () => {
    const hints = {
      ja: (locales.ja.dcsProdFlags as JsonObject).ackHint as JsonObject,
      ru: (locales.ru.dcsProdFlags as JsonObject).ackHint as JsonObject,
    };
    const requiredActions: Record<'ja' | 'ru', RegExp> = {
      ja: /(起動|再起動|更新|確認|開いて)/,
      ru: /(запуст|перезапуст|обнов|проверь|открой)/i,
    };
    for (const locale of ['ja', 'ru'] as const) {
      for (const [key, value] of Object.entries(hints[locale])) {
        expect(value, `${locale}.ackHint.${key}`).toEqual(expect.any(String));
        expect(requiredActions[locale].test(String(value)), `${locale}.ackHint.${key} next action`).toBe(
          true,
        );
      }
    }
  });
});
