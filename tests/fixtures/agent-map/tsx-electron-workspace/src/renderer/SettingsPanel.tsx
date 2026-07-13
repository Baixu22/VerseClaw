/* eslint-disable react-refresh/only-export-components -- fixture file: exports helper hook for agent-map fixture workspace, not a real fast-refresh boundary */
export type SettingsMode = "compact" | "expanded";

export interface SettingsPanelProps {
  mode: SettingsMode;
  onModeChange: (mode: SettingsMode) => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { mode, onModeChange } = props;
  return (
    <section data-mode={mode}>
      <button onClick={() => onModeChange("compact")}>Compact</button>
      <button onClick={() => onModeChange("expanded")}>Expanded</button>
    </section>
  );
}

export function useSettingsPanel(initialMode: SettingsMode) {
  let mode = initialMode;
  return {
    mode,
    setExpanded() {
      mode = "expanded";
    },
  };
}
