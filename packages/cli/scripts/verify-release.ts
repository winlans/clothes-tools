import { access, copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const packageDirectory = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const releaseRoot = resolve(repositoryRoot, "dist/release");
const releaseTarget = process.argv[2];
const target = releaseTarget === "windows-x64"
  ? {
      bundleName: "pdf2plt-cli-windows-x64",
      executableName: "pdf-pattern-svg.exe",
      archiveName: "pdf2plt-cli-windows-x64.zip",
    }
  : releaseTarget === "linux-x64"
    ? {
        bundleName: "pdf2plt-cli-linux-x64",
        executableName: "pdf-pattern-svg",
        archiveName: "pdf2plt-cli-linux-x64.tar.gz",
      }
    : undefined;

if (!target) throw new Error(`不支持的 CLI 发布目标：${releaseTarget ?? "未提供"}`);

const bundleDirectory = resolve(releaseRoot, target.bundleName);
const executablePath = resolve(bundleDirectory, target.executableName);
const externalWasmPath = resolve(bundleDirectory, "mupdf-wasm.wasm");
const archivePath = resolve(releaseRoot, target.archiveName);

await access(executablePath);
if ((await stat(archivePath)).size === 0) throw new Error(`CLI 压缩包为空：${archivePath}`);

try {
  await access(externalWasmPath);
  throw new Error(`CLI 仍依赖外部 WASM：${externalWasmPath}`);
} catch (error) {
  if (error instanceof Error && error.message.startsWith("CLI 仍依赖外部 WASM")) throw error;
}

const isolatedDirectory = await mkdtemp(join(tmpdir(), "pdf2plt-cli-standalone-"));
const isolatedExecutable = resolve(isolatedDirectory, basename(executablePath));
try {
  await copyFile(executablePath, isolatedExecutable);
  const canRunDirectly =
    (releaseTarget === "windows-x64" && process.platform === "win32") ||
    (releaseTarget === "linux-x64" && process.platform === "linux");
  const useWine = releaseTarget === "windows-x64" && process.env.PDF2PLT_WINE_SMOKE === "1";
  if (canRunDirectly || useWine) {
    const command = useWine
      ? ["wine64", isolatedExecutable, "--help"]
      : [isolatedExecutable, "--help"];
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "inherit" });
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(`隔离 CLI 启动失败 (${exitCode})：${command.join(" ")}`);
    }
  }
} finally {
  await rm(isolatedDirectory, { recursive: true, force: true });
}

console.log(`${target.bundleName} 单文件发布检查通过。`);
