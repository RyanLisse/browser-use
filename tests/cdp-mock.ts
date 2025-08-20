/**
 * @fileoverview CDP mocking utilities for testing
 */

import { Effect, Layer, Context } from 'effect'
import { CDPClient, type CDPClientInterface, type CDPCommandResult } from '../src/cdp'
import { CDPConnectionError, CDPCommandError } from '../src/errors'
import type { CDPConfig } from '../src/config'

/**
 * Mock CDP command responses
 */
export interface MockCDPResponse<T = unknown> {
	readonly method: string
	readonly response: T
	readonly delay?: number
	readonly shouldFail?: boolean
	readonly error?: string
}

/**
 * Mock CDP client state
 */
interface MockCDPClientState {
	connected: boolean
	responses: Map<string, MockCDPResponse>
	commandHistory: Array<{
		method: string
		params?: Record<string, unknown>
		sessionId?: string
		timestamp: number
	}>
}

/**
 * Create mock CDP client
 */
export const createMockCDPClient = (responses: MockCDPResponse[] = []): CDPClientInterface => {
	const state: MockCDPClientState = {
		connected: false,
		responses: new Map(responses.map(r => [r.method, r])),
		commandHistory: []
	}

	const connect = (): Effect.Effect<void, CDPConnectionError> =>
		Effect.gen(function* () {
			yield* Effect.sleep('100 millis') // Simulate connection time
			state.connected = true
			yield* Effect.logInfo('Mock CDP client connected')
		})

	const disconnect = (): Effect.Effect<void, CDPConnectionError> =>
		Effect.gen(function* () {
			state.connected = false
			state.commandHistory = []
			yield* Effect.logInfo('Mock CDP client disconnected')
		})

	const send = <T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string
	): Effect.Effect<CDPCommandResult<T>, CDPCommandError> =>
		Effect.gen(function* () {
			// Record command in history
			state.commandHistory.push({
				method,
				params,
				sessionId,
				timestamp: Date.now()
			})

			if (!state.connected) {
				yield* Effect.fail(new CDPCommandError({
					message: 'Mock CDP client not connected',
					command: method
				}))
			}

			const mockResponse = state.responses.get(method)
			if (!mockResponse) {
				yield* Effect.fail(new CDPCommandError({
					message: `No mock response defined for command: ${method}`,
					command: method
				}))
			}

			// Simulate delay if specified
			if (mockResponse?.delay) {
				yield* Effect.sleep(`${mockResponse.delay} millis`)
			}

			// Simulate failure if specified
			if (mockResponse?.shouldFail) {
				yield* Effect.fail(new CDPCommandError({
					message: mockResponse.error || `Mock failure for command: ${method}`,
					command: method
				}))
			}

			return {
				result: mockResponse!.response as T,
				sessionId: sessionId || undefined
			}
		})

	const isConnected = (): Effect.Effect<boolean, never> =>
		Effect.succeed(state.connected)

	return { connect, disconnect, send, isConnected }
}

/**
 * Mock CDP client layer for testing
 */
export const createMockCDPClientLive = (responses: MockCDPResponse[] = []) =>
	Layer.succeed(CDPClient, createMockCDPClient(responses))

/**
 * Common mock responses for testing
 */
export const CommonMockResponses = {
	browserVersion: {
		method: 'Browser.getVersion',
		response: {
			product: 'Chrome/120.0.0.0',
			revision: '1234567',
			userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
		}
	},
	
	runtimeEnable: {
		method: 'Runtime.enable',
		response: {}
	},
	
	pageEnable: {
		method: 'Page.enable',
		response: {}
	},
	
	navigate: {
		method: 'Page.navigate',
		response: {
			frameId: 'test-frame-id-12345',
			loaderId: 'test-loader-id-67890'
		}
	},
	
	screenshot: {
		method: 'Page.captureScreenshot',
		response: {
			data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
		}
	}
}

/**
 * Test configuration for CDP
 */
export const testCDPConfig: CDPConfig = {
	host: 'localhost',
	port: 9222,
	secure: false,
	connectionTimeout: 5000
}

/**
 * Test CDP config layer
 */
export const TestCDPConfigLive = Layer.succeed(
	Context.GenericTag<CDPConfig>('CDPConfig'), 
	testCDPConfig
)