#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as convert from './commands/convert.js';
import * as info from './commands/info.js';

yargs(hideBin(process.argv))
  .scriptName('hdrify')
  .usage('$0 <command> [options]')
  .command(convert.command, convert.describe, convert.builder, convert.handler)
  .command(info.command, info.describe, info.builder, info.handler)
  .demandCommand(1, 'Please provide a valid command')
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .parse();
