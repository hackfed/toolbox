import type { Command } from 'commander'

import {
  OrganizationSchema,
  type WireguardDirectory,
  type WireguardDirectoryOrg,
  WireguardDirectorySchema,
} from '@hackfed/schemas/v1'
import { Glob, YAML } from 'bun'
import path from 'node:path'
import { type Logger } from 'tslog'

interface CommandOptions {
  output: string
}

export default function register (program: Command, rootLogger: Logger<unknown>) {
  const logger = rootLogger.getSubLogger({ name: 'GenerateWireguard' })

  program.command('generate-wireguard')
    .description('Generate the WireGuard directory index')
    .argument('<path>', 'path to the registry folder')
    .option('-o, --output <file>', 'output file for the generated directory', 'wireguard-directory.json')
    .action((directory: string, options: CommandOptions) => generateWireguardDirectory(directory, options, logger))
}

/**
 * Generates a WireGuard directory for HackFed organizations.
 * @param registry Path to registry root directory
 */
async function generateWireguardDirectory (
  registry: string,
  options: CommandOptions,
  logger: Logger<unknown>
): Promise<void> {
  const registryPath = path.resolve(registry)
  logger.info(`Checking registry at: ${registryPath}`)

  const orgs: WireguardDirectoryOrg[] = []

  // Parse and check organization files
  const glob = new Glob('orgs/*.yaml')
  for await (const filePath of glob.scan(registryPath)) {
    const file = await Bun.file(path.resolve(registryPath, filePath)).text()
    const org = OrganizationSchema.parse(
      YAML.parse(file)
    )

    // Skip organizations without telephony services or exchanges
    if (!org.spec.services?.wireguard || org.spec.services.wireguard.length === 0) {
      continue
    }

    orgs.push({
      name: org.spec.name,
      orgId: org.spec.id,
      peers: org.spec.services.wireguard.map(p => ({
        address: p.address,
        endpoint: p.endpoint,
        publicKey: p.publicKey,
      })),
    })

    logger.debug('Added organization: %s (%s)', org.spec.name, org.spec.id)
  }

  const directory = WireguardDirectorySchema.parse({
    orgs,
  } satisfies WireguardDirectory)

  const file = Bun.file(path.resolve(options.output))
  await Bun.write(file, JSON.stringify(directory))
}
