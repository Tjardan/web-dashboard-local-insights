/**
 * Source Connector Registry
 * Extensible system for adding new data sources.
 */
import type { SourceConnector, SourceType } from '@/types'

const registry = new Map<SourceType, SourceConnector>()

export function registerSourceConnector(connector: SourceConnector) {
  registry.set(connector.type, connector)
}

export function getConnector(type: SourceType): SourceConnector | undefined {
  return registry.get(type)
}

export function getAllConnectors(): SourceConnector[] {
  return Array.from(registry.values())
}

export function getConnectorTypes(): SourceType[] {
  return Array.from(registry.keys())
}
