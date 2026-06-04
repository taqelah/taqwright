import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { jdkDir, downloadCacheDir } from './paths.js';
import { download, extract } from './archive.js';

function osArch(): { osName: 'mac' | 'linux' | 'windows'; arch: 'x64' | 'aarch64' } {
  const osName =
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  return { osName, arch };
}

/** A JDK home is the dir holding `bin/java` (macOS nests it in Contents/Home). */
function findJavaHome(root: string): string | undefined {
  const java = process.platform === 'win32' ? 'java.exe' : 'java';
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    if (existsSync(path.join(dir, 'bin', java))) return dir;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      try {
        if (statSync(full).isDirectory()) stack.push(full);
      } catch {
        /* skip unreadable */
      }
    }
  }
  return undefined;
}

/** Download + extract Temurin (Adoptium) JDK 21. Returns the resolved JAVA_HOME. */
export async function installJdk(force: boolean): Promise<string> {
  const dir = jdkDir();
  if (force && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  if (!force && existsSync(dir)) {
    const existing = findJavaHome(dir);
    if (existing) return existing;
  }
  mkdirSync(dir, { recursive: true });

  const { osName, arch } = osArch();
  const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${osName}/${arch}/jdk/hotspot/normal/eclipse`;
  const ext = osName === 'windows' ? 'zip' : 'tar.gz';
  const archive = path.join(downloadCacheDir(), `temurin-21-${osName}-${arch}.${ext}`);

  console.log(`  • downloading Temurin JDK 21 (${osName}/${arch})…`);
  await download(url, archive);
  console.log('  • extracting JDK…');
  await extract(archive, dir);

  const javaHome = findJavaHome(dir);
  if (!javaHome) throw new Error('JDK extracted but no bin/java found under ' + dir);
  return javaHome;
}
