#!/usr/bin/env bun

import { Command } from 'commander'
import { Logger } from 'tslog'

import cmdCheckRegistry from './cmds/check-registry'
const program = new Command()
const logger = new Logger({
  name: 'Toolbox',
  prettyLogTemplate: '{{rawIsoStr}} {{logLevelName}}\t{{nameWithDelimiterSuffix}}',
})

program
  .name('hackfed-toolbox')
  .description('CLI toolbox for HackFed participants')
  .version(process.env.npm_package_version ?? '0.0.0')

// Register commands
cmdCheckRegistry(program, logger)

program.parse()
