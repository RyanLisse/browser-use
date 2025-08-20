/**
 * @fileoverview Simplified tests for Epic 1.2 - CDP Integration
 */

import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { CDPClient, CDPCommands } from '../src/cdp'
import { CDPConnectionError, CDPCommandError } from '../src/errors'
import {
	createMockCDPClient,
	CommonMockResponses,
} from './cdp-mock'

describe('Epic 1.2: CDP Integration (Simplified)', () => {
	describe('CDPClient', () => {
		it('should connect successfully', async () => {
			const mockClient = createMockCDPClient([])

			const program = Effect.gen(function* () {
				// Initially not connected
				const initialState = yield* mockClient.isConnected()
				expect(initialState).toBe(false)
				
				// Connect
				yield* mockClient.connect()
				
				// Now connected
				const connectedState = yield* mockClient.isConnected()
				expect(connectedState).toBe(true)
			})

			await Effect.runPromise(program)
		})

		it('should disconnect successfully', async () => {
			const mockClient = createMockCDPClient([])

			const program = Effect.gen(function* () {
				// Connect first
				yield* mockClient.connect()
				expect(yield* mockClient.isConnected()).toBe(true)
				
				// Disconnect
				yield* mockClient.disconnect()
				
				// Now disconnected
				expect(yield* mockClient.isConnected()).toBe(false)
			})

			await Effect.runPromise(program)
		})

		it('should send CDP commands successfully', async () => {
			const mockClient = createMockCDPClient([CommonMockResponses.browserVersion])

			const program = Effect.gen(function* () {
				// Connect first
				yield* mockClient.connect()
				
				// Send command
				const result = yield* mockClient.send('Browser.getVersion')
				
				expect(result.result).toEqual({
					product: 'Chrome/120.0.0.0',
					revision: '1234567',
					userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
				})
			})

			await Effect.runPromise(program)
		})

		it('should fail when sending commands without connection', async () => {
			const mockClient = createMockCDPClient([])

			const program = Effect.gen(function* () {
				// Try to send command without connecting
				yield* mockClient.send('Browser.getVersion')
			})

			const result = await Effect.runPromise(
				program.pipe(Effect.either)
			)

			expect(result._tag).toBe('Left')
			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(CDPCommandError)
			}
		})

		it('should handle command failures gracefully', async () => {
			const failingResponse = {
				method: 'Browser.getVersion',
				response: {},
				shouldFail: true,
				error: 'Test failure'
			}

			const mockClient = createMockCDPClient([failingResponse])

			const program = Effect.gen(function* () {
				yield* mockClient.connect()
				yield* mockClient.send('Browser.getVersion')
			})

			const result = await Effect.runPromise(
				program.pipe(Effect.either)
			)

			expect(result._tag).toBe('Left')
			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(CDPCommandError)
			}
		})
	})
})