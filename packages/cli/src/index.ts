#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsDir = path.join(__dirname, 'commands');

const main = async () =>
  yargs(hideBin(process.argv))
    .scriptName('hdrify')
    .usage('$0 <command> [options]')
    .command(await fileCommands({ commandDirs: [commandsDir] }))
    .demandCommand(1, 'Please provide a valid command')
    .help()
    .alias('h', 'help')
    .version()
    .alias('v', 'version')
    .parse();

main();
