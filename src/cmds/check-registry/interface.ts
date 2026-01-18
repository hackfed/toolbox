import type { Organization } from '@hackfed/schemas/v1'
import type { Logger } from 'tslog'

export type OrganizationMap = Map<string, Organization>

export interface CheckServiceContext {
  logger: Logger<unknown>
  orgs: OrganizationMap
  registryPath: string
}
