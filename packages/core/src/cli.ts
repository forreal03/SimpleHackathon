#!/usr/bin/env node
// `simple-hackathon check <event.yaml> [--home <dir>]` and
// `simple-hackathon build <event.yaml> --out <dir> [--home <dir>]` (design doc 8.2).

/** Runs one CLI command and returns the process exit code (1 when check finds errors). */
export async function runCli(argv: readonly string[]): Promise<number> {
  throw new Error("not implemented: runCli");
}
