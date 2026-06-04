import { mkdirSync, writeFileSync } from 'node:fs';
import { manifestPath, taqwrightHome, applyManagedEnv } from './paths.js';
import { installJdk } from './install-jdk.js';
import { installAndroidSdk, installAvd } from './install-android.js';
import { installAppium } from './install-appium.js';
import { runDoctorChecks } from '../doctor.js';

export interface SetupOptions {
  force?: boolean;
  withAvd?: boolean;
  printEnv?: boolean;
}

/**
 * Vendors the entire Android toolchain into the taqwright-managed dir, writes
 * the manifest {@link managedEnv} reads, then runs `doctor` so the result is
 * self-verifying. iOS/Node are out of scope (cannot be auto-installed).
 */
export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  const force = !!opts.force;
  const home = taqwrightHome();
  mkdirSync(home, { recursive: true });

  console.log(`taqwright install — vendoring the Android toolchain into:\n  ${home}\n`);
  console.log(
    'Downloads ~700 MB (JDK + Android cmdline-tools + Appium). ' +
      'No sudo, no shell-rc changes; everything stays under the dir above.\n',
  );

  console.log('1/4  JDK (Temurin 21)');
  const javaHome = await installJdk(force);
  console.log(`  ✓ JAVA_HOME=${javaHome}\n`);

  console.log('2/4  Android SDK (cmdline-tools + platform-tools/adb)');
  const androidHome = await installAndroidSdk(force, javaHome);
  console.log(`  ✓ ANDROID_HOME=${androidHome}\n`);

  console.log('3/4  Appium 3 + uiautomator2 driver');
  const appiumBin = await installAppium(force, androidHome, javaHome);
  console.log(`  ✓ appium at ${appiumBin}\n`);

  writeFileSync(
    manifestPath(),
    JSON.stringify({ androidHome, javaHome, appiumBin }, null, 2) + '\n',
  );

  if (opts.withAvd) {
    console.log('4/4  Android Virtual Device');
    await installAvd(androidHome, javaHome);
    console.log(
      '  ✓ AVD `taqwright_api34` created — boot it with `emulator -avd taqwright_api34`\n' +
        '    (it shows up in `npx taqwright devices`)\n',
    );
  } else {
    console.log('4/4  AVD — skipped (pass --with-avd to also create an emulator)\n');
  }

  // Pick up what we just wrote and self-verify via the shared doctor checks.
  applyManagedEnv();
  console.log('Verifying with doctor:\n');
  const checks = await runDoctorChecks();
  for (const c of checks) {
    const mark = c.status === 'ok' ? '[ok]' : c.status === 'warn' ? '[--]' : '[!!]';
    console.log(`  ${mark} ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
  }

  console.log(
    '\nAndroid is ready — `npx taqwright test` uses this toolchain automatically ' +
      '(no shell exports needed).',
  );
  console.log('Still manual (cannot be auto-installed): Node ≥ 24 and the iOS/Xcode stack.');
  if (opts.printEnv) {
    console.log('\nTo also use this toolchain from your own shell, add:');
    console.log(`  export JAVA_HOME="${javaHome}"`);
    console.log(`  export ANDROID_HOME="${androidHome}"`);
    console.log(
      '  export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:' +
        '$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"',
    );
  }
}
