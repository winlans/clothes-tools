#!/usr/bin/env bun

import { Pdf2PltError } from "@pdf2plt/core";
import { readFileSync } from "node:fs";
import mupdfWasmPath from "../node_modules/mupdf/dist/mupdf-wasm.wasm" with { type: "file" };

import { HELP_TEXT, parseCliArguments } from "./arguments";
import { CliUsageError, normalizeCliError } from "./errors";

interface MuPdfModuleConfig {
  wasmBinary: Uint8Array;
}

function configurePackagedMuPdf() {
  (globalThis as typeof globalThis & {
    $libmupdf_wasm_Module?: MuPdfModuleConfig;
  }).$libmupdf_wasm_Module = {
    wasmBinary: new Uint8Array(readFileSync(mupdfWasmPath)),
  };
}

async function main() {
  configurePackagedMuPdf();
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  const { runCli } = await import("./run");
  return runCli(options, { log: console.log, warn: console.warn });
}

try {
  process.exitCode = await main();
} catch (caught) {
  const error = normalizeCliError(caught);
  console.error(`错误：${error.message}`);
  process.exitCode = error instanceof CliUsageError || error instanceof Pdf2PltError ? 2 : 1;
}
