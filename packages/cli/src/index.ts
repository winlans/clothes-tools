#!/usr/bin/env bun

import { Pdf2PltError } from "@pdf2plt/core";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { HELP_TEXT, parseCliArguments } from "./arguments";
import { CliUsageError, normalizeCliError } from "./errors";

interface MuPdfModuleConfig {
  wasmBinary: Uint8Array;
}

function configurePackagedMuPdf() {
  const executableName = basename(process.execPath);
  const isCompiledExecutable = executableName !== "bun" && executableName !== "bun.exe";
  if (!isCompiledExecutable) return;

  const wasmPath = join(dirname(process.execPath), "mupdf-wasm.wasm");
  if (!existsSync(wasmPath)) {
    throw new CliUsageError(
      `缺少 MuPDF WASM：${wasmPath}\n请保持 mupdf-wasm.wasm 与 pdf-pattern-svg 在同一目录。`,
    );
  }
  (globalThis as typeof globalThis & {
    $libmupdf_wasm_Module?: MuPdfModuleConfig;
  }).$libmupdf_wasm_Module = {
    wasmBinary: new Uint8Array(readFileSync(wasmPath)),
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
