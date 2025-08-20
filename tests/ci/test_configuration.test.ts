/**
 * @fileoverview Tests for Epic 4.4: Production-ready configuration management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect, Layer } from 'effect'
import { ConfigurationService, ConfigurationServiceLive, productionConfigSchema, type Environment } from '../../src/config/production'
import { BrowserSessionError } from '../../src/errors'
import * as fs from 'fs'
import * as path from 'path'

// Mock environment variables
const originalEnv = process.env

describe('Configuration Service', () => {
	beforeEach(() => {
		// Reset environment variables
		process.env = { ...originalEnv }
	})

	afterEach(() => {
		// Restore environment variables
		process.env = originalEnv
		
		// Clean up test config files
		try {
			fs.unlinkSync('./test-config.json')
		} catch {}
	})

	const TestConfigServiceLive = ConfigurationServiceLive('testing', ['./test-config.json'])

	describe('Configuration Loading', () => {
		it('should load configuration from environment variables', async () => {
			process.env.NODE_ENV = 'testing'
			process.env.BROWSER_HEADLESS = 'true'
			process.env.BROWSER_TIMEOUT = '60000'
			process.env.CDP_PORT = '9223'
			process.env.LOG_LEVEL = 'debug'

			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const environment = yield* config.get<Environment>('environment')
				const headless = yield* config.get<boolean>('browser.headless')
				const timeout = yield* config.get<number>('browser.timeout')
				const port = yield* config.get<number>('cdp.port')
				const logLevel = yield* config.get<string>('logLevel')
				
				expect(environment).toBe('testing')
				expect(headless).toBe(true)
				expect(timeout).toBe(60000)
				expect(port).toBe(9223)
				expect(logLevel).toBe('debug')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should load configuration from file', async () => {
			const testConfig = {
				browser: {
					headless: false,
					viewport: { width: 1920, height: 1080 },
					timeout: 45000
				},
				cdp: {
					host: 'remote-host',
					port: 9224
				},
				scaling: {
					maxInstances: 20,
					maxMemory: 4096
				}
			}

			fs.writeFileSync('./test-config.json', JSON.stringify(testConfig, null, 2))

			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const headless = yield* config.get<boolean>('browser.headless')
				const width = yield* config.get<number>('browser.viewport.width')
				const host = yield* config.get<string>('cdp.host')
				const maxInstances = yield* config.get<number>('scaling.maxInstances')
				
				expect(headless).toBe(false)
				expect(width).toBe(1920)
				expect(host).toBe('remote-host')
				expect(maxInstances).toBe(20)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should prioritize environment variables over file config', async () => {
			process.env.BROWSER_HEADLESS = 'true'
			process.env.CDP_PORT = '9999'

			const testConfig = {
				browser: { headless: false },
				cdp: { port: 8888 }
			}

			fs.writeFileSync('./test-config.json', JSON.stringify(testConfig, null, 2))

			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const headless = yield* config.get<boolean>('browser.headless')
				const port = yield* config.get<number>('cdp.port')
				
				// Environment should win
				expect(headless).toBe(true)
				expect(port).toBe(9999)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Configuration Validation', () => {
		it('should validate configuration successfully', async () => {
			process.env.NODE_ENV = 'testing'
			process.env.BROWSER_TIMEOUT = '30000'
			process.env.CDP_PORT = '9222'

			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				const errors = yield* config.validate()
				
				expect(errors).toHaveLength(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should report validation errors', async () => {
			process.env.BROWSER_TIMEOUT = '-1000' // Invalid negative timeout
			process.env.CDP_PORT = '99999' // Invalid port number

			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				const errors = yield* config.validate()
				
				expect(errors.length).toBeGreaterThan(0)
				expect(errors.some(e => e.includes('timeout'))).toBe(true)
				expect(errors.some(e => e.includes('port'))).toBe(true)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Configuration Get/Set Operations', () => {
		it('should get configuration values', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const timeout = yield* config.get<number>('browser.timeout', 15000)
				expect(typeof timeout).toBe('number')
				
				// Test default value
				const nonExistent = yield* config.get<string>('non.existent.key', 'default')
				expect(nonExistent).toBe('default')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should set configuration values', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				yield* config.set('custom.setting', 'test-value')
				const value = yield* config.get<string>('custom.setting')
				
				expect(value).toBe('test-value')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should fail when getting non-existent key without default', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const result = yield* config.get<string>('definitely.not.exists').pipe(
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				if (result._tag === 'Left') {
					expect(result.left).toBeInstanceOf(BrowserSessionError)
				}
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should get all configuration', async () => {
			process.env.NODE_ENV = 'testing'
			process.env.BROWSER_HEADLESS = 'true'

			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				const allConfig = yield* config.getAll()
				
				expect(allConfig.environment).toBe('testing')
				expect(allConfig.browser).toBeDefined()
				expect(allConfig.cdp).toBeDefined()
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Encryption/Decryption', () => {
		it('should encrypt and decrypt values', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const originalValue = 'secret-api-key-12345'
				const encrypted = yield* config.encrypt(originalValue)
				
				expect(encrypted).toContain('encrypted:')
				expect(encrypted).not.toContain(originalValue)
				
				const decrypted = yield* config.decrypt(encrypted)
				expect(decrypted).toBe(originalValue)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should handle non-encrypted values in decrypt', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const plainValue = 'not-encrypted'
				const result = yield* config.decrypt(plainValue)
				
				expect(result).toBe(plainValue)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Configuration Watching', () => {
		it('should watch for configuration changes', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				let changeDetected = false
				let changeEvent: any = null
				
				const unwatch = yield* config.watch('test.watch.key', (event) => {
					changeDetected = true
					changeEvent = event
				})
				
				yield* config.set('test.watch.key', 'initial-value')
				yield* config.set('test.watch.key', 'updated-value')
				
				// Allow some time for the callback
				yield* Effect.sleep('10 millis')
				
				expect(changeDetected).toBe(true)
				expect(changeEvent).toBeDefined()
				expect(changeEvent.key).toBe('test.watch.key')
				expect(changeEvent.newValue).toBe('updated-value')
				
				// Unwatch
				unwatch()
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Configuration History', () => {
		it('should track configuration changes', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				yield* config.set('history.test', 'value1')
				yield* config.set('history.test', 'value2')
				yield* config.set('history.other', 'other-value')
				
				const allHistory = yield* config.getHistory()
				const keyHistory = yield* config.getHistory('history.test')
				
				expect(allHistory.length).toBeGreaterThanOrEqual(3)
				expect(keyHistory.length).toBe(2)
				expect(keyHistory[1].newValue).toBe('value2')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Configuration Export/Import', () => {
		it('should export configuration', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				yield* config.set('export.test', 'export-value')
				
				const exported = yield* config.exportConfig('testing', false)
				
				expect(typeof exported).toBe('string')
				const parsed = JSON.parse(exported)
				expect(parsed.environment).toBe('testing')
				expect(parsed['export.test']).toBeDefined()
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should import configuration', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const importData = JSON.stringify({
					'import.test': {
						value: 'imported-value',
						source: 'file',
						timestamp: Date.now()
					}
				})
				
				yield* config.importConfig(importData)
				
				const value = yield* config.get<string>('import.test')
				expect(value).toBe('imported-value')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})

		it('should handle invalid import data', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				const result = yield* config.importConfig('invalid json').pipe(
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				if (result._tag === 'Left') {
					expect(result.left).toBeInstanceOf(BrowserSessionError)
				}
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Configuration Reloading', () => {
		it('should reload configuration from sources', async () => {
			const program = Effect.gen(function* () {
				const config = yield* ConfigurationService
				
				// Change environment variable
				process.env.BROWSER_TIMEOUT = '99999'
				
				yield* config.reload()
				
				const timeout = yield* config.get<number>('browser.timeout')
				expect(timeout).toBe(99999)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConfigServiceLive)
			))
		})
	})

	describe('Environment Helpers', () => {
		it('should detect development environment', async () => {
			const DevConfigServiceLive = ConfigurationServiceLive('development')
			
			const program = Effect.gen(function* () {
				const isDev = yield* Effect.gen(function* () {
					const config = yield* ConfigurationService
					const env = yield* config.get<Environment>('environment')
					return env === 'development'
				})
				
				expect(isDev).toBe(true)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(DevConfigServiceLive)
			))
		})

		it('should detect production environment', async () => {
			const ProdConfigServiceLive = ConfigurationServiceLive('production')
			
			const program = Effect.gen(function* () {
				const isProd = yield* Effect.gen(function* () {
					const config = yield* ConfigurationService
					const env = yield* config.get<Environment>('environment')
					return env === 'production'
				})
				
				expect(isProd).toBe(true)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(ProdConfigServiceLive)
			))
		})
	})
})