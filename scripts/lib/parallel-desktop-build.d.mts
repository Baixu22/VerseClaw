import type { Plugin } from 'vite';
import type { ElectronOptions } from 'vite-plugin-electron';
export function parallelDesktopBuildPlugin(options: ElectronOptions | ElectronOptions[]): Plugin[];
