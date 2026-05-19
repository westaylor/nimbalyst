/**
 * Encryption key for the `ai-settings` electron-store file.
 *
 * The `ai-settings` store holds provider API keys (Anthropic, OpenAI, etc.).
 * Passing this key as electron-store's `encryptionKey` option encrypts the
 * file at rest so the keys are not readable as plaintext from disk backups,
 * log scrapers, or other local processes.
 *
 * SECURITY NOTE: this key is a constant embedded in the application bundle.
 * It defeats casual at-rest exposure, but a determined local attacker who
 * also has the app binary can recover it. For genuine protection consider
 * migrating to the OS keychain (`safeStorage`). See _security-review/ M1.
 *
 * EVERY `new Store({ name: 'ai-settings' })` in the codebase MUST pass this
 * key. A store opened without it cannot decrypt the file and would read it
 * as empty. electron-store transparently reads a pre-existing unencrypted
 * `ai-settings.json` and re-encrypts it on the next write.
 */
export const AI_SETTINGS_ENCRYPTION_KEY =
  '511d022dd28e7b47d3e3db7d07c8e20d889a90913a4af7e9ec0864eb30cb203a';
