import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const releaseRoot = resolve(repositoryRoot, "dist/release");
const bundleName = "pdf2plt-cli-linux-x64";
const bundleDirectory = resolve(releaseRoot, bundleName);
const executablePath = resolve(bundleDirectory, "pdf-pattern-svg");

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

await mkdir(releaseRoot, { recursive: true });
await rm(bundleDirectory, { recursive: true, force: true });
await mkdir(bundleDirectory, { recursive: true });

await run([
  "bun",
  "build",
  "--compile",
  "--target=bun-linux-x64-baseline",
  resolve(packageDirectory, "src/index.ts"),
  "--outfile",
  executablePath,
]);
await chmod(executablePath, 0o755);

for (const [source, destination] of [
  [resolve(packageDirectory, "node_modules/mupdf/dist/mupdf-wasm.wasm"), "mupdf-wasm.wasm"],
  [resolve(repositoryRoot, "LICENSE"), "LICENSE"],
  [resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "THIRD_PARTY_NOTICES.md"],
  [resolve(repositoryRoot, "SOURCE_OFFER.md"), "SOURCE_OFFER.md"],
  [resolve(repositoryRoot, "docs/USER_GUIDE.md"), "USER_GUIDE.md"],
] as const) {
  await copyFile(source, resolve(bundleDirectory, destination));
}

await run([
  "tar",
  "-czf",
  resolve(releaseRoot, `${bundleName}.tar.gz`),
  bundleName,
], releaseRoot);

console.log(`CLI 发布包：${resolve(releaseRoot, `${bundleName}.tar.gz`)}`);
