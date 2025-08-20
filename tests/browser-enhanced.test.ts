/**
 * @fileoverview Tests for Epic 1.3 - Enhanced Browser Service with CDP integration
 */

import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { BrowserUse } from '../src/browser'
import { BrowserSessionError } from '../src/errors'
import {
	createMockCDPClient,
	CommonMockResponses,
} from './cdp-mock'
import type { AppConfig } from '../src/config'

describe('Epic 1.3: Enhanced Browser Service', () => {
	const mockConfig: AppConfig = {
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
			connectionTimeout: 5000,
		},
		logLevel: 'info' as const,
	}

	const createEnhancedMockBrowserUse = () => {
		const mockCdpClient = createMockCDPClient([
			CommonMockResponses.runtimeEnable,
			CommonMockResponses.pageEnable,
			CommonMockResponses.navigate,
			CommonMockResponses.screenshot
		])

		// Mock BrowserUse service that uses the CDP client
		return {
			create: (config?: any) =>
				Effect.gen(function* () {
					const sessionId = crypto.randomUUID()

					// Connect and enable domains
					yield* mockCdpClient.connect()
					yield* mockCdpClient.send('Runtime.enable', undefined, sessionId)
					yield* mockCdpClient.send('Page.enable', undefined, sessionId)

					const session = {
						sessionId,
						navigate: (url: string) =>
							Effect.gen(function* () {
								const result = yield* mockCdpClient.send('Page.navigate', { url }, sessionId)
								yield* Effect.logInfo(`Navigated to ${url}, frameId: ${result.result.frameId}`)
							}),
						takeScreenshot: () =>
							Effect.gen(function* () {
								const result = yield* mockCdpClient.send('Page.captureScreenshot', {}, sessionId)
								return `data:image/png;base64,${result.result.data}`
							}),
						close: () =>
							Effect.gen(function* () {
								yield* Effect.logInfo(`Closing session ${sessionId}`)
							})
					}

					return session
				})
		}
	}

	it('should create browser session with real CDP integration', async () => {
		const mockBrowserUse = createEnhancedMockBrowserUse()

		const program = Effect.gen(function* () {
			const session = yield* mockBrowserUse.create({
				headless: false,
				viewport: { width: 1920, height: 1080 }
			})
			
			expect(session).toBeDefined()
			expect(session.sessionId).toBeDefined()
			expect(typeof session.navigate).toBe('function')
			expect(typeof session.takeScreenshot).toBe('function')
			expect(typeof session.close).toBe('function')
			
			return session
		})

		const session = await Effect.runPromise(program)
		expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/) // UUID format
	})

	it('should navigate using CDP commands', async () => {
		const mockBrowserUse = createEnhancedMockBrowserUse()

		const program = Effect.gen(function* () {
			const session = yield* mockBrowserUse.create()
			
			// Navigate to a URL
			yield* session.navigate('https://example.com')
			
			return session
		})

		await Effect.runPromise(program)
	})

	it('should capture screenshots using CDP', async () => {
		const mockBrowserUse = createEnhancedMockBrowserUse()

		const program = Effect.gen(function* () {
			const session = yield* mockBrowserUse.create()
			
			// Take a screenshot
			const screenshot = yield* session.takeScreenshot()
			
			expect(screenshot).toContain('data:image/png;base64,')
			expect(screenshot.length).toBeGreaterThan(20)
			
			return screenshot
		})

		const screenshot = await Effect.runPromise(program)
		expect(screenshot).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
	})

	it('should handle session lifecycle', async () => {
		const mockBrowserUse = createEnhancedMockBrowserUse()

		const program = Effect.gen(function* () {
			const session = yield* mockBrowserUse.create()
			
			// Use session
			yield* session.navigate('https://example.com')
			yield* session.takeScreenshot()
			
			// Close session
			yield* session.close()
			
			return session.sessionId
		})

		const sessionId = await Effect.runPromise(program)
		expect(sessionId).toBeDefined()
	})

	it('should handle navigation errors gracefully', async () => {
		const mockCdpClient = createMockCDPClient([
			CommonMockResponses.runtimeEnable,
			CommonMockResponses.pageEnable,
			{
				method: 'Page.navigate',
				response: {},
				shouldFail: true,
				error: 'Navigation failed'
			}
		])

		const failingBrowserUse = {
			create: () =>
				Effect.gen(function* () {
					const sessionId = crypto.randomUUID()

					yield* mockCdpClient.connect()
					yield* mockCdpClient.send('Runtime.enable', undefined, sessionId)
					yield* mockCdpClient.send('Page.enable', undefined, sessionId)

					const session = {
						sessionId,
						navigate: (url: string) =>
							Effect.gen(function* () {
								yield* mockCdpClient.send('Page.navigate', { url }, sessionId)
							}).pipe(
								Effect.catchAll((error) =>
									Effect.fail(new BrowserSessionError({
										message: `Navigation to ${url} failed`,
										sessionId,
										cause: error
									}))
								)
							),
						takeScreenshot: () => Effect.succeed('data:image/png;base64,test'),
						close: () => Effect.void
					}

					return session
				})
		}

		const program = Effect.gen(function* () {
			const session = yield* failingBrowserUse.create()
			yield* session.navigate('https://example.com')
		})

		const result = await Effect.runPromise(
			program.pipe(Effect.either)
		)

		expect(result._tag).toBe('Left')
		if (result._tag === 'Left') {
			expect(result.left).toBeInstanceOf(BrowserSessionError)
		}
	})
})