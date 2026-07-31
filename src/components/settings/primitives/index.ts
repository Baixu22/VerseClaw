/**
 * Settings component library — the settings-surface building blocks ported
 * from the FakeCoding reference app. Styles live in
 * src/styles/codex-settings-controls.css (single source).
 *
 * Prefer these over the generic shadcn primitives (Card/Label/Switch/Select)
 * anywhere inside the settings surface, so rows keep the reference's measured
 * geometry instead of drifting per call site.
 */
export {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsStackRow,
  SettingsBlock,
  SettingsBanner,
  SettingsInlineLink,
} from './SettingsSection';
export {
  SettingsSwitch,
  SettingsSelect,
  SettingsMultiSelect,
  SettingsSegmented,
  SettingsButton,
  SettingsIconButton,
  SettingsRowMenu,
  SettingsInput,
  SettingsTextarea,
  SettingsKbd,
  useSettingsRowMenu,
} from './SettingsControls';
export type {
  SettingsSelectOption,
  SettingsMultiOption,
  SettingsMenuItem,
} from './SettingsControls';
export { SettingsChevronDownIcon, SettingsMoreIcon, SettingsCheckIcon } from './SettingsGlyphs';
export { usePopover, useDismissOnOutside } from './usePopover';
export type { PopoverPlacement } from './usePopover';
