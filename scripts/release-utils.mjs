import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
export function releaseVersion(tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined) {
  const version = readJson("package.json").version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid release version");
  for (const path of ["apps/desktop/package.json", "packages/core/package.json", "packages/cli/package.json", "apps/desktop/src-tauri/tauri.conf.json"]) {
    if (readJson(path).version !== version) throw new Error(`Version mismatch in ${path}`);
  }
  const cargo = readFileSync(resolve(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
  if (cargo.match(/^version = "([^"]+)"/m)?.[1] !== version) throw new Error("Cargo version mismatch");
  if (tag && tag !== `v${version}`) throw new Error(`Release tag ${tag} must match v${version}`);
  return version;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: "inherit", shell: process.platform === "win32" && command === "pnpm", ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
