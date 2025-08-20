/**
 * @fileoverview Simple service test to isolate the issue
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer, Context } from 'effect'
import type { AppConfig } from '../src/config'

// Define the same tag with the same identifier
const AppConfigService = Context.GenericTag<AppConfig>('AppConfig')

// Test configuration
const testConfig: AppConfig = {
	browser: {
		headless: true,
		viewport: { width: 1280, height: 720 },
		timeout: 30000,
		retryAttempts: 3,
	},
	cdp: {
		host: 'localhost',
		port: 9222,
		secure: false,
		connectionTimeout: 10000,
	},
	logLevel: 'info' as const,
}

// Simple service that uses the tag
const makeTestService = Effect.gen(function* () {
	const config = yield* AppConfigService
	return {
		getConfig: () => config
	}
})

const TestService = Context.GenericTag<{ getConfig: () => AppConfig }>('TestService')
const TestServiceLive = Layer.effect(TestService, makeTestService)

describe('Simple Service Test', () => {
	it('should resolve AppConfig service', async () => {
		const program = Effect.gen(function* () {
			const config = yield* AppConfigService
			expect(config).toBeDefined()
			expect(config.browser.headless).toBe(true)
		})

		const testLayer = Layer.succeed(AppConfigService, testConfig)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
	})

	it('should resolve service that depends on AppConfig', async () => {
		const program = Effect.gen(function* () {
			const service = yield* TestService
			const config = service.getConfig()
			expect(config).toBeDefined()
			expect(config.browser.headless).toBe(true)
		})

		const configLayer = Layer.succeed(AppConfigService, testConfig)
		const serviceWithDeps = Layer.provide(TestServiceLive, configLayer)
		
		await Effect.runPromise(program.pipe(Effect.provide(serviceWithDeps)))
	})
})