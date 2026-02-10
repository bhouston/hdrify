#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(__dirname, 'commands');

function isCommandError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('must specify') ||
    lower.includes('subcommand') ||
    lower.includes('unknown command') ||
    lower.includes('unknown arguments')
  );
}

/**
 * Core CLI runner. Sets up yargs with commands but does not call process.exit;
 * the caller handles exit codes.
 */
export async function runCli(argv: string[]): Promise<unknown> {
  const y = yargs(argv)
    .scriptName('hdrify')
    .usage('$0 <command> [options]')
    .command(await fileCommands({ commandDirs: [commandsDir] }))
    .demandCommand(1, 'You must specify a command.')
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .strict()
    .exitProcess(false)
    .fail((msg, err) => {
      if (isCommandError(msg)) {
        console.error('You must specify a command.\n');
        y.showHelp();
        throw new HelpShownError();
      }
      if (err) throw err;
      throw new Error(msg);
    });

  if (argv.length === 0) {
    console.error('You must specify a command.\n');
    y.showHelp();
    return;
  }

  try {
    return await y.parse();
  } catch (error) {
    if (error instanceof HelpShownError) {
      throw error;
    }
    if (error instanceof Error && isCommandError(error.message)) {
      console.error('You must specify a command.\n');
      y.showHelp();
      throw new HelpShownError();
    }
    throw error;
  }
}

class HelpShownError extends Error {
  constructor() {
    super('E_HELP_SHOWN');
    this.name = 'HelpShownError';
  }
}

runCli(hideBin(process.argv))
  .then(() => process.exit(0))
  .catch((error) => {
    if (error instanceof HelpShownError) {
      process.exit(1);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
