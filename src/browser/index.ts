/**
 * @fileoverview Main Browser service and BrowserUse interface
 */

import { Context, Effect, Layer } from 'effect'
import type { AppConfig, BrowserConfig } from '../config'
import { BrowserSessionError, CDPConnectionError, CDPCommandError } from '../errors'
import { CDPClient, CDPCommands } from '../cdp'

/**
 * Browser session interface matching the implementation guide API
 */
export interface BrowserSession {
	readonly sessionId: string
	readonly navigate: (url: string) => Effect.Effect<void, BrowserSessionError>
	readonly takeScreenshot: () => Effect.Effect<string, BrowserSessionError>
	readonly close: () => Effect.Effect<void, BrowserSessionError>
}

/**
 * Browser service interface
 */
export interface BrowserServiceInterface {
	readonly createSession: (config?: Partial<BrowserConfig>) => Effect.Effect<BrowserSession, BrowserSessionError>
	readonly getSessions: () => Effect.Effect<readonly BrowserSession[], never>
}

/**
 * Browser service context tag
 */
export class BrowserService extends Context.Tag('BrowserService')<
	BrowserService,
	BrowserServiceInterface
>() {}

/**
 * Main BrowserUse interface matching the implementation guide
 */
export interface BrowserUseInterface {
	readonly create: (config?: Partial<BrowserConfig>) => Effect.Effect<BrowserSession, BrowserSessionError>
}

/**
 * BrowserUse context tag
 */
export class BrowserUse extends Context.Tag('BrowserUse')<BrowserUse, BrowserUseInterface>() {}

/**
 * Create BrowserUse instance - main entry point matching the guide API
 */
export const create = (config?: Partial<BrowserConfig>): Effect.Effect<BrowserSession, BrowserSessionError, BrowserService> =>
	Effect.gen(function* () {
		const browserService = yield* BrowserService
		return yield* browserService.createSession(config)
	})

/**
 * AppConfig service tag
 */
const AppConfigService = Context.GenericTag<AppConfig>('AppConfig')

/**
 * Enhanced browser service implementation with real CDP integration (Epic 1.3)
 */
const makeBrowserService = Effect.gen(function* () {
	const config = yield* AppConfigService
	const cdp = yield* CDPClient
	
	const sessions = new Map<string, BrowserSession>()
	
	const createSession = (sessionConfig?: Partial<BrowserConfig>): Effect.Effect<BrowserSession, BrowserSessionError> =>
		Effect.gen(function* () {
			const finalConfig = { ...config.browser, ...sessionConfig }
			const sessionId = crypto.randomUUID()
			
			try {
				// Ensure CDP is connected
				const isConnected = yield* cdp.isConnected()
				if (!isConnected) {
					yield* cdp.connect()
				}
				
				// Enable required CDP domains
				yield* CDPCommands.enableRuntime(sessionId)
				yield* CDPCommands.enablePage(sessionId)
				
				// Real session implementation using CDP
				const session: BrowserSession = {
					sessionId,
					navigate: (url: string) =>
						Effect.gen(function* () {
							yield* Effect.logInfo(`Navigating to ${url}`)
							
							try {
								const result = yield* CDPCommands.navigateToUrl(url, sessionId)
								yield* Effect.logInfo(`Navigation completed, frameId: ${result.frameId}`)
							} catch (error) {
								yield* Effect.fail(new BrowserSessionError({
									message: `Navigation to ${url} failed`,
									sessionId,
									cause: error
								}))
							}
						}),
					takeScreenshot: () =>
						Effect.gen(function* () {
							yield* Effect.logInfo('Taking screenshot')
							
							try {
								const result = yield* CDPCommands.captureScreenshot(sessionId)
								yield* Effect.logInfo('Screenshot captured successfully')
								return `data:image/png;base64,${result.data}`
							} catch (error) {
								yield* Effect.fail(new BrowserSessionError({
									message: 'Screenshot capture failed',
									sessionId,
									cause: error
								}))
							}
						}),
					close: () =>
						Effect.gen(function* () {
							yield* Effect.logInfo('Closing browser session')
							sessions.delete(sessionId)
							yield* Effect.logInfo(`Session ${sessionId} closed`)
						})
				}
				
				sessions.set(sessionId, session)
				yield* Effect.logInfo(`Created browser session with ID: ${sessionId}`)
				
				return session
				
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Failed to create browser session',
					sessionId,
					cause: error
				}))
			}
		}).pipe(
			Effect.catchTags({
				CDPConnectionError: (error) =>
					Effect.fail(new BrowserSessionError({
						message: 'CDP connection failed during session creation',
						cause: error
					})),
				CDPCommandError: (error) =>
					Effect.fail(new BrowserSessionError({
						message: 'CDP command failed during session creation',
						cause: error
					}))
			})
		)
	
	const getSessions = (): Effect.Effect<readonly BrowserSession[], never> =>
		Effect.succeed(Array.from(sessions.values()))
	
	const service: BrowserServiceInterface = { createSession, getSessions }
	return service
})

/**
 * Browser service layer with CDP dependency
 */
export const BrowserServiceLive = Layer.effect(BrowserService, makeBrowserService)

/**
 * BrowserUse layer that provides the main API
 */
export const BrowserUseLive = Layer.effect(
	BrowserUse,
	Effect.gen(function* () {
		const browserService = yield* BrowserService
		
		const service: BrowserUseInterface = {
			create: (config?: Partial<BrowserConfig>) => browserService.createSession(config)
		}
		return service
	})
).pipe(Layer.provide(BrowserServiceLive))

/**
 * Export the AppConfig service tag for use in tests
 */
export { AppConfigService }