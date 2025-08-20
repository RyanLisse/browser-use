/**
 * @fileoverview Production-ready configuration management
 * Epic 4.4: Add production-ready configuration management
 */

import { Context, Effect, Layer, Ref, Schedule } from 'effect'
import { Config } from 'effect'
import { BrowserSessionError } from '../errors'
import type { AppConfig, BrowserConfig, CDPConfig } from './index'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Configuration environment
 */
export type Environment = 'development' | 'staging' | 'production' | 'testing'

/**
 * Configuration source priority
 */
export type ConfigSource = 'environment' | 'file' | 'vault' | 'remote' | 'default'

/**
 * Configuration value with metadata
 */
export interface ConfigValue<T = unknown> {
	readonly value: T
	readonly source: ConfigSource
	readonly timestamp: number
	readonly encrypted: boolean
	readonly sensitive: boolean
	readonly version?: string
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
	readonly key: string
	readonly oldValue: unknown
	readonly newValue: unknown
	readonly source: ConfigSource
	readonly timestamp: number
	readonly environment: Environment
}

/**
 * Configuration validation rule
 */
export interface ConfigValidationRule<T = unknown> {
	readonly key: string
	readonly validator: (value: T) => boolean | string
	readonly required: boolean
	readonly description: string
}

/**
 * Configuration schema
 */
export interface ConfigSchema {
	readonly rules: readonly ConfigValidationRule[]
	readonly environments: readonly Environment[]
	readonly version: string
}

/**
 * Secrets configuration
 */
export interface SecretsConfig {
	readonly encryption: {
		readonly algorithm: string
		readonly keyPath?: string
		readonly key?: string
	}
	readonly vault: {
		readonly enabled: boolean
		readonly url?: string
		readonly token?: string
		readonly path?: string
	}
}

/**
 * Production configuration
 */
export interface ProductionConfig extends AppConfig {
	readonly environment: Environment
	readonly secrets: SecretsConfig
	readonly monitoring: {
		readonly enabled: boolean
		readonly endpoint?: string
		readonly apiKey?: string
		readonly interval: number
	}
	readonly scaling: {
		readonly maxInstances: number
		readonly maxMemory: number // MB
		readonly maxCpuPercent: number
	}
	readonly security: {
		readonly allowedOrigins: readonly string[]
		readonly rateLimit: {
			readonly requests: number
			readonly windowMs: number
		}
		readonly cors: boolean
	}
	readonly features: {
		readonly flags: Record<string, boolean>
		readonly experiments: Record<string, number> // 0-1 percentage
	}
}

/**
 * Configuration service interface
 */
export interface ConfigurationServiceInterface {
	readonly get: <T>(
		key: string,
		defaultValue?: T
	) => Effect.Effect<T, BrowserSessionError>
	
	readonly getAll: () => Effect.Effect<ProductionConfig, BrowserSessionError>
	
	readonly set: <T>(
		key: string,
		value: T,
		source?: ConfigSource
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly reload: () => Effect.Effect<void, BrowserSessionError>
	
	readonly validate: () => Effect.Effect<readonly string[], never>
	
	readonly encrypt: (
		value: string
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly decrypt: (
		encryptedValue: string
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly watch: (
		key: string,
		callback: (change: ConfigChangeEvent) => void
	) => Effect.Effect<() => void, never>
	
	readonly getHistory: (
		key?: string
	) => Effect.Effect<readonly ConfigChangeEvent[], never>
	
	readonly exportConfig: (
		environment?: Environment,
		includeSecrets?: boolean
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly importConfig: (
		configData: string,
		merge?: boolean
	) => Effect.Effect<void, BrowserSessionError>
}

/**
 * Configuration service context tag
 */
export const ConfigurationService = Context.GenericTag<ConfigurationServiceInterface>('ConfigurationService')

/**
 * Default production configuration schema
 */
export const productionConfigSchema: ConfigSchema = {
	rules: [
		{
			key: 'environment',
			validator: (value: string) => ['development', 'staging', 'production', 'testing'].includes(value),
			required: true,
			description: 'Deployment environment'
		},
		{
			key: 'browser.timeout',
			validator: (value: number) => typeof value === 'number' && value > 0 && value <= 300000,
			required: true,
			description: 'Browser timeout in milliseconds (max 5 minutes)'
		},
		{
			key: 'cdp.port',
			validator: (value: number) => typeof value === 'number' && value > 0 && value < 65536,
			required: true,
			description: 'CDP port number'
		},
		{
			key: 'scaling.maxInstances',
			validator: (value: number) => typeof value === 'number' && value > 0 && value <= 100,
			required: false,
			description: 'Maximum number of instances'
		},
		{
			key: 'scaling.maxMemory',
			validator: (value: number) => typeof value === 'number' && value > 0 && value <= 16384,
			required: false,
			description: 'Maximum memory usage in MB'
		}
	],
	environments: ['development', 'staging', 'production', 'testing'],
	version: '1.0.0'
}

/**
 * Create configuration service implementation
 */
const makeConfigurationService = (
	environment: Environment = 'development',
	configPaths: readonly string[] = ['./config', './config.json', '/etc/browser-use']
) =>
	Effect.gen(function* () {
		// Configuration state
		const config = yield* Ref.make(new Map<string, ConfigValue>())
		const watchers = yield* Ref.make(new Map<string, Array<(change: ConfigChangeEvent) => void>>())
		const changeHistory = yield* Ref.make<readonly ConfigChangeEvent[]>([])
		
		// Encryption key (in production, this should be from secure storage)
		const encryptionKey = process.env.CONFIG_ENCRYPTION_KEY || 'default-key-change-in-production'
		
		/**
		 * Encrypt a configuration value
		 */
		const encrypt = (value: string): Effect.Effect<string, BrowserSessionError> =>
			Effect.gen(function* () {
				try {
					const cipher = crypto.createCipher('aes-256-cbc', encryptionKey)
					let encrypted = cipher.update(value, 'utf8', 'hex')
					encrypted += cipher.final('hex')
					return `encrypted:${encrypted}`
				} catch (error) {
					yield* Effect.fail(new BrowserSessionError({
						message: 'Failed to encrypt configuration value',
						cause: error
					}))
				}
			})
		
		/**
		 * Decrypt a configuration value
		 */
		const decrypt = (encryptedValue: string): Effect.Effect<string, BrowserSessionError> =>
			Effect.gen(function* () {
				try {
					if (!encryptedValue.startsWith('encrypted:')) {
						return encryptedValue // Not encrypted
					}
					
					const encryptedData = encryptedValue.substring(10) // Remove 'encrypted:' prefix
					const decipher = crypto.createDecipher('aes-256-cbc', encryptionKey)
					let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
					decrypted += decipher.final('utf8')
					return decrypted
				} catch (error) {
					yield* Effect.fail(new BrowserSessionError({
						message: 'Failed to decrypt configuration value',
						cause: error
					}))
				}
			})
		
		/**
		 * Load configuration from various sources
		 */
		const loadFromSources = (): Effect.Effect<void, BrowserSessionError> =>
			Effect.gen(function* () {
				const configMap = yield* Ref.get(config)
				
				// Load from environment variables
				const envConfig: Partial<ProductionConfig> = {
					environment: (process.env.NODE_ENV as Environment) || environment,
					browser: {
						headless: process.env.BROWSER_HEADLESS === 'true',
						viewport: {
							width: parseInt(process.env.BROWSER_VIEWPORT_WIDTH || '1280'),
							height: parseInt(process.env.BROWSER_VIEWPORT_HEIGHT || '720')
						},
						timeout: parseInt(process.env.BROWSER_TIMEOUT || '30000'),
						retryAttempts: parseInt(process.env.BROWSER_RETRY_ATTEMPTS || '3')
					},
					cdp: {
						host: process.env.CDP_HOST || 'localhost',
						port: parseInt(process.env.CDP_PORT || '9222'),
						secure: process.env.CDP_SECURE === 'true',
						connectionTimeout: parseInt(process.env.CDP_CONNECTION_TIMEOUT || '10000')
					},
					logLevel: (process.env.LOG_LEVEL as any) || 'info',
					secrets: {
						encryption: {
							algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-cbc',
							keyPath: process.env.ENCRYPTION_KEY_PATH,
							key: process.env.ENCRYPTION_KEY
						},
						vault: {
							enabled: process.env.VAULT_ENABLED === 'true',
							url: process.env.VAULT_URL,
							token: process.env.VAULT_TOKEN,
							path: process.env.VAULT_PATH
						}
					},
					monitoring: {
						enabled: process.env.MONITORING_ENABLED === 'true',
						endpoint: process.env.MONITORING_ENDPOINT,
						apiKey: process.env.MONITORING_API_KEY,
						interval: parseInt(process.env.MONITORING_INTERVAL || '60000')
					},
					scaling: {
						maxInstances: parseInt(process.env.MAX_INSTANCES || '10'),
						maxMemory: parseInt(process.env.MAX_MEMORY || '2048'),
						maxCpuPercent: parseInt(process.env.MAX_CPU_PERCENT || '80')
					},
					security: {
						allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['*'],
						rateLimit: {
							requests: parseInt(process.env.RATE_LIMIT_REQUESTS || '100'),
							windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000')
						},
						cors: process.env.CORS_ENABLED !== 'false'
					},
					features: {
						flags: JSON.parse(process.env.FEATURE_FLAGS || '{}'),
						experiments: JSON.parse(process.env.FEATURE_EXPERIMENTS || '{}')
					}
				}
				
				// Store environment config
				yield* Effect.forEach(
					Object.entries(flattenObject(envConfig)),
					([key, value]) => Effect.gen(function* () {
						if (value !== undefined) {
							const configValue: ConfigValue = {
								value,
								source: 'environment',
								timestamp: Date.now(),
								encrypted: false,
								sensitive: key.includes('token') || key.includes('key') || key.includes('secret')
							}
							
							yield* Ref.update(config, map => new Map(map).set(key, configValue))
						}
					})
				)
				
				// Load from configuration files
				yield* Effect.forEach(
					configPaths,
					(configPath) => Effect.gen(function* () {
						if (yield* Effect.attempt(() => fs.existsSync(configPath)).pipe(Effect.orElse(() => Effect.succeed(false)))) {
							try {
								const fileContent = yield* Effect.attempt(() => fs.readFileSync(configPath, 'utf8'))
								const fileConfig = JSON.parse(fileContent)
								
								yield* Effect.forEach(
									Object.entries(flattenObject(fileConfig)),
									([key, value]) => Effect.gen(function* () {
										// Only set if not already set by environment
										const existing = configMap.get(key)
										if (!existing || existing.source !== 'environment') {
											const configValue: ConfigValue = {
												value,
												source: 'file',
												timestamp: Date.now(),
												encrypted: false,
												sensitive: key.includes('token') || key.includes('key') || key.includes('secret')
											}
											
											yield* Ref.update(config, map => new Map(map).set(key, configValue))
										}
									})
								)
							} catch (error) {
								yield* Effect.logWarn(`Failed to load config from ${configPath}: ${error}`)
							}
						}
					})
				)
			})
		
		/**
		 * Flatten nested object for easier key access
		 */
		const flattenObject = (obj: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
			const result: Record<string, unknown> = {}
			
			for (const [key, value] of Object.entries(obj)) {
				const fullKey = prefix ? `${prefix}.${key}` : key
				
				if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
					Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey))
				} else {
					result[fullKey] = value
				}
			}
			
			return result
		}
		
		/**
		 * Unflatten object back to nested structure
		 */
		const unflattenObject = (flatObj: Record<string, unknown>): Record<string, unknown> => {
			const result: Record<string, unknown> = {}
			
			for (const [key, value] of Object.entries(flatObj)) {
				const keys = key.split('.')
				let current = result
				
				for (let i = 0; i < keys.length - 1; i++) {
					if (!(keys[i] in current)) {
						current[keys[i]] = {}
					}
					current = current[keys[i]] as Record<string, unknown>
				}
				
				current[keys[keys.length - 1]] = value
			}
			
			return result
		}
		
		/**
		 * Get configuration value
		 */
		const get = <T>(key: string, defaultValue?: T): Effect.Effect<T, BrowserSessionError> =>
			Effect.gen(function* () {
				const configMap = yield* Ref.get(config)
				const configValue = configMap.get(key)
				
				if (!configValue) {
					if (defaultValue !== undefined) {
						return defaultValue
					}
					
					yield* Effect.fail(new BrowserSessionError({
						message: `Configuration key not found: ${key}`
					}))
				}
				
				let value = configValue.value
				
				// Decrypt if encrypted
				if (configValue.encrypted || (typeof value === 'string' && value.startsWith('encrypted:'))) {
					value = yield* decrypt(value as string)
				}
				
				return value as T
			})
		
		/**
		 * Get all configuration
		 */
		const getAll = (): Effect.Effect<ProductionConfig, BrowserSessionError> =>
			Effect.gen(function* () {
				const configMap = yield* Ref.get(config)
				const flatConfig: Record<string, unknown> = {}
				
				// Collect all values and decrypt if needed
				for (const [key, configValue] of configMap.entries()) {
					let value = configValue.value
					
					if (configValue.encrypted || (typeof value === 'string' && value.startsWith('encrypted:'))) {
						value = yield* decrypt(value as string)
					}
					
					flatConfig[key] = value
				}
				
				return unflattenObject(flatConfig) as ProductionConfig
			})
		
		/**
		 * Set configuration value
		 */
		const set = <T>(key: string, value: T, source: ConfigSource = 'default'): Effect.Effect<void, BrowserSessionError> =>
			Effect.gen(function* () {
				const configMap = yield* Ref.get(config)
				const oldValue = configMap.get(key)
				
				const configValue: ConfigValue<T> = {
					value,
					source,
					timestamp: Date.now(),
					encrypted: false,
					sensitive: key.includes('token') || key.includes('key') || key.includes('secret')
				}
				
				yield* Ref.update(config, map => new Map(map).set(key, configValue))
				
				// Notify watchers
				const watchersMap = yield* Ref.get(watchers)
				const keyWatchers = watchersMap.get(key) || []
				
				const changeEvent: ConfigChangeEvent = {
					key,
					oldValue: oldValue?.value,
					newValue: value,
					source,
					timestamp: Date.now(),
					environment
				}
				
				// Add to history
				yield* Ref.update(changeHistory, history => [...history.slice(-99), changeEvent]) // Keep last 100 changes
				
				// Notify watchers
				keyWatchers.forEach(callback => callback(changeEvent))
			})
		
		/**
		 * Reload configuration
		 */
		const reload = (): Effect.Effect<void, BrowserSessionError> =>
			Effect.gen(function* () {
				yield* Effect.logInfo('Reloading configuration from all sources')
				yield* loadFromSources()
				yield* Effect.logInfo('Configuration reloaded successfully')
			})
		
		/**
		 * Validate configuration
		 */
		const validate = (): Effect.Effect<readonly string[], never> =>
			Effect.gen(function* () {
				const configMap = yield* Ref.get(config)
				const errors: string[] = []
				
				for (const rule of productionConfigSchema.rules) {
					const configValue = configMap.get(rule.key)
					
					if (rule.required && !configValue) {
						errors.push(`Required configuration key missing: ${rule.key}`)
						continue
					}
					
					if (configValue) {
						const validation = rule.validator(configValue.value)
						if (validation !== true) {
							errors.push(`Invalid configuration for ${rule.key}: ${typeof validation === 'string' ? validation : 'validation failed'}`)
						}
					}
				}
				
				return errors
			})
		
		/**
		 * Watch for configuration changes
		 */
		const watch = (
			key: string,
			callback: (change: ConfigChangeEvent) => void
		): Effect.Effect<() => void, never> =>
			Effect.gen(function* () {
				yield* Ref.update(watchers, watchersMap => {
					const existing = watchersMap.get(key) || []
					return new Map(watchersMap).set(key, [...existing, callback])
				})
				
				// Return unwatch function
				return () => {
					Effect.runSync(
						Ref.update(watchers, watchersMap => {
							const existing = watchersMap.get(key) || []
							const filtered = existing.filter(cb => cb !== callback)
							return new Map(watchersMap).set(key, filtered)
						})
					)
				}
			})
		
		/**
		 * Get configuration change history
		 */
		const getHistory = (key?: string): Effect.Effect<readonly ConfigChangeEvent[], never> =>
			Effect.gen(function* () {
				const history = yield* Ref.get(changeHistory)
				
				if (key) {
					return history.filter(event => event.key === key)
				}
				
				return history
			})
		
		/**
		 * Export configuration
		 */
		const exportConfig = (
			targetEnvironment: Environment = environment,
			includeSecrets = false
		): Effect.Effect<string, BrowserSessionError> =>
			Effect.gen(function* () {
				const configMap = yield* Ref.get(config)
				const exportData: Record<string, unknown> = {
					environment: targetEnvironment,
					timestamp: Date.now(),
					version: productionConfigSchema.version
				}
				
				for (const [key, configValue] of configMap.entries()) {
					// Skip secrets unless explicitly requested
					if (configValue.sensitive && !includeSecrets) {
						continue
					}
					
					exportData[key] = {
						value: configValue.value,
						source: configValue.source,
						timestamp: configValue.timestamp
					}
				}
				
				return JSON.stringify(exportData, null, 2)
			})
		
		/**
		 * Import configuration
		 */
		const importConfig = (
			configData: string,
			merge = false
		): Effect.Effect<void, BrowserSessionError> =>
			Effect.gen(function* () {
				try {
					const importedData = JSON.parse(configData)
					
					if (!merge) {
						yield* Ref.set(config, new Map())
					}
					
					for (const [key, data] of Object.entries(importedData)) {
						if (key === 'environment' || key === 'timestamp' || key === 'version') {
							continue
						}
						
						const configData = data as { value: unknown; source: ConfigSource; timestamp: number }
						const configValue: ConfigValue = {
							value: configData.value,
							source: configData.source || 'file',
							timestamp: configData.timestamp || Date.now(),
							encrypted: false,
							sensitive: key.includes('token') || key.includes('key') || key.includes('secret')
						}
						
						yield* Ref.update(config, map => new Map(map).set(key, configValue))
					}
					
					yield* Effect.logInfo('Configuration imported successfully')
				} catch (error) {
					yield* Effect.fail(new BrowserSessionError({
						message: 'Failed to import configuration',
						cause: error
					}))
				}
			})
		
		// Initialize configuration
		yield* loadFromSources()
		
		// Start configuration refresh in background
		yield* Effect.fork(
			Effect.repeat(
				reload().pipe(Effect.ignore),
				Schedule.fixed(60000) // Refresh every minute
			)
		)
		
		// Validate configuration on startup
		const validationErrors = yield* validate()
		if (validationErrors.length > 0) {
			yield* Effect.logWarn('Configuration validation errors:', validationErrors)
		}
		
		return {
			get,
			getAll,
			set,
			reload,
			validate,
			encrypt,
			decrypt,
			watch,
			getHistory,
			exportConfig,
			importConfig
		} satisfies ConfigurationServiceInterface
	})

/**
 * Configuration service layer
 */
export const ConfigurationServiceLive = (
	environment: Environment = 'development',
	configPaths?: readonly string[]
) =>
	Layer.effect(
		ConfigurationService,
		makeConfigurationService(environment, configPaths)
	)

/**
 * Get production configuration with validation
 */
export const getValidatedConfig = (): Effect.Effect<ProductionConfig, BrowserSessionError> =>
	Effect.gen(function* () {
		const configService = yield* ConfigurationService
		const errors = yield* configService.validate()
		
		if (errors.length > 0) {
			yield* Effect.fail(new BrowserSessionError({
				message: `Configuration validation failed: ${errors.join(', ')}`
			}))
		}
		
		return yield* configService.getAll()
	})

/**
 * Environment-specific configuration helpers
 */
export const isDevelopment = (): Effect.Effect<boolean, BrowserSessionError> =>
	Effect.gen(function* () {
		const configService = yield* ConfigurationService
		const env = yield* configService.get<Environment>('environment')
		return env === 'development'
	})

export const isProduction = (): Effect.Effect<boolean, BrowserSessionError> =>
	Effect.gen(function* () {
		const configService = yield* ConfigurationService
		const env = yield* configService.get<Environment>('environment')
		return env === 'production'
	})