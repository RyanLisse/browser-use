/**
 * @fileoverview Chrome DevTools Protocol (CDP) client implementation using Effect
 */

import { Context, Effect, Layer, Schedule } from 'effect'
import * as CDP from 'chrome-remote-interface'
import { CDPConnectionError, CDPCommandError } from '../errors'
import type { CDPConfig } from '../config'

/**
 * CDP command result type
 */
export interface CDPCommandResult<T = unknown> {
	readonly result: T
	readonly sessionId: string | undefined
}

/**
 * CDP client interface following the implementation guide
 */
export interface CDPClientInterface {
	readonly connect: () => Effect.Effect<void, CDPConnectionError>
	readonly disconnect: () => Effect.Effect<void, CDPConnectionError>
	readonly send: <T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string
	) => Effect.Effect<CDPCommandResult<T>, CDPCommandError>
	readonly isConnected: () => Effect.Effect<boolean, never>
}

/**
 * CDP client context tag
 */
export class CDPClient extends Context.Tag('CDPClient')<CDPClient, CDPClientInterface>() {}

/**
 * Internal CDP client state
 */
interface CDPClientState {
	client: any
	connected: boolean
}

/**
 * Create CDP client implementation
 */
const makeCDPClient = Effect.gen(function* () {
	const config = yield* Context.GenericTag<CDPConfig>('CDPConfig')
	
	let state: CDPClientState = {
		client: null,
		connected: false
	}

	const connect = (): Effect.Effect<void, CDPConnectionError> =>
		Effect.gen(function* () {
			if (state.connected) {
				return
			}

			try {
				yield* Effect.logInfo(`Connecting to CDP at ${config.host}:${config.port}`)
				
				const client = yield* Effect.tryPromise({
					try: () => CDP({
						host: config.host,
						port: config.port,
						secure: config.secure
					}),
					catch: (error) => new CDPConnectionError({
						message: `Failed to connect to CDP`,
						host: config.host,
						port: config.port,
						cause: error
					})
				})

				state.client = client
				state.connected = true

				yield* Effect.logInfo('Successfully connected to CDP')
			} catch (error) {
				yield* Effect.fail(new CDPConnectionError({
					message: `CDP connection failed`,
					host: config.host,
					port: config.port,
					cause: error
				}))
			}
		}).pipe(
			Effect.retry(
				Schedule.exponential('1 second').pipe(
					Schedule.intersect(Schedule.recurs(3))
				)
			),
			Effect.timeout('10 seconds'),
			Effect.catchTag('TimeoutException', (error) => 
				Effect.fail(new CDPConnectionError({
					message: 'CDP connection timeout',
					host: config.host,
					port: config.port,
					cause: error
				}))
			)
		)

	const disconnect = (): Effect.Effect<void, CDPConnectionError> =>
		Effect.gen(function* () {
			if (!state.connected || !state.client) {
				return
			}

			try {
				yield* Effect.logInfo('Disconnecting from CDP')
				
				yield* Effect.tryPromise({
					try: () => state.client.close(),
					catch: (error) => new CDPConnectionError({
						message: 'Failed to disconnect from CDP',
						cause: error
					})
				})

				state.client = null
				state.connected = false

				yield* Effect.logInfo('Successfully disconnected from CDP')
			} catch (error) {
				yield* Effect.fail(new CDPConnectionError({
					message: 'CDP disconnection failed',
					cause: error
				}))
			}
		})

	const send = <T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string
	): Effect.Effect<CDPCommandResult<T>, CDPCommandError> =>
		Effect.gen(function* () {
			if (!state.connected || !state.client) {
				yield* Effect.fail(new CDPCommandError({
					message: 'CDP client not connected',
					command: method
				}))
			}

			try {
				yield* Effect.logDebug(`Sending CDP command: ${method}`, { params, sessionId })

				const commandParams = sessionId 
					? { ...params, sessionId }
					: params

				const result = yield* Effect.tryPromise({
					try: () => state.client.send(method, commandParams),
					catch: (error) => new CDPCommandError({
						message: `CDP command ${method} failed`,
						command: method,
						cause: error
					})
				})

				yield* Effect.logDebug(`CDP command ${method} succeeded`)

				return {
					result: result as T,
					sessionId
				}
			} catch (error) {
				yield* Effect.fail(new CDPCommandError({
					message: `CDP command execution failed`,
					command: method,
					cause: error
				}))
			}
		}).pipe(
			Effect.retry(
				Schedule.exponential('500 millis').pipe(
					Schedule.intersect(Schedule.recurs(2))
				)
			),
			Effect.timeout('30 seconds'),
			Effect.catchTag('TimeoutException', (error) =>
				Effect.fail(new CDPCommandError({
					message: `CDP command ${method} timeout`,
					command: method,
					cause: error
				}))
			)
		)

	const isConnected = (): Effect.Effect<boolean, never> =>
		Effect.succeed(state.connected)

	const service: CDPClientInterface = {
		connect,
		disconnect,
		send,
		isConnected
	}

	return service
})

/**
 * CDP client layer
 */
export const CDPClientLive = Layer.effect(CDPClient, makeCDPClient)

/**
 * Helper functions for common CDP commands
 */
export const CDPCommands = {
	/**
	 * Get browser version information
	 */
	getBrowserVersion: () => 
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const result = yield* cdp.send('Browser.getVersion')
			return result.result as { product: string; revision: string; userAgent: string }
		}),

	/**
	 * Enable Runtime domain
	 */
	enableRuntime: (sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('Runtime.enable', undefined, sessionId)
		}),

	/**
	 * Enable Page domain
	 */
	enablePage: (sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('Page.enable', undefined, sessionId)
		}),

	/**
	 * Navigate to URL
	 */
	navigateToUrl: (url: string, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const result = yield* cdp.send('Page.navigate', { url }, sessionId)
			return result.result as { frameId: string; loaderId?: string }
		}),

	/**
	 * Take screenshot
	 */
	captureScreenshot: (sessionId?: string, options?: { format?: 'jpeg' | 'png'; quality?: number }) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const params = {
				format: options?.format || 'png',
				...(options?.quality && { quality: options.quality })
			}
			const result = yield* cdp.send('Page.captureScreenshot', params, sessionId)
			return result.result as { data: string }
		})
}