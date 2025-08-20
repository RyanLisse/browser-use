/**
 * @fileoverview Main Browser service and BrowserUse interface
 */

import { Context, Effect, Layer } from 'effect'
import type { AppConfig, BrowserConfig } from '../config'
import { BrowserSessionError } from '../errors'

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
 * Basic browser service implementation (will be enhanced in Epic 1.2 & 1.3)
 */
const makeBrowserService = Effect.gen(function* () {
	const config = yield* AppConfigService
	
	const sessions = new Map<string, BrowserSession>()
	
	const createSession = (sessionConfig?: Partial<BrowserConfig>): Effect.Effect<BrowserSession, BrowserSessionError> =>
		Effect.gen(function* () {
			const finalConfig = { ...config.browser, ...sessionConfig }
			const sessionId = crypto.randomUUID()
			
			// Basic session implementation - will be enhanced with CDP integration
			const session: BrowserSession = {
				sessionId,
				navigate: (url: string) =>
					Effect.gen(function* () {
						yield* Effect.logInfo(`Navigating to ${url}`)
						// TODO: Implement actual navigation via CDP
					}),
				takeScreenshot: () =>
					Effect.gen(function* () {
						yield* Effect.logInfo('Taking screenshot')
						// TODO: Implement actual screenshot via CDP
						return 'data:image/png;base64,placeholder-screenshot-data'
					}),
				close: () =>
					Effect.gen(function* () {
						yield* Effect.logInfo('Closing session')
						sessions.delete(sessionId)
					})
			}
			
			sessions.set(sessionId, session)
			yield* Effect.logInfo(`Created browser session with ID: ${sessionId}`)
			
			return session
		})
	
	const getSessions = (): Effect.Effect<readonly BrowserSession[], never> =>
		Effect.succeed(Array.from(sessions.values()))
	
	const service: BrowserServiceInterface = { createSession, getSessions }
	return service
})

/**
 * Browser service layer
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