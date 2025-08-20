/**
 * @fileoverview Main Browser service and BrowserUse interface
 */

import { Context, Effect, Layer } from 'effect'
import type { AppConfig, BrowserConfig } from '../config'
import { BrowserSessionError } from '../errors'
import { CDPClient, CDPClientLive, CDPCommands } from '../cdp'
import { DOMService, DOMServiceLive, type DOMElement, type DOMQueryOptions } from '../dom'
import type { SerializationOptions, DOMSnapshot, DOMDiff } from '../serialization'
import { WasmOptimizationServiceLive } from '../wasm'

/**
 * Browser session interface matching the implementation guide API
 * Enhanced with DOM operations (Epic 2.1)
 */
export interface BrowserSession {
	readonly sessionId: string
	readonly navigate: (url: string) => Effect.Effect<void, BrowserSessionError>
	readonly takeScreenshot: () => Effect.Effect<string, BrowserSessionError>
	readonly close: () => Effect.Effect<void, BrowserSessionError>
	
	// DOM Operations (Epic 2.1)
	readonly querySelector: (
		selector: string, 
		options?: DOMQueryOptions
	) => Effect.Effect<DOMElement | null, BrowserSessionError>
	
	readonly querySelectorAll: (
		selector: string, 
		options?: DOMQueryOptions
	) => Effect.Effect<readonly DOMElement[], BrowserSessionError>
	
	readonly getElementById: (
		id: string, 
		options?: DOMQueryOptions
	) => Effect.Effect<DOMElement | null, BrowserSessionError>
	
	readonly getElementByText: (
		text: string, 
		tagName?: string, 
		options?: DOMQueryOptions
	) => Effect.Effect<DOMElement | null, BrowserSessionError>
	
	readonly waitForElement: (
		selector: string, 
		timeout?: number
	) => Effect.Effect<DOMElement, BrowserSessionError>
	
	// DOM Manipulation Operations (Epic 2.2)
	readonly clickElement: (
		element: DOMElement
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly typeInElement: (
		element: DOMElement, 
		text: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly scrollToElement: (
		element: DOMElement
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly scrollPage: (
		deltaX: number, 
		deltaY: number
	) => Effect.Effect<void, BrowserSessionError>
	
	// Convenience methods for common patterns
	readonly clickBySelector: (
		selector: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly typeBySelector: (
		selector: string, 
		text: string
	) => Effect.Effect<void, BrowserSessionError>
	
	// Screenshot Operations (Epic 2.3)
	readonly highlightElement: (
		element: DOMElement,
		highlightColor?: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly hideHighlight: () => Effect.Effect<void, BrowserSessionError>
	
	readonly takeScreenshotWithHighlight: (
		elements: readonly DOMElement[],
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
			highlightColor?: string
		}
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly takeElementScreenshot: (
		element: DOMElement,
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
		}
	) => Effect.Effect<string, BrowserSessionError>
	
	// Convenience screenshot methods
	readonly takeScreenshotOfSelector: (
		selector: string,
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
		}
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly takeScreenshotWithSelectors: (
		selectors: readonly string[],
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
			highlightColor?: string
		}
	) => Effect.Effect<string, BrowserSessionError>
	
	// Serialization Operations (Epic 2.5)
	readonly serializePageElements: (
		options?: SerializationOptions
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly createPageSnapshot: () => Effect.Effect<DOMSnapshot, BrowserSessionError>
	
	readonly compareWithSnapshot: (
		oldSnapshot: DOMSnapshot
	) => Effect.Effect<DOMDiff, BrowserSessionError>
	
	readonly extractPageText: () => Effect.Effect<string, BrowserSessionError>
	
	readonly extractPageStructure: () => Effect.Effect<Record<string, unknown>, BrowserSessionError>
	
	readonly serializeElementsBySelector: (
		selector: string,
		options?: SerializationOptions
	) => Effect.Effect<string, BrowserSessionError>
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
 * Enhanced with DOM operations (Epic 2.1)
 */
const makeBrowserService = Effect.gen(function* () {
	const cdp = yield* CDPClient
	const domService = yield* DOMService
	
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
			yield* CDPCommands.enableDOM(sessionId).pipe(
				Effect.provide(Layer.succeed(CDPClient, cdp))
			)
			yield* CDPCommands.enableInput(sessionId).pipe(
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
					}),
				
				// DOM Operations (Epic 2.1)
				querySelector: (selector: string, options?: DOMQueryOptions) =>
					domService.querySelector(selector, sessionId, options),
				
				querySelectorAll: (selector: string, options?: DOMQueryOptions) =>
					domService.querySelectorAll(selector, sessionId, options),
				
				getElementById: (id: string, options?: DOMQueryOptions) =>
					domService.getElementById(id, sessionId, options),
				
				getElementByText: (text: string, tagName?: string, options?: DOMQueryOptions) =>
					domService.getElementByText(text, sessionId, tagName, options),
				
				waitForElement: (selector: string, timeout?: number) =>
					domService.waitForElement(selector, sessionId, timeout),
				
				// DOM Manipulation Operations (Epic 2.2)
				clickElement: (element: DOMElement) =>
					domService.clickElement(element, sessionId),
				
				typeInElement: (element: DOMElement, text: string) =>
					domService.typeInElement(element, text, sessionId),
				
				scrollToElement: (element: DOMElement) =>
					domService.scrollToElement(element, sessionId),
				
				scrollPage: (deltaX: number, deltaY: number) =>
					domService.scrollPage(deltaX, deltaY, sessionId),
				
				// Convenience methods for common patterns
				clickBySelector: (selector: string) =>
					Effect.gen(function* () {
						const element = yield* domService.querySelector(selector, sessionId)
						if (!element) {
							yield* Effect.fail(new BrowserSessionError({
								message: `Element not found for selector: ${selector}`,
								sessionId
							}))
						}
						yield* domService.clickElement(element, sessionId)
					}),
				
				typeBySelector: (selector: string, text: string) =>
					Effect.gen(function* () {
						const element = yield* domService.querySelector(selector, sessionId)
						if (!element) {
							yield* Effect.fail(new BrowserSessionError({
								message: `Element not found for selector: ${selector}`,
								sessionId
							}))
						}
						yield* domService.typeInElement(element, text, sessionId)
					}),
				
				// Screenshot Operations (Epic 2.3)
				highlightElement: (element: DOMElement, highlightColor?: string) =>
					domService.highlightElement(element, sessionId, highlightColor),
				
				hideHighlight: () =>
					domService.hideHighlight(sessionId),
				
				takeScreenshotWithHighlight: (elements: readonly DOMElement[], options?: {
					format?: 'jpeg' | 'png'
					quality?: number
					highlightColor?: string
				}) =>
					domService.takeScreenshotWithHighlight(elements, sessionId, options),
				
				takeElementScreenshot: (element: DOMElement, options?: {
					format?: 'jpeg' | 'png'
					quality?: number
				}) =>
					domService.takeElementScreenshot(element, sessionId, options),
				
				// Convenience screenshot methods
				takeScreenshotOfSelector: (selector: string, options?: {
					format?: 'jpeg' | 'png'
					quality?: number
				}) =>
					Effect.gen(function* () {
						const element = yield* domService.querySelector(selector, sessionId)
						if (!element) {
							yield* Effect.fail(new BrowserSessionError({
								message: `Element not found for selector: ${selector}`,
								sessionId
							}))
						}
						return yield* domService.takeElementScreenshot(element, sessionId, options)
					}),
				
				takeScreenshotWithSelectors: (selectors: readonly string[], options?: {
					format?: 'jpeg' | 'png'
					quality?: number
					highlightColor?: string
				}) =>
					Effect.gen(function* () {
						const elements = yield* Effect.all(
							selectors.map(selector =>
								Effect.gen(function* () {
									const element = yield* domService.querySelector(selector, sessionId)
									if (!element) {
										yield* Effect.fail(new BrowserSessionError({
											message: `Element not found for selector: ${selector}`,
											sessionId
										}))
									}
									return element
								})
							)
						)
						return yield* domService.takeScreenshotWithHighlight(elements, sessionId, options)
					}),
				
				// Serialization Operations (Epic 2.5)
				serializePageElements: (options?: SerializationOptions) =>
					Effect.gen(function* () {
						// Get all elements on the page using a broad selector
						const elements = yield* domService.querySelectorAll('*', sessionId)
						return yield* domService.serializeElements(elements, options)
					}),
				
				createPageSnapshot: () =>
					Effect.gen(function* () {
						const elements = yield* domService.querySelectorAll('*', sessionId)
						return yield* domService.createDOMSnapshot(elements, sessionId)
					}),
				
				compareWithSnapshot: (oldSnapshot: DOMSnapshot) =>
					Effect.gen(function* () {
						const currentElements = yield* domService.querySelectorAll('*', sessionId)
						const currentSnapshot = yield* domService.createDOMSnapshot(currentElements, sessionId)
						return yield* domService.compareDOMSnapshots(oldSnapshot, currentSnapshot)
					}),
				
				extractPageText: () =>
					Effect.gen(function* () {
						const elements = yield* domService.querySelectorAll('*', sessionId)
						return yield* domService.extractText(elements)
					}),
				
				extractPageStructure: () =>
					Effect.gen(function* () {
						const elements = yield* domService.querySelectorAll('*', sessionId)
						return yield* domService.extractStructure(elements)
					}),
				
				serializeElementsBySelector: (selector: string, options?: SerializationOptions) =>
					Effect.gen(function* () {
						const elements = yield* domService.querySelectorAll(selector, sessionId)
						return yield* domService.serializeElements(elements, options)
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
 * Requires: AppConfigService, CDPClient, and DOMService
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
	Layer.provide(DOMServiceLive),
	Layer.provide(WasmOptimizationServiceLive),
	Layer.provide(CDPClientLive)
)

/**
 * Export the AppConfig service tag for use in tests
 */
export { AppConfigService }

/**
 * Export DOMServiceLive for use in tests
 */
export { DOMServiceLive }