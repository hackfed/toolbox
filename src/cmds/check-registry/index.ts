import type { Command } from 'commander'

import { type Organization, OrganizationSchema } from '@hackfed/schemas/v1'
import { Glob, YAML } from 'bun'
import ipaddr from 'ipaddr.js'
import path from 'node:path'
import { type Logger } from 'tslog'

import type { CheckServiceContext, OrganizationMap } from './interface'

/**
 * IPv6 prefix for HackFed network.
 */
const HACKFED_NET_TELEPHONY_PREFIX = 'fd79:7636:1f08:883d::/64'

export default function register (program: Command, rootLogger: Logger<unknown>) {
  const logger = rootLogger.getSubLogger({ name: 'CheckRegistry' })

  program.command('check-registry')
    .description('Sanity check the Hackfed registry')
    .argument('<path>', 'path to the registry folder')
    .action((directory: string) => checkRegistry(directory, logger))
}

/**
 * Checks a particular organization resource definition.
 * @param orgPath Path to organization resource definition file
 * @returns Organization Resource Definition
 */
async function checkOrganization (orgPath: string, logger: Logger<unknown>): Promise<Organization> {
  logger.debug(`Checking organization file: ${orgPath}`)

  const raw = YAML.parse(await Bun.file(orgPath).text())
  const parsed = OrganizationSchema.parse(raw)

  // Verify that organization IDs are consistent
  {
    const fileName = path.basename(orgPath, path.extname(orgPath))
    if (parsed.metadata.orgId !== fileName) {
      logger.error('(%s): metadata orgId mismatch "%s"', fileName, parsed.metadata.orgId)
      process.exit(1)
    }

    if (parsed.metadata.orgId !== parsed.spec.id) {
      logger.error('(%s): spec orgId mismatch "%s"', fileName, parsed.spec.id)
      process.exit(1)
    }
  }

  return parsed
}

/**
 * Checks organization resource definitions in the registry.
 * @param registryPath Path to registry root directory
 */
async function checkOrganizations (registryPath: string, logger: Logger<unknown>): Promise<void> {
  const glob = new Glob('orgs/*.yaml')
  const orgs: OrganizationMap = new Map()

  // Parse and check organization files
  for await (const file of glob.scan(registryPath)) {
    const org = await checkOrganization(path.resolve(registryPath, file), logger)
    orgs.set(org.spec.id, org)
  }

  // Warn if no organizations found
  if (orgs.size === 0) {
    logger.warn('No organizations found in registry!')
    process.exit(0)
  }

  // Check services across organizations
  const context: CheckServiceContext = { logger, orgs, registryPath }
  checkTelephonyService(context)
  checkWireguardService(context)

  logger.info('🎉 Registry check completed successfully.')
}

/**
 * Check the Hackfed registry located at the given directory.
 * @param directory Path to registry root directory
 */
async function checkRegistry (directory: string, logger: Logger<unknown>): Promise<void> {
  const registryPath = path.resolve(directory)
  logger.info(`Checking registry at: ${registryPath}`)

  await checkOrganizations(registryPath, logger)
}

/**
 * Check Telephony services across organizations.
 * @param context Service check context
 */
function checkTelephonyService (context: CheckServiceContext): void {
  const prefixes = new Set<string>()

  for (const [, org] of context.orgs) {
    if (!org.spec.services?.telephony) {
      continue
    }

    const orgExchanges = new Set<string>()

    if (org.spec.services.telephony.exchanges) {
      for (const exchange of org.spec.services.telephony.exchanges) {
        // Check for duplicate exchange IDs within organization
        if (orgExchanges.has(exchange.id)) {
          context.logger.error('(%s) duplicate Telephony exchange ID found: %s', org.spec.id, exchange.id)
          process.exit(1)
        }

        // Verify exchange address
        try {
          const url = new URL(`sip://${exchange.address}`)
          if (!url.port) {
            context.logger.error('(%s) Exchange address missing port: %s', org.spec.id, exchange.address)
            process.exit(1)
          }
        } catch {
          context.logger.error('(%s) invalid Exchange address URL: %s', org.spec.id, exchange.address)
          process.exit(1)
        }

        // Check for duplicate prefixes across organizations
        if (prefixes.has(exchange.prefix)) {
          context.logger.error('(%s) duplicate Telephony prefix found: %s', org.spec.id, exchange.prefix)
          process.exit(1)
        }

        prefixes.add(exchange.prefix)
        orgExchanges.add(exchange.id)
      }
    }
  }
}

function checkWireguardService (context: CheckServiceContext): void {
  const addresses = new Set<string>()
  const prefix = ipaddr.parseCIDR(HACKFED_NET_TELEPHONY_PREFIX)

  for (const [, org] of context.orgs) {
    if (!org.spec.services?.wireguard) {
      continue
    }

    for (const wgNode of org.spec.services.wireguard) {
      // Check that address is in the HackFed Wireguard network
      const addr = ipaddr.parse(wgNode.address)

      if (!addr.match(prefix)) {
        context.logger.error('(%s) invalid Wireguard address: %s', org.spec.id, wgNode.address)
        process.exit(1)
      }

      // Check for duplicate Wireguard addresses
      if (addresses.has(wgNode.address)) {
        context.logger.error('(%s) duplicate Wireguard address found: %s', org.spec.id, wgNode.address)
        process.exit(1)
      }

      // Check that public endpoint is a valid address
      try {
        const url = new URL(`wg://${wgNode.endpoint}`)

        // If hostname appears to be an IP address, verify that it's not an internal HackFed address
        if (ipaddr.isValid(url.hostname)) {
          const endpointAddr = ipaddr.parse(url.hostname)
          if (endpointAddr.match(prefix)) {
            context.logger.error('(%s) Wireguard endpoint cannot be an internal HackFed address: %s', org.spec.id, wgNode.endpoint)
            process.exit(1)
          }
        }
      } catch {
        context.logger.error('(%s) invalid Wireguard endpoint URL: %s', org.spec.id, wgNode.endpoint)
        process.exit(1)
      }

      addresses.add(wgNode.address)
    }
  }
}
