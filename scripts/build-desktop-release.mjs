import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { readJson, releaseVersion, root, run } from "./release-utils.mjs";

const platform = process.argv[2];
if (!["linux", "windows"].includes(platform)) throw new Error("Expected linux or windows");
const signed = process.argv.includes("--signed");
if (signed && !process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("TAURI_SIGNING_PRIVATE_KEY is required for signed updates");
const version = releaseVersion();
const config = readJson("apps/desktop/src-tauri/tauri.conf.json");
const repository = process.env.GITHUB_REPOSITORY || "winlans/clothes-tools";
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
mkdirSync(resolve(root, "dist"), { recursive: true });
const configPath = resolve(root, "dist/tauri.release.conf.json");
writeFileSync(configPath, JSON.stringify({
  bundle: { createUpdaterArtifacts: signed },
  plugins: { updater: { ...config.plugins.updater, endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`] } },
}));
try {
  run("pnpm", ["tauri", "build", "--ci", "--bundles", platform === "linux" ? "appimage,deb" : "nsis,msi", "--config", configPath]);
  if (platform === "linux") {
    const artifact = resolve(root, `apps/desktop/src-tauri/target/release/bundle/appimage/${config.productName}_${version}_amd64.AppImage`);
    run("bash", ["scripts/postprocess-appimage.sh", artifact]);
    // Postprocessing changes the bytes: the original Tauri signature is now invalid.
    if (signed) run("pnpm", ["tauri", "signer", "sign", artifact]);
  }
} finally { rmSync(configPath, { force: true }); }
