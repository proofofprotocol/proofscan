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
