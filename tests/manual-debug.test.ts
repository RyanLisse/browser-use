/**
 * @fileoverview Manual debugging to find the exact issue
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer, Context } from 'effect'
import { CDPClient, type CDPClientInterface } from '../src/cdp'
import { createMockCDPClient } from './cdp-mock'

describe('Manual Debug', () => {
	it('should access CDPClient after providing mock layer', async () => {
		const program = Effect.gen(function* () {
			yield* Effect.logInfo('Trying to access CDPClient...')
			const cdp = yield* CDPClient
			yield* Effect.logInfo('CDPClient accessed successfully!')
			expect(cdp).toBeDefined()
		})

		const mockClient = createMockCDPClient([])
		const mockLayer = Layer.succeed(CDPClient, mockClient)
		
		await Effect.runPromise(program.pipe(Effect.provide(mockLayer)))
	})
	
	it('should be able to create and use the exact same tag pattern', async () => {
		// Create a manual test using the same pattern as CDPClient
		const TestClient = Context.Tag('TestClient')<TestClient, { test: () => string }>()
		const testClientImpl = { test: () => 'working' }
		
		const program = Effect.gen(function* () {
			const client = yield* TestClient
			const result = client.test()
			expect(result).toBe('working')
		})
		
		const testLayer = Layer.succeed(TestClient, testClientImpl)
		await Effect.runPromise(program.pipe(Effect.provide(testLayer)))
	})
})