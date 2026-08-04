import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const releaseRoot = resolve(repositoryRoot, "dist/release");
const releaseTarget = process.argv[2] ?? "linux-x64";
const releaseTargets = {
  "linux-x64": {
    bunTarget: "bun-linux-x64-baseline",
    bundleName: "pdf2plt-cli-linux-x64",
    executableName: "pdf-pattern-svg",
    archiveExtension: "tar.gz",
  },
  "windows-x64": {
    bunTarget: "bun-windows-x64-baseline",
    bundleName: "pdf2plt-cli-windows-x64",
    executableName: "pdf-pattern-svg.exe",
    archiveExtension: "zip",
  },
} as const;

if (!(releaseTarget in releaseTargets)) {
  throw new Error(`不支持的 CLI 发布目标：${releaseTarget}`);
}

const target = releaseTargets[releaseTarget as keyof typeof releaseTargets];
const bundleName = target.bundleName;
const bundleDirectory = resolve(releaseRoot, bundleName);
const executablePath = resolve(bundleDirectory, target.executableName);
const archivePath = resolve(releaseRoot, `${bundleName}.${target.archiveExtension}`);

async function run(command: string[], cwd = repositoryRoot) {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`命令失败 (${exitCode})：${command.join(" ")}`);
  }
}

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function createWindowsZip() {
  if (process.platform === "win32") {
    await run([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -LiteralPath ${powershellLiteral(bundleDirectory)} -DestinationPath ${powershellLiteral(archivePath)} -Force`,
    ]);
    return;
  }
  await run(["zip", "-rq", archivePath, bundleName], releaseRoot);
}

await mkdir(releaseRoot, { recursive: true });
await rm(bundleDirectory, { recursive: true, force: true });
await rm(archivePath, { force: true });
await mkdir(bundleDirectory, { recursive: true });

await run([
  "bun",
  "build",
  "--compile",
  `--target=${target.bunTarget}`,
  resolve(packageDirectory, "src/index.ts"),
  "--outfile",
  executablePath,
]);
if (releaseTarget === "linux-x64") await chmod(executablePath, 0o755);

for (const [source, destination] of [
  [resolve(repositoryRoot, "LICENSE"), "LICENSE"],
  [resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "THIRD_PARTY_NOTICES.md"],
  [resolve(repositoryRoot, "SOURCE_OFFER.md"), "SOURCE_OFFER.md"],
  [resolve(repositoryRoot, "docs/USER_GUIDE.md"), "USER_GUIDE.md"],
] as const) {
  await copyFile(source, resolve(bundleDirectory, destination));
}

if (releaseTarget === "windows-x64") await createWindowsZip();
else await run(["tar", "-czf", archivePath, bundleName], releaseRoot);

console.log(`CLI 发布包：${archivePath}`);
