/**
 * @fileoverview Basic tests for Epic 1.1 - Project Foundation
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { BrowserUse, BrowserUseLive, AppConfigService } from '../src/browser'
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

// Test configuration layer
const TestConfigLive = Layer.succeed(AppConfigService, testConfig)

const TestLive = Layer.provide(BrowserUseLive, TestConfigLive)

describe('Epic 1.1: Project Foundation', () => {
	it('should create BrowserUse instance successfully', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			expect(browserUse).toBeDefined()
			expect(typeof browserUse.create).toBe('function')
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should create browser session with default config', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			expect(session).toBeDefined()
			expect(session.sessionId).toBeDefined()
			expect(typeof session.navigate).toBe('function')
			expect(typeof session.takeScreenshot).toBe('function')
			expect(typeof session.close).toBe('function')
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should create browser session with custom config', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create({
				headless: false,
				viewport: { width: 1920, height: 1080 }
			})
			
			expect(session).toBeDefined()
			expect(session.sessionId).toBeDefined()
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should handle basic session operations', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Test navigation (placeholder implementation)
			yield* session.navigate('https://example.com')
			
			// Test screenshot (placeholder implementation)
			const screenshot = yield* session.takeScreenshot()
			expect(screenshot).toContain('data:image/png;base64,')
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})
})