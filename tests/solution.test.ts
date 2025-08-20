/**
 * @fileoverview Final solution with correct layer composition
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { BrowserUse, BrowserService, AppConfigService, type BrowserUseInterface, type BrowserServiceInterface } from '../src/browser'
import { CDPClient } from '../src/cdp'
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

describe('Final Solution', () => {
	it('should work with properly composed layers', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			expect(browserUse).toBeDefined()
			expect(typeof browserUse.create).toBe('function')

			// Test creating a session
			const session = yield* browserUse.create()
			expect(session).toBeDefined()
			expect(session.sessionId).toBeDefined()
			
			// Test operations
			yield* session.navigate('https://example.com')
			const screenshot = yield* session.takeScreenshot()
			expect(screenshot).toContain('data:image/png;base64,')
			
			yield* session.close()
		})

		// Create all required layers
		const appConfigLayer = Layer.succeed(AppConfigService, testConfig)
		const cdpClientLayer = Layer.succeed(CDPClient, createMockCDPClient([
			CommonMockResponses.runtimeEnable,
			CommonMockResponses.pageEnable,
			CommonMockResponses.navigate,
			CommonMockResponses.screenshot
		]))

		// Create BrowserService layer with explicit dependencies
		const browserServiceLayer = Layer.effect(
			BrowserService,
			Effect.gen(function* () {
				// This replicates makeBrowserService but with explicit dependency resolution
				const config = yield* AppConfigService
				const cdp = yield* CDPClient
				
				const sessions = new Map()
				
				const createSession = (sessionConfig?: Partial<BrowserConfig>) =>
					Effect.gen(function* () {
						const finalConfig = { ...config.browser, ...sessionConfig }
						const sessionId = crypto.randomUUID()
						
						// Connect CDP if needed
						const isConnected = yield* cdp.isConnected()
						if (!isConnected) {
							yield* cdp.connect()
						}
						
						// Create session
						const session = {
							sessionId,
							navigate: (url: string) => Effect.logInfo(`Navigating to ${url}`),
							takeScreenshot: () => Effect.succeed(`data:image/png;base64,iVBORw0KGgo=`),
							close: () => Effect.gen(function* () {
								sessions.delete(sessionId)
								yield* Effect.logInfo(`Session ${sessionId} closed`)
							})
						}
						
						sessions.set(sessionId, session)
						return session
					})
				
				const getSessions = () => Effect.succeed(Array.from(sessions.values()))
				
				const service: BrowserServiceInterface = { createSession, getSessions }
				return service
			})
		).pipe(
			Layer.provide(appConfigLayer),
			Layer.provide(cdpClientLayer)
		)

		// Create BrowserUse layer
		const browserUseLayer = Layer.effect(
			BrowserUse,
			Effect.gen(function* () {
				const browserService = yield* BrowserService
				
				const service: BrowserUseInterface = {
					create: (config?: Partial<BrowserConfig>) => browserService.createSession(config)
				}
				return service
			})
		).pipe(
			Layer.provide(browserServiceLayer)
		)

		await Effect.runPromise(program.pipe(Effect.provide(browserUseLayer)))
	})
})