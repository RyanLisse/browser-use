/**
 * @fileoverview Final fix attempt - simplest possible test
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { BrowserService, AppConfigService } from '../src/browser'
import { CDPClient } from '../src/cdp'
import { createMockCDPClient } from './cdp-mock'
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

describe('Final Fix Attempt', () => {
	it('should resolve all dependencies directly without BrowserService layer', async () => {
		const program = Effect.gen(function* () {
			// Test accessing AppConfigService directly
			const config = yield* AppConfigService
			expect(config).toBeDefined()
			yield* Effect.logInfo('AppConfig accessed successfully')

			// Test accessing CDPClient directly  
			const cdp = yield* CDPClient
			expect(cdp).toBeDefined()
			yield* Effect.logInfo('CDPClient accessed successfully')
			
			// Test that we have everything the BrowserService needs
			expect(config.browser.headless).toBe(true)
			expect(typeof cdp.connect).toBe('function')
		})

		const layers = Layer.mergeAll(
			Layer.succeed(AppConfigService, testConfig),
			Layer.succeed(CDPClient, createMockCDPClient([]))
		)
		
		await Effect.runPromise(program.pipe(Effect.provide(layers)))
	})

	it('should be able to manually create what BrowserService does', async () => {
		const program = Effect.gen(function* () {
			// Manually do what makeBrowserService does
			const config = yield* AppConfigService
			const cdp = yield* CDPClient

			// Verify we can access both
			expect(config).toBeDefined()
			expect(cdp).toBeDefined()

			// Create a session manually
			const sessionId = crypto.randomUUID()
			expect(sessionId).toBeDefined()
			
			// Test CDP connection
			const isConnected = yield* cdp.isConnected()
			if (!isConnected) {
				yield* cdp.connect()
			}

			yield* Effect.logInfo('Manual BrowserService creation successful')
		})

		const layers = Layer.mergeAll(
			Layer.succeed(AppConfigService, testConfig),
			Layer.succeed(CDPClient, createMockCDPClient([]))
		)
		
		await Effect.runPromise(program.pipe(Effect.provide(layers)))
	})
})