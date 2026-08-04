#!/usr/bin/env bun

import { Pdf2PltError } from "@pdf2plt/core";

import { HELP_TEXT, parseCliArguments } from "./arguments";
import { CliUsageError } from "./errors";
import { normalizeCliError, runCli } from "./run";

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return 0;
  }
  return runCli(options, { log: console.log, warn: console.warn });
}

try {
  process.exitCode = await main();
} catch (caught) {
  const error = normalizeCliError(caught);
  console.error(`错误：${error.message}`);
  process.exitCode = error instanceof CliUsageError || error instanceof Pdf2PltError ? 2 : 1;
}
