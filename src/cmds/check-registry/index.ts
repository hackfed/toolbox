import type { Command } from 'commander'

import { type Organization, OrganizationSchema } from '@hackfed/schemas/v1'
import { Glob, YAML } from 'bun'
import ipaddr from 'ipaddr.js'
import path from 'node:path'
import { type Logger } from 'tslog'

import type { CheckServiceContext, OrganizationMap } from './interface'

/**
 * IPv6 prefix for HackFed Nebula network.
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
 * Check the Hackfed registry located at the given directory.
 * @param directory Path to registry root directory
 */
async function checkRegistry (directory: string, logger: Logger<unknown>): Promise<void> {
  const registryPath = path.resolve(directory)
  logger.info(`Checking registry at: ${registryPath}`)

  await checkOrganizations(registryPath, logger)
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
  await checkNebulaService(context)
  await checkTelephonyService(context)

  logger.info('🎉 Registry check completed successfully.')
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

  // Verify that API version is supported
  if (parsed.apiVersion !== 'hackfed/v1') {
    logger.error(`Unsupported API version: ${parsed.apiVersion} in file: ${orgPath}`)
    process.exit(1)
  }

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
 * Check Nebula services across organizations.
 * @param context Service check context
 */
async function checkNebulaService (context: CheckServiceContext): Promise<void> {
  const addresses = new Set<string>()
  const prefix = ipaddr.parseCIDR(HACKFED_NET_TELEPHONY_PREFIX)

  for (const [, org] of context.orgs) {
    if (!org.spec.services?.nebula) {
      continue
    }

    for (const nebulaNode of org.spec.services.nebula) {
      // Check that address is in the HackFed Nebula network
      const addr = ipaddr.parse(nebulaNode.address)
      // eslint-disable-next-line unicorn/prefer-regexp-test -- this is not a regexp
      if (!addr.match(prefix)) {
        context.logger.error('(%s) invalid Nebula address: %s', org.spec.id, nebulaNode.address)
        process.exit(1)
      }

      // Check for duplicate Nebula addresses
      if (addresses.has(nebulaNode.address)) {
        context.logger.error('(%s) duplicate Nebula address found: %s', org.spec.id, nebulaNode.address)
        process.exit(1)
      }

      // Check that listed certificate fingerprints exist
      for await (const fingerprint of nebulaNode.certificates) {
        const certPath = path.resolve(context.registryPath, 'nebula/certificates', `${fingerprint}.crt`)
        const file = Bun.file(certPath)
        if (!await file.exists()) {
          context.logger.error('(%s) Nebula certificate not found: %s', org.spec.id, fingerprint)
          process.exit(1)
        }
      }

      // Verify Lighthouse endpoints
      if (nebulaNode.lighthouse?.endpoints) {
        for (const endpoint of nebulaNode.lighthouse.endpoints) {
          try {
            const url = new URL(`nebula://${endpoint}`)
            if (!url.port) {
              context.logger.error('(%s) Lighthouse endpoint missing port: %s', org.spec.id, endpoint)
              process.exit(1)
            }
          } catch {
            context.logger.error('(%s) invalid Lighthouse endpoint URL: %s', org.spec.id, endpoint)
            process.exit(1)
          }
        }
      }

      addresses.add(nebulaNode.address)
    }
  }
}

/**
 * Check Telephony services across organizations.
 * @param context Service check context
 */
async function checkTelephonyService (context: CheckServiceContext): Promise<void> {
  const prefixes = new Set<string>()

  for (const [, org] of context.orgs) {
    if (!org.spec.services?.telephony) {
      continue
    }

    const orgExchanges = new Set<string>()
    const orgPrefixes = new Set<string>()

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

        orgExchanges.add(exchange.id)
      }
    }

    if (org.spec.services.telephony.prefixes) {
      for (const prefix of org.spec.services.telephony.prefixes) {
        // Check for duplicate prefixes across organizations
        if (prefixes.has(prefix.prefix)) {
          context.logger.error('(%s) duplicate Telephony prefix found: %s', org.spec.id, prefix.prefix)
          process.exit(1)
        }

        // Check for duplicate prefixes within organization
        if (orgPrefixes.has(prefix.prefix)) {
          context.logger.error('(%s) duplicate Telephony prefix found within organization: %s', org.spec.id, prefix.prefix)
          process.exit(1)
        }

        // Verify that referenced exchange exists
        if (!orgExchanges.has(prefix.exchange)) {
          context.logger.error('(%s) Telephony prefix references unknown exchange: %s', org.spec.id, prefix.exchange)
          process.exit(1)
        }

        prefixes.add(prefix.prefix)
        orgPrefixes.add(prefix.prefix)
      }
    }
  }
}
