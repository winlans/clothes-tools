import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateManifest, verifyArtifact } from "./generate-update-manifest.mjs";
import { releaseVersion } from "./release-utils.mjs";

function signingKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const id = randomBytes(8);
  const rawKey = Buffer.concat([Buffer.from("Ed"), id, publicKey.export({ type: "spki", format: "der" }).subarray(-32)]);
  const encodedPublicKey = Buffer.from(`untrusted comment: test\n${rawKey.toString("base64")}\n`).toString("base64");
  return {
    encodedPublicKey,
    sign(bytes) {
      const signature = sign(null, createHash("blake2b512").update(bytes).digest(), privateKey);
      const comment = "timestamp:1234";
      const globalSignature = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
      return Buffer.from(`untrusted comment: test\n${Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64")}\ntrusted comment: ${comment}\n${globalSignature.toString("base64")}\n`).toString("base64");
    },
  };
}

test("verifies update signatures and rejects modified final artifacts or a different signing key", () => {
  const key = signingKey();
  const bytes = Buffer.from("final postprocessed AppImage");
  const signature = key.sign(bytes);
  assert.doesNotThrow(() => verifyArtifact(bytes, signature, key.encodedPublicKey));
  assert.throws(() => verifyArtifact(Buffer.from("modified after signing"), signature, key.encodedPublicKey), /verification failed/);
  assert.throws(() => verifyArtifact(bytes, signature, signingKey().encodedPublicKey), /signing key/);
});

test("generates Windows and Linux update entries only after validating every signature", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pdf2plt-manifest-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = signingKey();
  const artifacts = [
    "pdf2plt_0.1.10_x64-setup.exe",
    "pdf2plt_0.1.10_x64_en-US.msi",
    "pdf2plt_0.1.10_amd64.AppImage",
  ];
  for (const name of artifacts) {
    const bytes = Buffer.from(name);
    writeFileSync(join(directory, name), bytes);
    writeFileSync(join(directory, `${name}.sig`), key.sign(bytes));
  }
  const options = { directory, repository: "winlans/clothes-tools", version: "0.1.10", publicKey: key.encodedPublicKey, notes: "修复导出" };
  const manifest = generateManifest(options);
  assert.equal(manifest.version, "0.1.10");
  assert.equal(manifest.notes, "修复导出");
  assert.equal(Object.keys(manifest.platforms).length, 4);
  assert.match(manifest.platforms["linux-x86_64"].url, /\/v0\.1\.10\/pdf2plt_0\.1\.10_amd64\.AppImage$/);
  assert.match(manifest.platforms["windows-x86_64-msi"].url, /\/v0\.1\.10\/pdf2plt_0\.1\.10_x64_en-US\.msi$/);
  assert.deepEqual(manifest.platforms["windows-x86_64"], manifest.platforms["windows-x86_64-nsis"]);
  const original = readFileSync(join(directory, artifacts[0]));
  writeFileSync(join(directory, artifacts[0]), Buffer.concat([original, Buffer.from("tampered")]));
  assert.throws(() => generateManifest(options), /verification failed/);
  writeFileSync(join(directory, artifacts[0]), original);
  rmSync(join(directory, artifacts[1]));
  assert.throws(() => generateManifest(options), /Expected exactly one windows-x86_64-msi/);
});

test("release tags must match all package and native versions", () => {
  const version = releaseVersion();
  assert.equal(releaseVersion(`v${version}`), version);
  assert.throws(() => releaseVersion("v999.0.0"), /must match/);
});
