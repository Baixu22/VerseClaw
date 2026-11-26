import { Check, Pipette, RotateCcw } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { EffortPreviewSlider } from '@/components/chat/EffortPreviewSlider';
import { ThemeSelector } from '@/components/rareui/ThemeSelector';
import {
  ACCENT_PRESETS, DEFAULT_APPEARANCE, DEFAULT_REPLY_SIZE, MAX_READING_SIZE,
  MIN_READING_SIZE, READING_FONTS, SETTINGS_TEXT_SIZES,
} from '@/lib/appearance';
import { useSettingsStore } from '@/stores/settings';
import { SettingsSegmented } from './primitives';

const AppearanceConversationPreview = lazy(() => import('./AppearanceConversationPreview'));

export function AppearanceControls() {
  const { t } = useTranslation('settings');
  const appearance = useSettingsStore((state) => state.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const { accent, fontSize, fontFamily } = appearance;
  const preset = Object.entries(ACCENT_PRESETS).find(([, color]) => color === accent);
  const atDefaults = theme === 'system' && accent === DEFAULT_APPEARANCE.accent
    && fontSize === DEFAULT_APPEARANCE.fontSize && fontFamily === DEFAULT_APPEARANCE.fontFamily
    && appearance.settingsText === DEFAULT_APPEARANCE.settingsText;
  const size = fontSize ?? DEFAULT_REPLY_SIZE;
  const sizeLabels = Array.from({ length: MAX_READING_SIZE - MIN_READING_SIZE + 1 },
    (_, index) => t('appearance.readingSizeValue', { size: MIN_READING_SIZE + index }));

  return (
    <div className="appearance-settings">
      <section aria-labelledby="appearance-colors-heading">
        <div className="appearance-section-heading">
          <h2 id="appearance-colors-heading">{t('appearance.colorsHeading')}</h2>
          <button
            type="button"
            className="appearance-restore"
            disabled={atDefaults}
            onClick={() => {
              setAppearance(DEFAULT_APPEARANCE);
              if (theme !== 'system') setTheme('system');
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {t('appearance.restore')}
          </button>
        </div>
        <div className="appearance-columns appearance-color-layout">
          <div className="appearance-field" data-testid="settings-theme-mode">
            <h3>{t('appearance.theme')}</h3>
            <ThemeSelector
              aria-label={t('appearance.theme')}
              value={theme}
              onChange={(next) => setTheme(next as typeof theme)}
              options={[
                { value: 'light', label: t('appearance.light'), preview: 'light' },
                { value: 'dark', label: t('appearance.dark'), preview: 'dark' },
                { value: 'system', label: t('appearance.system'), preview: 'split' },
              ]}
            />
          </div>
          <div className="appearance-field appearance-palette">
            <div className="appearance-label-line">
              <h3>{t('appearance.accent')}</h3>
              <span className="appearance-value">{preset ? t(`appearance.accents.${preset[0]}`) : accent.toUpperCase()}</span>
            </div>
            <div className="appearance-swatches" role="group" aria-label={t('appearance.accent')}>
              {Object.entries(ACCENT_PRESETS).map(([name, color]) => (
                <button
                  type="button"
                  className="appearance-swatch"
                  aria-pressed={accent === color}
                  aria-label={t(`appearance.accents.${name}`)}
                  title={t(`appearance.accents.${name}`)}
                  onClick={() => setAppearance({ accent: color })}
                  key={name}
                >
                  <span
                    aria-hidden="true"
                    className="appearance-swatch-dot"
                    style={color === 'default' ? undefined : { background: color }}
                  >
                    {accent === color && <Check size={14} strokeWidth={2.6} />}
                  </span>
                </button>
              ))}
            </div>
            <label className="appearance-custom">
              <Pipette size={14} aria-hidden="true" />
              {t('appearance.customColor')}
              <input
                type="color"
                aria-label={t('appearance.customColor')}
                value={accent === 'default' ? ACCENT_PRESETS.ocean : accent}
                onChange={(event) => setAppearance({ accent: event.currentTarget.value })}
              />
            </label>
          </div>
        </div>
      </section>

      <section aria-labelledby="appearance-reading-heading">
        <div className="appearance-section-heading">
          <h2 id="appearance-reading-heading">{t('appearance.readingHeading')}</h2>
        </div>
        <div className="appearance-columns appearance-reading-layout">
          <div className="appearance-type-controls">
            <div className="appearance-type-row">
              <h3>{t('appearance.settingsText')}</h3>
              <SettingsSegmented
                ariaLabel={t('appearance.settingsText')}
                value={appearance.settingsText}
                onChange={(settingsText) => setAppearance({ settingsText })}
                options={SETTINGS_TEXT_SIZES.map((value) => ({ value, label: t(`appearance.settingsSizes.${value}`) }))}
              />
            </div>
            <div className="appearance-type-row">
              <h3>{t('appearance.readingFont')}</h3>
              <SettingsSegmented
                ariaLabel={t('appearance.readingFont')}
                value={fontFamily}
                onChange={(value) => setAppearance({ fontFamily: value })}
                options={READING_FONTS.map((value) => ({ value, label: t(`appearance.fonts.${value}`) }))}
              />
            </div>
            <div className="appearance-field appearance-size">
              <div className="appearance-label-line">
                <h3>{t('appearance.readingSize')}</h3>
                <span className="appearance-value">{sizeLabels[size - MIN_READING_SIZE]}</span>
              </div>
              <EffortPreviewSlider
                testIdPrefix="settings-reading-size"
                ariaLabel={t('appearance.readingSize')}
                labels={sizeLabels}
                value={size - MIN_READING_SIZE}
                onValueChange={(index) => {
                  const next = MIN_READING_SIZE + Math.round(index);
                  if (next !== fontSize) setAppearance({ fontSize: next });
                }}
              />
            </div>
          </div>
          <figure className="appearance-preview" data-testid="appearance-reading-preview">
            <figcaption>{t('appearance.preview')}</figcaption>
            <div className="appearance-preview-conversation">
              <Suspense fallback={<p className="reading-text" aria-busy="true">{t('appearance.sample')}</p>}>
                <AppearanceConversationPreview />
              </Suspense>
            </div>
          </figure>
        </div>
      </section>
    </div>
  );
}
