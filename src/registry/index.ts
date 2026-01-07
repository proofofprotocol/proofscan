/**
 * Registry module exports
 */

export {
  RegistryClient,
  RegistryError,
  type ServerInfo,
  type ServerTransport,
  type RegistryClientOptions,
  SUPPORTED_FIELDS,
  type SupportedField,
  isSupportedField,
  getFieldValue,
  formatFieldValue,
} from './client.js';

export {
  type CatalogSource,
  type SecretResolver,
  CATALOG_SOURCES,
  DEFAULT_CATALOG_SOURCE,
  getSourceNames,
  getSource,
  isValidSource,
  setSecretResolver,
  getSourceApiKey,
  isSourceReady,
  getAuthErrorMessage,
  formatSourceLine,
} from './sources.js';
