/**
 * @fileoverview Main Browser service and BrowserUse interface
 */

import { Context, Effect, Layer } from 'effect'
import type { AppConfig, BrowserConfig } from '../config'
import { BrowserSessionError } from '../errors'
import { CDPClient, CDPClientLive, CDPCommands } from '../cdp'

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
	const cdp = yield* CDPClient
	
	const sessions = new Map<string, BrowserSession>()
	
	const createSession = (_sessionConfig?: Partial<BrowserConfig>): Effect.Effect<BrowserSession, BrowserSessionError> =>
		Effect.gen(function* () {
			const sessionId = crypto.randomUUID()
			
			// Ensure CDP is connected
			const isConnected = yield* cdp.isConnected()
			if (!isConnected) {
				yield* cdp.connect()
			}
			
			// Enable required CDP domains
			yield* CDPCommands.enableRuntime(sessionId).pipe(
				Effect.provide(Layer.succeed(CDPClient, cdp))
			)
			yield* CDPCommands.enablePage(sessionId).pipe(
				Effect.provide(Layer.succeed(CDPClient, cdp))
			)
			
			// Real session implementation using CDP
			const session: BrowserSession = {
				sessionId,
				navigate: (url: string) =>
					Effect.gen(function* () {
						yield* Effect.logInfo(`Navigating to ${url}`)
						
						const result = yield* CDPCommands.navigateToUrl(url, sessionId).pipe(
							Effect.provide(Layer.succeed(CDPClient, cdp)),
							Effect.catchAll((error) =>
								Effect.fail(new BrowserSessionError({
									message: `Navigation to ${url} failed`,
									sessionId,
									cause: error
								}))
							)
						)
						
						yield* Effect.logInfo(`Navigation completed, frameId: ${result.frameId}`)
					}),
				takeScreenshot: () =>
					Effect.gen(function* () {
						yield* Effect.logInfo('Taking screenshot')
						
						const result = yield* CDPCommands.captureScreenshot(sessionId).pipe(
							Effect.provide(Layer.succeed(CDPClient, cdp)),
							Effect.mapError((error) =>
								new BrowserSessionError({
									message: 'Screenshot capture failed',
									sessionId,
									cause: error
								})
							)
						)
						
						yield* Effect.logInfo('Screenshot captured successfully')
						return `data:image/png;base64,${result.data}`
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
 * Requires: AppConfigService and CDPClient
 */
export const BrowserServiceLive = Layer.effect(BrowserService, makeBrowserService)

/**
 * BrowserUse layer that provides the main API with all required dependencies
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
).pipe(
	Layer.provide(BrowserServiceLive),
	Layer.provide(CDPClientLive)
)

/**
 * Export the AppConfig service tag for use in tests
 */
export { AppConfigService }