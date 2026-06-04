import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { androidSdkDir, downloadCacheDir } from './paths.js';
import { download, extract } from './archive.js';

// Android cmdline-tools build pinned for reproducible host installs.
const CMDLINE_VERSION = '11076708';

function toolEnv(androidHome: string, javaHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome,
    PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
  };
}

function sdkmanagerBin(sdk: string): string {
  const bin = process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager';
  return path.join(sdk, 'cmdline-tools', 'latest', 'bin', bin);
}

/** Run an SDK CLI tool; `feedYes` pipes "y" for the interactive license prompt. */
function runTool(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  feedYes = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: [feedYes ? 'pipe' : 'ignore', 'ignore', 'inherit'],
      env,
    });
    if (feedYes && p.stdin) {
      p.stdin.write('y\n'.repeat(50));
      p.stdin.end();
    }
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with code ${code}`)),
    );
    p.on('error', reject);
  });
}

/**
 * Vendors the Android cmdline-tools (Google CDN) then `sdkmanager`-installs
 * platform-tools (host-native adb). On a real host, sdkmanager's
 * platform-tools is the correct adb (no Debian-adb symlink needed).
 * Returns ANDROID_HOME.
 */
export async function installAndroidSdk(force: boolean, javaHome: string): Promise<string> {
  const sdk = androidSdkDir();
  if (force && existsSync(sdk)) rmSync(sdk, { recursive: true, force: true });
  const env = toolEnv(sdk, javaHome);
  const cmdlineLatest = path.join(sdk, 'cmdline-tools', 'latest', 'bin');

  if (!existsSync(cmdlineLatest)) {
    const osName =
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
    const url = `https://dl.google.com/android/repository/commandlinetools-${osName}-${CMDLINE_VERSION}_latest.zip`;
    const archive = path.join(downloadCacheDir(), `cmdline-tools-${osName}.zip`);
    console.log(`  • downloading Android cmdline-tools (${osName})…`);
    await download(url, archive);
    console.log('  • extracting cmdline-tools…');
    const ctRoot = path.join(sdk, 'cmdline-tools');
    rmSync(ctRoot, { recursive: true, force: true });
    mkdirSync(ctRoot, { recursive: true });
    await extract(archive, ctRoot);
    // The zip contains a top-level `cmdline-tools/`; the SDK layout wants it
    // at `cmdline-tools/latest/`.
    renameSync(path.join(ctRoot, 'cmdline-tools'), path.join(ctRoot, 'latest'));
  }

  const sm = sdkmanagerBin(sdk);
  console.log('  • accepting Android SDK licenses…');
  await runTool(sm, [`--sdk_root=${sdk}`, '--licenses'], env, true);
  // `build-tools` ships `aapt2`, which Appium's UiAutomator2 driver needs
  // to read/install any APK (`appium:app`). Without it, every Android test
  // fails session setup with "Could not find 'aapt2' … Android Build Tools".
  // Pinned to 34.0.0 to match the API-34 system image/platform installAvd()
  // uses. One sdkmanager call installs both.
  console.log('  • installing platform-tools (adb) + build-tools (aapt2)…');
  await runTool(sm, [`--sdk_root=${sdk}`, 'platform-tools', 'build-tools;34.0.0'], env);
  return sdk;
}

/** Optional (`setup --with-avd`): a system image + a ready-to-boot AVD. */
export async function installAvd(androidHome: string, javaHome: string): Promise<void> {
  const env = toolEnv(androidHome, javaHome);
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  const sysImage = `system-images;android-34;google_apis;${abi}`;
  const sm = sdkmanagerBin(androidHome);
  // A bootable AVD needs three things, not just the system image:
  //   - `emulator`            the runtime binary ($ANDROID_HOME/emulator),
  //                           already on the managed PATH (see managedEnv)
  //   - `platforms;android-34` the platform avdmanager/emulator expect
  //   - the system image       the OS the AVD runs
  // Installing only the system image (the old behaviour) created an AVD
  // that could never launch from the managed toolchain. One sdkmanager
  // call installs all three (~1 GB total, mostly the system image).
  console.log(`  • installing emulator + platform + ${sysImage} (~1 GB)…`);
  await runTool(
    sm,
    [`--sdk_root=${androidHome}`, 'emulator', 'platforms;android-34', sysImage],
    env,
    true,
  );
  const avdmanager = path.join(
    androidHome,
    'cmdline-tools',
    'latest',
    'bin',
    process.platform === 'win32' ? 'avdmanager.bat' : 'avdmanager',
  );
  console.log('  • creating AVD `taqwright_api34`…');
  await runTool(
    avdmanager,
    ['create', 'avd', '-n', 'taqwright_api34', '-k', sysImage, '-d', 'pixel_7', '--force'],
    env,
    true,
  );
}
