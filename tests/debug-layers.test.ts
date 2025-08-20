/**
 * @fileoverview Debug layer composition issues
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer, Context } from 'effect'
import { CDPClient } from '../src/cdp'
import { BrowserService, BrowserServiceLive, AppConfigService } from '../src/browser'
import { createMockCDPClientLive, CommonMockResponses, TestCDPConfigLive } from './cdp-mock'
import type { AppConfig } from '../src/config'

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

// Create AppConfig layer using the same pattern as CDPConfig
const AppConfigTag = Context.GenericTag<AppConfig>('AppConfig')  
const TestConfigLive = Layer.succeed(AppConfigTag, testConfig)
const MockCDPClientLive = createMockCDPClientLive([
	CommonMockResponses.runtimeEnable,
	CommonMockResponses.pageEnable,
	CommonMockResponses.navigate,
	CommonMockResponses.screenshot
])

describe('Layer Debugging', () => {
	it('should resolve CDPClient dependency', async () => {
		const program = Effect.gen(function* () {
			const cdp = yield* CDPClient
			expect(cdp).toBeDefined()
			expect(typeof cdp.connect).toBe('function')
		})

		// Test with just the mock CDP client layer
		await Effect.runPromise(program.pipe(Effect.provide(MockCDPClientLive)))
	})

	it('should resolve CDPClient with config deps', async () => {
		const program = Effect.gen(function* () {
			const cdp = yield* CDPClient
			expect(cdp).toBeDefined()
			expect(typeof cdp.connect).toBe('function')
		})

		const testLayer = Layer.mergeAll(MockCDPClientLive, TestCDPConfigLive)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
	})

	it('should resolve BrowserService with proper layer composition', async () => {
		const program = Effect.gen(function* () {
			// First, verify the CDPClient can be accessed
			const cdp = yield* CDPClient
			expect(cdp).toBeDefined()
			
			// Then verify the AppConfig
			const config = yield* Context.GenericTag<AppConfig>('AppConfig')
			expect(config).toBeDefined()
			
			// Finally verify the BrowserService
			const service = yield* BrowserService
			expect(service).toBeDefined()
			expect(typeof service.createSession).toBe('function')
		})

		// Use Layer.provide pattern like the simple test
		const configLayer = Layer.succeed(Context.GenericTag<AppConfig>('AppConfig'), testConfig)
		const serviceWithDeps = Layer.provide(
			BrowserServiceLive, 
			Layer.mergeAll(configLayer, MockCDPClientLive, TestCDPConfigLive)
		)
		
		await Effect.runPromise(program.pipe(Effect.provide(serviceWithDeps)))
	})
})