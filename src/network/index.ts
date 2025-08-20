/**
 * @fileoverview Network request interception service for browser automation
 * Epic 3.4: Add network request interception
 */

import { Context, Effect, Layer } from 'effect'
import { CDPClient } from '../cdp'
import { BrowserSessionError } from '../errors'

/**
 * HTTP request representation
 */
export interface NetworkRequest {
	readonly requestId: string
	readonly url: string
	readonly method: string
	readonly headers: Record<string, string>
	readonly body?: string
	readonly timestamp: number
	readonly resourceType: string
	readonly initiator?: {
		readonly type: string
		readonly stack?: any
	}
}

/**
 * HTTP response representation
 */
export interface NetworkResponse {
	readonly requestId: string
	readonly url: string
	readonly status: number
	readonly statusText: string
	readonly headers: Record<string, string>
	readonly body?: string
	readonly mimeType: string
	readonly timestamp: number
	readonly encodedDataLength: number
	readonly dataLength: number
}

/**
 * Request/Response pair for completed requests
 */
export interface NetworkTransaction {
	readonly requestId: string
	readonly request: NetworkRequest
	readonly response?: NetworkResponse
	readonly error?: string
	readonly duration: number
	readonly completed: boolean
}

/**
 * Request modification options
 */
export interface RequestModification {
	readonly url?: string
	readonly method?: string
	readonly headers?: Record<string, string>
	readonly body?: string
}

/**
 * Response modification options
 */
export interface ResponseModification {
	readonly status?: number
	readonly statusText?: string
	readonly headers?: Record<string, string>
	readonly body?: string
}

/**
 * Network interception patterns
 */
export interface InterceptionPattern {
	readonly urlPattern?: string
	readonly resourceType?: string
	readonly interceptionStage: 'Request' | 'Response' | 'HeadersReceived'
}

/**
 * Network monitoring options
 */
export interface NetworkMonitoringOptions {
	readonly captureRequests?: boolean
	readonly captureResponses?: boolean
	readonly captureResponseBodies?: boolean
	readonly includeResourceTypes?: string[]
	readonly excludeResourceTypes?: string[]
	readonly maxHistory?: number
}

/**
 * Network statistics
 */
export interface NetworkStats {
	readonly totalRequests: number
	readonly completedRequests: number
	readonly failedRequests: number
	readonly totalDataTransferred: number
	readonly averageResponseTime: number
	readonly requestsByType: Record<string, number>
	readonly requestsByStatus: Record<number, number>
}

/**
 * Network interception service interface
 */
export interface NetworkInterceptionServiceInterface {
	readonly enableNetworkDomain: (
		sessionId: string,
		options?: NetworkMonitoringOptions
	) => Effect.Effect<void, BrowserSessionError>

	readonly disableNetworkDomain: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly setRequestInterception: (
		patterns: readonly InterceptionPattern[],
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly interceptRequest: (
		requestId: string,
		sessionId: string,
		modification?: RequestModification
	) => Effect.Effect<void, BrowserSessionError>

	readonly interceptResponse: (
		requestId: string,
		sessionId: string,
		modification?: ResponseModification
	) => Effect.Effect<void, BrowserSessionError>

	readonly continueRequest: (
		requestId: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly continueResponse: (
		requestId: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly failRequest: (
		requestId: string,
		sessionId: string,
		errorReason: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly getRequestHistory: (
		sessionId: string
	) => Effect.Effect<readonly NetworkTransaction[], never>

	readonly waitForRequest: (
		urlPattern: string,
		sessionId: string,
		timeout?: number
	) => Effect.Effect<NetworkRequest, BrowserSessionError>

	readonly waitForResponse: (
		urlPattern: string,
		sessionId: string,
		timeout?: number
	) => Effect.Effect<NetworkResponse, BrowserSessionError>

	readonly clearNetworkHistory: (
		sessionId: string
	) => Effect.Effect<void, never>

	readonly getNetworkStats: (
		sessionId: string
	) => Effect.Effect<NetworkStats, never>

	readonly blockUrls: (
		urlPatterns: readonly string[],
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly unblockUrls: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly setCacheDisabled: (
		disabled: boolean,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly setUserAgent: (
		userAgent: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly emulateNetworkConditions: (
		offline: boolean,
		latency: number,
		downloadThroughput: number,
		uploadThroughput: number,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>
}

/**
 * Network interception service context tag
 */
export const NetworkInterceptionService = Context.GenericTag<NetworkInterceptionServiceInterface>('NetworkInterceptionService')

/**
 * Create network interception service implementation
 */
const makeNetworkInterceptionService = Effect.gen(function* () {
	const cdp = yield* CDPClient

	// State management for network requests
	const requestHistory = new Map<string, Map<string, NetworkTransaction>>()
	const interceptedRequests = new Map<string, Set<string>>()
	const requestCallbacks = new Map<string, Array<(request: NetworkRequest) => void>>()
	const responseCallbacks = new Map<string, Array<(response: NetworkResponse) => void>>()

	const getSessionHistory = (sessionId: string): Map<string, NetworkTransaction> => {
		if (!requestHistory.has(sessionId)) {
			requestHistory.set(sessionId, new Map())
		}
		return requestHistory.get(sessionId)!
	}

	const enableNetworkDomain = (
		sessionId: string,
		options: NetworkMonitoringOptions = {}
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Enabling network domain for session: ${sessionId}`)

				// Enable Network domain
				yield* cdp.send('Network.enable', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to enable network domain',
							sessionId,
							cause: error
						})
					)
				)

				// Set up event listeners
				yield* cdp.register.Network.requestWillBeSent((event) =>
					Effect.gen(function* () {
						const request: NetworkRequest = {
							requestId: event.requestId,
							url: event.request.url,
							method: event.request.method,
							headers: event.request.headers,
							body: event.request.postData,
							timestamp: event.timestamp,
							resourceType: event.type,
							initiator: event.initiator
						}

						const history = getSessionHistory(sessionId)
						history.set(event.requestId, {
							requestId: event.requestId,
							request,
							duration: 0,
							completed: false
						})

						// Trigger callbacks
						const callbacks = requestCallbacks.get(sessionId) || []
						callbacks.forEach(callback => callback(request))

						yield* Effect.logDebug(`Request intercepted: ${request.method} ${request.url}`)
					}).pipe(Effect.runSync)
				)

				yield* cdp.register.Network.responseReceived((event) =>
					Effect.gen(function* () {
						const response: NetworkResponse = {
							requestId: event.requestId,
							url: event.response.url,
							status: event.response.status,
							statusText: event.response.statusText,
							headers: event.response.headers,
							mimeType: event.response.mimeType,
							timestamp: event.timestamp,
							encodedDataLength: event.response.encodedDataLength || 0,
							dataLength: event.response.encodedDataLength || 0
						}

						const history = getSessionHistory(sessionId)
						const transaction = history.get(event.requestId)
						if (transaction) {
							history.set(event.requestId, {
								...transaction,
								response,
								duration: event.timestamp - transaction.request.timestamp
							})
						}

						// Trigger callbacks
						const callbacks = responseCallbacks.get(sessionId) || []
						callbacks.forEach(callback => callback(response))

						yield* Effect.logDebug(`Response received: ${response.status} ${response.url}`)
					}).pipe(Effect.runSync)
				)

				yield* cdp.register.Network.loadingFinished((event) =>
					Effect.gen(function* () {
						const history = getSessionHistory(sessionId)
						const transaction = history.get(event.requestId)
						if (transaction) {
							history.set(event.requestId, {
								...transaction,
								completed: true
							})
						}

						yield* Effect.logDebug(`Request completed: ${event.requestId}`)
					}).pipe(Effect.runSync)
				)

				yield* cdp.register.Network.loadingFailed((event) =>
					Effect.gen(function* () {
						const history = getSessionHistory(sessionId)
						const transaction = history.get(event.requestId)
						if (transaction) {
							history.set(event.requestId, {
								...transaction,
								error: event.errorText,
								completed: true
							})
						}

						yield* Effect.logDebug(`Request failed: ${event.requestId} - ${event.errorText}`)
					}).pipe(Effect.runSync)
				)

				yield* Effect.logInfo(`Network domain enabled for session: ${sessionId}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Network domain enablement failed',
					sessionId,
					cause: error
				}))
			}
		})

	const disableNetworkDomain = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.disable', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to disable network domain',
							sessionId,
							cause: error
						})
					)
				)

				// Clean up session data
				requestHistory.delete(sessionId)
				interceptedRequests.delete(sessionId)
				requestCallbacks.delete(sessionId)
				responseCallbacks.delete(sessionId)

				yield* Effect.logInfo(`Network domain disabled for session: ${sessionId}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Network domain disablement failed',
					sessionId,
					cause: error
				}))
			}
		})

	const setRequestInterception = (
		patterns: readonly InterceptionPattern[],
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Setting request interception patterns: ${patterns.length}`)

				const cdpPatterns = patterns.map(pattern => ({
					urlPattern: pattern.urlPattern,
					resourceType: pattern.resourceType,
					interceptionStage: pattern.interceptionStage
				}))

				yield* cdp.send('Network.setRequestInterception', {
					patterns: cdpPatterns
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to set request interception',
							sessionId,
							cause: error
						})
					)
				)

				// Set up interception event handler
				yield* cdp.register.Network.requestIntercepted((event) =>
					Effect.gen(function* () {
						if (!interceptedRequests.has(sessionId)) {
							interceptedRequests.set(sessionId, new Set())
						}
						interceptedRequests.get(sessionId)!.add(event.interceptionId)

						yield* Effect.logDebug(`Request intercepted: ${event.request.url}`)
					}).pipe(Effect.runSync)
				)

				yield* Effect.logInfo(`Request interception enabled with ${patterns.length} patterns`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Request interception setup failed',
					sessionId,
					cause: error
				}))
			}
		})

	const interceptRequest = (
		requestId: string,
		sessionId: string,
		modification?: RequestModification
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const params: any = { interceptionId: requestId }

				if (modification) {
					if (modification.url) params.url = modification.url
					if (modification.method) params.method = modification.method
					if (modification.headers) params.headers = modification.headers
					if (modification.body) params.postData = modification.body
				}

				yield* cdp.send('Network.continueInterceptedRequest', params, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to intercept request: ${requestId}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logDebug(`Request intercepted and modified: ${requestId}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Request interception failed: ${requestId}`,
					sessionId,
					cause: error
				}))
			}
		})

	const interceptResponse = (
		requestId: string,
		sessionId: string,
		modification?: ResponseModification
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const params: any = { interceptionId: requestId }

				if (modification) {
					if (modification.status) params.responseCode = modification.status
					if (modification.headers) params.responseHeaders = Object.entries(modification.headers).map(([name, value]) => ({ name, value }))
					if (modification.body) params.rawResponse = btoa(modification.body)
				}

				yield* cdp.send('Network.continueInterceptedRequest', params, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to intercept response: ${requestId}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logDebug(`Response intercepted and modified: ${requestId}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Response interception failed: ${requestId}`,
					sessionId,
					cause: error
				}))
			}
		})

	const continueRequest = (
		requestId: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.continueInterceptedRequest', {
					interceptionId: requestId
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to continue request: ${requestId}`,
							sessionId,
							cause: error
						})
					)
				)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Request continuation failed: ${requestId}`,
					sessionId,
					cause: error
				}))
			}
		})

	const continueResponse = (
		requestId: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		continueRequest(requestId, sessionId)

	const failRequest = (
		requestId: string,
		sessionId: string,
		errorReason: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.continueInterceptedRequest', {
					interceptionId: requestId,
					errorReason
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to fail request: ${requestId}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logDebug(`Request failed: ${requestId} - ${errorReason}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Request failure failed: ${requestId}`,
					sessionId,
					cause: error
				}))
			}
		})

	const getRequestHistory = (
		sessionId: string
	): Effect.Effect<readonly NetworkTransaction[], never> =>
		Effect.succeed(
			Array.from(getSessionHistory(sessionId).values())
		)

	const waitForRequest = (
		urlPattern: string,
		sessionId: string,
		timeout = 10000
	): Effect.Effect<NetworkRequest, BrowserSessionError> =>
		Effect.gen(function* () {
			const startTime = Date.now()
			const regex = new RegExp(urlPattern)

			return yield* Effect.async<NetworkRequest, BrowserSessionError>((callback) => {
				const checkExisting = () => {
					const history = getSessionHistory(sessionId)
					for (const transaction of history.values()) {
						if (regex.test(transaction.request.url)) {
							callback(Effect.succeed(transaction.request))
							return true
						}
					}
					return false
				}

				if (checkExisting()) return

				const onRequest = (request: NetworkRequest) => {
					if (regex.test(request.url)) {
						callback(Effect.succeed(request))
					}
				}

				if (!requestCallbacks.has(sessionId)) {
					requestCallbacks.set(sessionId, [])
				}
				requestCallbacks.get(sessionId)!.push(onRequest)

				const timeoutId = setTimeout(() => {
					callback(Effect.fail(new BrowserSessionError({
						message: `Request timeout: ${urlPattern}`,
						sessionId
					})))
				}, timeout)

				return Effect.sync(() => {
					clearTimeout(timeoutId)
					const callbacks = requestCallbacks.get(sessionId) || []
					const index = callbacks.indexOf(onRequest)
					if (index > -1) callbacks.splice(index, 1)
				})
			})
		})

	const waitForResponse = (
		urlPattern: string,
		sessionId: string,
		timeout = 10000
	): Effect.Effect<NetworkResponse, BrowserSessionError> =>
		Effect.gen(function* () {
			const regex = new RegExp(urlPattern)

			return yield* Effect.async<NetworkResponse, BrowserSessionError>((callback) => {
				const checkExisting = () => {
					const history = getSessionHistory(sessionId)
					for (const transaction of history.values()) {
						if (transaction.response && regex.test(transaction.response.url)) {
							callback(Effect.succeed(transaction.response))
							return true
						}
					}
					return false
				}

				if (checkExisting()) return

				const onResponse = (response: NetworkResponse) => {
					if (regex.test(response.url)) {
						callback(Effect.succeed(response))
					}
				}

				if (!responseCallbacks.has(sessionId)) {
					responseCallbacks.set(sessionId, [])
				}
				responseCallbacks.get(sessionId)!.push(onResponse)

				const timeoutId = setTimeout(() => {
					callback(Effect.fail(new BrowserSessionError({
						message: `Response timeout: ${urlPattern}`,
						sessionId
					})))
				}, timeout)

				return Effect.sync(() => {
					clearTimeout(timeoutId)
					const callbacks = responseCallbacks.get(sessionId) || []
					const index = callbacks.indexOf(onResponse)
					if (index > -1) callbacks.splice(index, 1)
				})
			})
		})

	const clearNetworkHistory = (
		sessionId: string
	): Effect.Effect<void, never> =>
		Effect.gen(function* () {
			getSessionHistory(sessionId).clear()
			yield* Effect.logInfo(`Network history cleared for session: ${sessionId}`)
		})

	const getNetworkStats = (
		sessionId: string
	): Effect.Effect<NetworkStats, never> =>
		Effect.gen(function* () {
			const history = getSessionHistory(sessionId)
			const transactions = Array.from(history.values())

			const totalRequests = transactions.length
			const completedRequests = transactions.filter(t => t.completed && !t.error).length
			const failedRequests = transactions.filter(t => t.error).length

			const totalDataTransferred = transactions.reduce((sum, t) => {
				return sum + (t.response?.dataLength || 0)
			}, 0)

			const completedTransactions = transactions.filter(t => t.completed && t.duration > 0)
			const averageResponseTime = completedTransactions.length > 0
				? completedTransactions.reduce((sum, t) => sum + t.duration, 0) / completedTransactions.length
				: 0

			const requestsByType: Record<string, number> = {}
			const requestsByStatus: Record<number, number> = {}

			for (const transaction of transactions) {
				// Count by resource type
				const type = transaction.request.resourceType
				requestsByType[type] = (requestsByType[type] || 0) + 1

				// Count by status code
				if (transaction.response) {
					const status = transaction.response.status
					requestsByStatus[status] = (requestsByStatus[status] || 0) + 1
				}
			}

			return {
				totalRequests,
				completedRequests,
				failedRequests,
				totalDataTransferred,
				averageResponseTime,
				requestsByType,
				requestsByStatus
			}
		})

	const blockUrls = (
		urlPatterns: readonly string[],
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.setBlockedURLs', {
					urls: Array.from(urlPatterns)
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to block URLs`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Blocked ${urlPatterns.length} URL patterns`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'URL blocking failed',
					sessionId,
					cause: error
				}))
			}
		})

	const unblockUrls = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.setBlockedURLs', {
					urls: []
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to unblock URLs',
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo('All URL blocks removed')

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'URL unblocking failed',
					sessionId,
					cause: error
				}))
			}
		})

	const setCacheDisabled = (
		disabled: boolean,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.setCacheDisabled', {
					cacheDisabled: disabled
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to ${disabled ? 'disable' : 'enable'} cache`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Cache ${disabled ? 'disabled' : 'enabled'}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Cache setting failed',
					sessionId,
					cause: error
				}))
			}
		})

	const setUserAgent = (
		userAgent: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.setUserAgentOverride', {
					userAgent
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to set user agent: ${userAgent}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`User agent set: ${userAgent}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'User agent setting failed',
					sessionId,
					cause: error
				}))
			}
		})

	const emulateNetworkConditions = (
		offline: boolean,
		latency: number,
		downloadThroughput: number,
		uploadThroughput: number,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Network.emulateNetworkConditions', {
					offline,
					latency,
					downloadThroughput,
					uploadThroughput
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to emulate network conditions',
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Network conditions emulated: offline=${offline}, latency=${latency}ms, download=${downloadThroughput}kbps, upload=${uploadThroughput}kbps`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Network emulation failed',
					sessionId,
					cause: error
				}))
			}
		})

	return {
		enableNetworkDomain,
		disableNetworkDomain,
		setRequestInterception,
		interceptRequest,
		interceptResponse,
		continueRequest,
		continueResponse,
		failRequest,
		getRequestHistory,
		waitForRequest,
		waitForResponse,
		clearNetworkHistory,
		getNetworkStats,
		blockUrls,
		unblockUrls,
		setCacheDisabled,
		setUserAgent,
		emulateNetworkConditions
	} satisfies NetworkInterceptionServiceInterface
})

/**
 * Network interception service layer
 */
export const NetworkInterceptionServiceLive = Layer.effect(NetworkInterceptionService, makeNetworkInterceptionService)