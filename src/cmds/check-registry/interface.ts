import type { Organization } from '@hackfed/schemas/v1'
import type { Logger } from 'tslog'

export interface CheckServiceContext {
  logger: Logger<unknown>
  orgs: OrganizationMap
  registryPath: string
}

export type OrganizationMap = Map<string, Organization>
