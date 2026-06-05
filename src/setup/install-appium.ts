import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appiumDir, appiumHomeDir } from './paths.js';
import { installDriver } from '../providers/appium.js';
import { spawnTool } from './spawn-tool.js';

function npm(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawnTool('npm', args, { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} exited with code ${code}`)),
    );
    p.on('error', reject);
  });
}

/**
 * Provision Appium 3 + the uiautomator2 driver sudo-free into the managed
 * dir (no global npm). Reuses {@link installDriver} (previously dead code)
 * pointed at the managed `appium` binary with the vendored SDK/JDK on env.
 * Returns the `node_modules/.bin` dir (added to the managed PATH).
 */
export async function installAppium(
  force: boolean,
  androidHome: string,
  javaHome: string,
): Promise<string> {
  const dir = appiumDir();
  const appiumHome = appiumHomeDir();
  const binDir = path.join(dir, 'node_modules', '.bin');
  const appiumBin = path.join(binDir, process.platform === 'win32' ? 'appium.cmd' : 'appium');
  // Appium installs drivers under $APPIUM_HOME/node_modules.
  const uia2Dir = path.join(appiumHome, 'node_modules', 'appium-uiautomator2-driver');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    JAVA_HOME: javaHome,
    APPIUM_HOME: appiumHome,
    PATH:
      `${path.join(javaHome, 'bin')}${path.delimiter}` +
      `${path.join(androidHome, 'platform-tools')}${path.delimiter}` +
      `${process.env.PATH ?? ''}`,
  };

  if (force && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  if (force && existsSync(appiumHome)) rmSync(appiumHome, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(appiumHome, { recursive: true });
  const pkg = path.join(dir, 'package.json');
  if (!existsSync(pkg)) {
    writeFileSync(
      pkg,
      JSON.stringify({ name: 'taqwright-managed-appium', private: true }, null, 2) + '\n',
    );
  }
  if (force || !existsSync(appiumBin)) {
    console.log('  • installing Appium 3…');
    await npm(['install', 'appium@^3'], dir, env);
  }
  if (force || !existsSync(uia2Dir)) {
    console.log('  • installing the uiautomator2 driver…');
    await installDriver('uiautomator2', { appiumPath: appiumBin, env });
  } else {
    console.log('  • uiautomator2 driver already present — skipping');
  }
  return binDir;
}
