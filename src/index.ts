#!/usr/bin/env bun

import { Command } from 'commander'
import { Logger } from 'tslog'

import cmdCheckRegistry from './cmds/check-registry'
import generateTelephony from './cmds/generate-telephony'

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
generateTelephony(program, logger)

program.parse()
