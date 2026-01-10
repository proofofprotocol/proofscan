/**
 * Registry module exports
 */

export {
  RegistryClient,
  RegistryError,
  type ServerInfo,
  type ServerTransport,
  type PackageInfo,
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
  type SourceType,
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

export {
  type TrustLevel,
  type TrustRoot,
  type TrustInfo,
  type CatalogSecurityConfig,
  DEFAULT_TRUSTED_NPM_SCOPES,
  determineTrust,
  shouldAllowInstall,
  getInstallWarning,
  formatTrustBadge,
  formatTrustBadgeColor,
} from './trust.js';

export {
  GitHubRegistryClient,
  githubClient,
  REFERENCE_SERVER_DIRS,
  FALLBACK_SERVERS,
} from './github-client.js';

export {
  NpmRegistryClient,
  npmClient,
  type NpmSearchOptions,
} from './npm-client.js';
