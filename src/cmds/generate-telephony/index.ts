import type { Command } from 'commander'

import { OrganizationSchema, type TelephonyDirectory, type TelephonyDirectoryExchange, type TelephonyDirectoryOrg } from '@hackfed/schemas/v1'
import { Glob, YAML } from 'bun'
import path from 'node:path'
import { type Logger } from 'tslog'

interface CommandOptions {
  output: string
}

export default function register (program: Command, rootLogger: Logger<unknown>) {
  const logger = rootLogger.getSubLogger({ name: 'GenerateTelephony' })

  program.command('generate-telephony')
    .description('Generate the telephony directory')
    .argument('<path>', 'path to the registry folder')
    .option('-o, --output <file>', 'output file for the generated directory', 'telephony-directory.json')
    .action((directory: string, options: CommandOptions) => generateTelephonyDirectory(directory, options, logger))
}

/**
 * Generates a telephony directory for HackFed organizations.
 * @param registry Path to registry root directory
 */
async function generateTelephonyDirectory (
  registry: string,
  options: CommandOptions,
  logger: Logger<unknown>
): Promise<void> {
  const registryPath = path.resolve(registry)
  logger.info(`Checking registry at: ${registryPath}`)

  const orgs: TelephonyDirectoryOrg[] = []

  // Parse and check organization files
  const glob = new Glob('orgs/*.yaml')
  for await (const file of glob.scan(registryPath)) {
    const org = OrganizationSchema.parse(
      YAML.parse(await Bun.file(path.resolve(registryPath, file)).text())
    )

    if (!org.spec.services?.telephony) {
      continue
    }

    // Map prefixes to exchanges
    const exchangePrefixes = new Map<string, Set<string>>()
    for (const prefix of org.spec.services.telephony.prefixes ?? []) {
      const prefixes = exchangePrefixes.get(prefix.exchange) ?? new Set<string>()
      prefixes.add(prefix.prefix)
      exchangePrefixes.set(prefix.exchange, prefixes)
    }

    // Map exchanges
    const exchanges = new Map<string, TelephonyDirectoryExchange>()
    for (const exchange of org.spec.services.telephony.exchanges ?? []) {
      exchanges.set(exchange.id, {
        codecs: exchange.codecs,
        endpoint: exchange.address,
        id: exchange.id,
        prefixes: [...exchangePrefixes.get(exchange.id) ?? []],
        protocol: exchange.protocol
      })
    }

    orgs.push({
      exchanges: [...exchanges.values()],
      name: org.spec.name,
      orgId: org.spec.id,
      phonebooks: org.spec.services.telephony.phonebook ?? []
    })

    logger.debug('Added organization: %s (%s)', org.spec.name, org.spec.id)
  }

  const directory: TelephonyDirectory = {
    orgs,
  }

  const file = Bun.file(path.resolve(options.output))
  await Bun.write(file, JSON.stringify(directory))
}
