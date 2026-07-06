#!/usr/bin/env zx

import 'zx/globals';
import sharp from 'sharp';
import png2icons from 'png2icons';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons');
const LOGO_KIT_DIR = path.join(ICONS_DIR, 'clawx-logo-kit');
const DOCK_SOURCE = path.join(LOGO_KIT_DIR, 'logo-dock-1024.png');
const DOCK_DARK_SOURCE = path.join(LOGO_KIT_DIR, 'logo-dock-1024-dark.png');
const TRAY_SOURCE = path.join(LOGO_KIT_DIR, 'logo-menubar-128.png');
const TRAY_DARK_SOURCE = path.join(LOGO_KIT_DIR, 'logo-menubar-128-dark.png');

function embeddedPngSvg(buffer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${buffer.toString('base64')}"/></svg>\n`;
}

function writeFileStable(targetPath, data) {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, data);

  try {
    fs.removeSync(targetPath);
    fs.moveSync(tmpPath, targetPath, { overwrite: true });
  } catch (error) {
    fs.removeSync(tmpPath);
    throw error;
  }
}

echo`Generating Verse Claw icons from the project logo kit...`;

if (!fs.existsSync(DOCK_SOURCE)) {
  echo(chalk.red`Logo kit source not found: ${DOCK_SOURCE}`);
  process.exit(1);
}

if (!fs.existsSync(TRAY_SOURCE)) {
  echo(chalk.red`Logo kit source not found: ${TRAY_SOURCE}`);
  process.exit(1);
}

await fs.ensureDir(ICONS_DIR);

try {
  const masterPngBuffer = await sharp(DOCK_SOURCE)
    .resize(1024, 1024)
    .png()
    .toBuffer();
  const trayPngBuffer = await sharp(TRAY_SOURCE)
    .resize(128, 128)
    .png()
    .toBuffer();
  const darkPngBuffer = fs.existsSync(DOCK_DARK_SOURCE)
    ? await sharp(DOCK_DARK_SOURCE).resize(1024, 1024).png().toBuffer()
    : null;
  const trayDarkPngBuffer = fs.existsSync(TRAY_DARK_SOURCE)
    ? await sharp(TRAY_DARK_SOURCE).resize(128, 128).png().toBuffer()
    : null;

  writeFileStable(path.join(ICONS_DIR, 'icon.svg'), embeddedPngSvg(masterPngBuffer));
  writeFileStable(path.join(ICONS_DIR, 'icon-plain.svg'), embeddedPngSvg(masterPngBuffer));
  echo`  Created icon.svg and icon-plain.svg`;

  if (darkPngBuffer) {
    writeFileStable(path.join(ICONS_DIR, 'icon-dark.svg'), embeddedPngSvg(darkPngBuffer));
    await sharp(darkPngBuffer)
      .resize(512, 512)
      .png()
      .toFile(path.join(ICONS_DIR, 'icon-dark.png'));
    const darkIcoBuffer = png2icons.createICO(darkPngBuffer, png2icons.HERMITE, 0, false);
    if (darkIcoBuffer) {
      writeFileStable(path.join(ICONS_DIR, 'icon-dark.ico'), darkIcoBuffer);
    }
    const darkIcnsBuffer = png2icons.createICNS(darkPngBuffer, png2icons.HERMITE, 0);
    if (darkIcnsBuffer) {
      writeFileStable(path.join(ICONS_DIR, 'icon-dark.icns'), darkIcnsBuffer);
    }
    echo`  Created dark theme icon assets`;
  }

  await sharp(masterPngBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon.png'));
  echo`  Created icon.png (512x512)`;

  const icoBuffer = png2icons.createICO(masterPngBuffer, png2icons.HERMITE, 0, false);
  if (icoBuffer) {
    writeFileStable(path.join(ICONS_DIR, 'icon.ico'), icoBuffer);
    echo`  Created icon.ico`;
  } else {
    echo(chalk.red`  Failed to create icon.ico`);
  }

  const icnsBuffer = png2icons.createICNS(masterPngBuffer, png2icons.HERMITE, 0);
  if (icnsBuffer) {
    writeFileStable(path.join(ICONS_DIR, 'icon.icns'), icnsBuffer);
    echo`  Created icon.icns`;
  } else {
    echo(chalk.red`  Failed to create icon.icns`);
  }

  const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
  for (const size of linuxSizes) {
    await sharp(masterPngBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONS_DIR, `${size}x${size}.png`));
  }
  echo`  Created ${linuxSizes.length} Linux PNG icons`;

  await sharp(trayPngBuffer)
    .resize(22, 22)
    .png()
    .toFile(path.join(ICONS_DIR, 'tray-icon-Template.png'));
  writeFileStable(path.join(ICONS_DIR, 'tray-icon-template.svg'), embeddedPngSvg(trayPngBuffer, 128));
  if (trayDarkPngBuffer) {
    await sharp(trayDarkPngBuffer)
      .resize(22, 22)
      .png()
      .toFile(path.join(ICONS_DIR, 'tray-icon-dark.png'));
    writeFileStable(path.join(ICONS_DIR, 'tray-icon-dark.svg'), embeddedPngSvg(trayDarkPngBuffer, 128));
  }
  echo`  Created tray icon assets`;

  echo`\nIcon generation complete. Files located in: ${ICONS_DIR}`;
} catch (error) {
  echo(chalk.red`\nFatal Error: ${error.message}`);
  process.exit(1);
}
