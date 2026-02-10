#!/usr/bin/env node

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsDir = path.join(__dirname, 'commands');

yargs(hideBin(process.argv))
  .scriptName('exr-hdr')
  .usage('$0 <command> [options]')
  .commandDir(commandsDir, {
    extensions: ['ts', 'js'],
  })
  .demandCommand(1, 'Please provide a valid command')
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .parse();
