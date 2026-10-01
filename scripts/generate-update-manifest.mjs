import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readJson, releaseVersion } from "./release-utils.mjs";

// Tauri wraps a standard Minisign key/signature in one additional base64 layer.
// Verify both the file and trusted comment before advertising any release.
export function verifyArtifact(bytes, encodedSignature, encodedPublicKey) {
  const keyLines = Buffer.from(encodedPublicKey, "base64").toString("utf8").trim().split(/\r?\n/);
  const key = Buffer.from(keyLines[1] ?? "", "base64");
  const lines = Buffer.from(encodedSignature, "base64").toString("utf8").trim().split(/\r?\n/);
  const signature = Buffer.from(lines[1] ?? "", "base64");
  const globalSignature = Buffer.from(lines[3] ?? "", "base64");
  if (key.length !== 42 || signature.length !== 74 || globalSignature.length !== 64 ||
      !signature.subarray(2, 10).equals(key.subarray(2, 10)) || !lines[2]?.startsWith("trusted comment: ")) {
    throw new Error("Invalid update signature or signing key does not match tauri.conf.json");
  }
  const algorithm = signature.subarray(0, 2).toString();
  if (!["Ed", "ED"].includes(algorithm)) throw new Error("Unsupported signature algorithm");
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der", type: "spki",
  });
  const payload = algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  if (!verify(null, payload, publicKey, signature.subarray(10)) ||
      !verify(null, Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice(17))]), publicKey, globalSignature)) {
    throw new Error("Update artifact signature verification failed");
  }
}

export function generateManifest({ directory, repository, version, notes = "", date = new Date().toISOString(), publicKey }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid release repository");
  const files = readdirSync(directory, { withFileTypes: true }).filter((file) => file.isFile()).map((file) => file.name);
  const platforms = {};
  for (const [target, suffix] of [["windows-x86_64-nsis", "-setup.exe"], ["windows-x86_64-msi", ".msi"]]) {
    const matches = files.filter((name) => name.endsWith(suffix) && name.includes(`_${version}_`));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${target} artifact for ${version}`);
    const name = matches[0];
    const signature = readFileSync(resolve(directory, `${name}.sig`), "utf8").trim();
    verifyArtifact(readFileSync(resolve(directory, name)), signature, publicKey);
    platforms[target] = { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(name)}` };
  }
  platforms["windows-x86_64"] = platforms["windows-x86_64-nsis"];
  return { version, notes, pub_date: date, platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2] ?? "dist/release");
  const manifest = generateManifest({
    directory,
    repository: process.env.GITHUB_REPOSITORY || "winlans/clothes-tools",
    version: releaseVersion(),
    notes: process.argv[3] ? readFileSync(process.argv[3], "utf8") : "",
    publicKey: readJson("apps/desktop/src-tauri/tauri.conf.json").plugins.updater.pubkey,
  });
  writeFileSync(resolve(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const files = readdirSync(directory, { withFileTypes: true }).filter((file) => file.isFile() && file.name !== "SHA256SUMS");
  writeFileSync(resolve(directory, "SHA256SUMS"), files.map(({ name }) => `${createHash("sha256").update(readFileSync(resolve(directory, name))).digest("hex")}  ${name}`).join("\n") + "\n");
  console.log(`Verified update manifest for ${manifest.version}`);
}
