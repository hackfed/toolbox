#!/usr/bin/env bun

import { Command } from 'commander'
import { Logger } from 'tslog'

import commandCheckRegistry from './cmds/check-registry'
import generateTelephony from './cmds/generate-telephony'
import generateWireGuard from './cmds/generate-wireguard'

const program = new Command()
const logger = new Logger({
  name: 'Toolbox',
  pretty: {
    enabled: true,
    template: '{{rawIsoStr}} {{logLevelName}}\t{{nameWithDelimiterSuffix}}'
  }
})

program
  .name('hackfed-toolbox')
  .description('CLI toolbox for HackFed participants')
  .version(process.env.npm_package_version ?? '0.0.0')

// Register commands
commandCheckRegistry(program, logger)
generateTelephony(program, logger)
generateWireGuard(program, logger)

program.parse()
