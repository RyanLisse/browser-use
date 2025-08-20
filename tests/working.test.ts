/**
 * @fileoverview Working tests with proper layer composition
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer, Context } from 'effect'
import { BrowserUse, BrowserService, BrowserServiceLive, AppConfigService, type BrowserUseInterface } from '../src/browser'
import { CDPClient, type CDPClientInterface } from '../src/cdp'
import { createMockCDPClient, CommonMockResponses } from './cdp-mock'
import type { AppConfig, BrowserConfig } from '../src/config'

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

// Use the exported AppConfigService tag to ensure consistency

// Mock CDP client layer using the exact same tag as the real service
const MockCDPClientLive = Layer.succeed(
	CDPClient, 
	createMockCDPClient([
		CommonMockResponses.runtimeEnable,
		CommonMockResponses.pageEnable,
		CommonMockResponses.navigate,
		CommonMockResponses.screenshot
	])
)

describe('Working Layer Composition', () => {
	it('should create working BrowserUse with mocked dependencies', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			expect(browserUse).toBeDefined()
			expect(typeof browserUse.create).toBe('function')

			// Test creating a session
			const session = yield* browserUse.create()
			expect(session).toBeDefined()
			expect(session.sessionId).toBeDefined()
			expect(typeof session.navigate).toBe('function')

			// Test basic operations
			yield* session.navigate('https://example.com')
			const screenshot = yield* session.takeScreenshot()
			expect(screenshot).toContain('data:image/png;base64,')

			yield* session.close()
		})

		// Build layers step by step using the exported tag
		const configLayer = Layer.succeed(AppConfigService, testConfig)
		
		// BrowserServiceLive with dependencies
		const browserServiceLayer = Layer.provide(
			BrowserServiceLive,
			Layer.mergeAll(configLayer, MockCDPClientLive)
		)
		
		// BrowserUse layer
		const browserUseLayer = Layer.effect(
			BrowserUse,
			Effect.gen(function* () {
				const browserService = yield* BrowserService
				
				const service: BrowserUseInterface = {
					create: (config?: Partial<BrowserConfig>) => browserService.createSession(config)
				}
				return service
			})
		)
		
		const testLayer = Layer.provide(browserUseLayer, browserServiceLayer)
		
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
	})
})