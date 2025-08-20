/**
 * @fileoverview DOM operations service for browser automation
 * Epic 2.1: DOM querying and element selection
 */

import { Context, Effect, Layer } from 'effect'
import { CDPClient, CDPCommands } from '../cdp'
import { BrowserSessionError } from '../errors'
import { WasmOptimizationService, type WasmQueryResult } from '../wasm'
import { SerializationService, type SerializationOptions, type DOMSnapshot, type DOMDiff } from '../serialization'

/**
 * DOM element representation
 */
export interface DOMElement {
	readonly nodeId: number
	readonly tagName: string
	readonly attributes: Record<string, string>
	readonly textContent?: string
	readonly boundingBox?: {
		readonly x: number
		readonly y: number
		readonly width: number
		readonly height: number
	}
}

/**
 * DOM query selector options
 */
export interface DOMQueryOptions {
	readonly timeout?: number
	readonly waitForVisible?: boolean
	readonly includeInvisible?: boolean
}

/**
 * DOM service interface for element operations
 */
export interface DOMServiceInterface {
	readonly querySelector: (
		selector: string,
		sessionId: string,
		options?: DOMQueryOptions
	) => Effect.Effect<DOMElement | null, BrowserSessionError>
	
	readonly querySelectorAll: (
		selector: string,
		sessionId: string,
		options?: DOMQueryOptions
	) => Effect.Effect<readonly DOMElement[], BrowserSessionError>
	
	readonly getElementById: (
		id: string,
		sessionId: string,
		options?: DOMQueryOptions
	) => Effect.Effect<DOMElement | null, BrowserSessionError>
	
	readonly getElementByText: (
		text: string,
		sessionId: string,
		tagName?: string,
		options?: DOMQueryOptions
	) => Effect.Effect<DOMElement | null, BrowserSessionError>
	
	readonly waitForElement: (
		selector: string,
		sessionId: string,
		timeout?: number
	) => Effect.Effect<DOMElement, BrowserSessionError>
	
	// DOM Manipulation Operations (Epic 2.2)
	readonly clickElement: (
		element: DOMElement,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly typeInElement: (
		element: DOMElement,
		text: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly scrollToElement: (
		element: DOMElement,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly scrollPage: (
		deltaX: number,
		deltaY: number,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	// Screenshot Operations (Epic 2.3)
	readonly highlightElement: (
		element: DOMElement,
		sessionId: string,
		highlightColor?: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly hideHighlight: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly takeScreenshotWithHighlight: (
		elements: readonly DOMElement[],
		sessionId: string,
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
			highlightColor?: string
		}
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly takeElementScreenshot: (
		element: DOMElement,
		sessionId: string,
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
		}
	) => Effect.Effect<string, BrowserSessionError>
	
	// Serialization Operations (Epic 2.5)
	readonly serializeElements: (
		elements: readonly DOMElement[],
		options?: SerializationOptions
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly createDOMSnapshot: (
		elements: readonly DOMElement[],
		sessionId: string
	) => Effect.Effect<DOMSnapshot, BrowserSessionError>
	
	readonly compareDOMSnapshots: (
		oldSnapshot: DOMSnapshot,
		newSnapshot: DOMSnapshot
	) => Effect.Effect<DOMDiff, BrowserSessionError>
	
	readonly extractText: (
		elements: readonly DOMElement[]
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly extractStructure: (
		elements: readonly DOMElement[]
	) => Effect.Effect<Record<string, unknown>, BrowserSessionError>
}

/**
 * DOM service context tag
 */
export const DOMService = Context.GenericTag<DOMServiceInterface>('DOMService')

/**
 * Create DOM service implementation
 */
const makeDOMService = Effect.gen(function* () {
	const cdp = yield* CDPClient
	const wasmService = yield* WasmOptimizationService
	
	const querySelector = (
		selector: string,
		sessionId: string,
		options: DOMQueryOptions = {}
	): Effect.Effect<DOMElement | null, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Querying selector: ${selector}`)
				
				// Check if WASM optimization is available and beneficial
				const wasmEnabled = yield* wasmService.isEnabled()
				
				// Get document root
				const documentResult = yield* CDPCommands.getDocument(sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get document',
							sessionId,
							cause: error
						})
					)
				)
				
				// Query selector
				const queryResult = yield* CDPCommands.querySelector(
					documentResult.result.root.nodeId,
					selector,
					sessionId
				).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to query selector: ${selector}`,
							sessionId,
							cause: error
						})
					)
				)
				
				if (!queryResult.result.nodeId) {
					return null
				}
				
				// Get element details
				const nodeDetails = yield* CDPCommands.describeNode(
					queryResult.result.nodeId,
					sessionId
				).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to describe node',
							sessionId,
							cause: error
						})
					)
				)
				
				// Get bounding box if needed
				let boundingBox: DOMElement['boundingBox'] = undefined
				if (!options.includeInvisible) {
					const boxResult = yield* CDPCommands.getBoxModel(
						queryResult.result.nodeId,
						sessionId
					).pipe(
						Effect.provide(Layer.succeed(CDPClient, cdp)),
						Effect.catchAll(() => Effect.succeed({ result: { model: null } }))
					)
					
					if (boxResult.result.model?.border) {
						const border = boxResult.result.model.border
						boundingBox = {
							x: Math.min(...border.filter((_, i) => i % 2 === 0)),
							y: Math.min(...border.filter((_, i) => i % 2 === 1)),
							width: Math.max(...border.filter((_, i) => i % 2 === 0)) - Math.min(...border.filter((_, i) => i % 2 === 0)),
							height: Math.max(...border.filter((_, i) => i % 2 === 1)) - Math.min(...border.filter((_, i) => i % 2 === 1))
						}
					}
				}
				
				const node = nodeDetails.result.node
				const element: DOMElement = {
					nodeId: queryResult.result.nodeId,
					tagName: node.nodeName || 'UNKNOWN',
					attributes: node.attributes ? 
						Object.fromEntries(
							Array.from({ length: node.attributes.length / 2 }, (_, i) => [
								node.attributes![i * 2],
								node.attributes![i * 2 + 1]
							])
						) : {},
					textContent: node.nodeValue || undefined,
					boundingBox
				}
				
				yield* Effect.logDebug(`Found element: ${element.tagName}#${element.attributes.id}`)
				return element
				
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `DOM query failed for selector: ${selector}`,
					sessionId,
					cause: error
				}))
			}
		}).pipe(
			options.timeout ? 
				Effect.timeout(`${options.timeout} millis`) :
				Effect.identity
		)
	
	const querySelectorAll = (
		selector: string,
		sessionId: string,
		options: DOMQueryOptions = {}
	): Effect.Effect<readonly DOMElement[], BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Querying all selectors: ${selector}`)
				
				// Use WASM performance measurement for complex queries
				const wasmEnabled = yield* wasmService.isEnabled()
				
				const queryOperation = () => Effect.gen(function* () {
					// Get document root
					const documentResult = yield* CDPCommands.getDocument(sessionId).pipe(
						Effect.provide(Layer.succeed(CDPClient, cdp))
					)
					
					// Query all selectors
					const queryResult = yield* CDPCommands.querySelectorAll(
						documentResult.result.root.nodeId,
						selector,
						sessionId
					).pipe(
						Effect.provide(Layer.succeed(CDPClient, cdp))
					)
					
					if (!queryResult.result.nodeIds?.length) {
						return []
					}
					
					// Get details for all elements
					const elements = yield* Effect.all(
						queryResult.result.nodeIds.map(nodeId =>
							Effect.gen(function* () {
								const nodeDetails = yield* CDPCommands.describeNode(nodeId, sessionId).pipe(
									Effect.provide(Layer.succeed(CDPClient, cdp))
								)
								
								const node = nodeDetails.result.node
								return {
									nodeId,
									tagName: node.nodeName || 'UNKNOWN',
									attributes: node.attributes ? 
										Object.fromEntries(
											Array.from({ length: node.attributes.length / 2 }, (_, i) => [
												node.attributes![i * 2],
												node.attributes![i * 2 + 1]
											])
										) : {},
									textContent: node.nodeValue || undefined
								} satisfies DOMElement
							})
						)
					)
					
					return elements
				})
				
				// Measure performance with WASM optimization service
				const { result: elements, executionTime } = yield* wasmService.measurePerformance(
					queryOperation,
					`querySelectorAll(${selector})`
				)
				
				// Optionally use WASM optimization for post-processing if beneficial
				if (wasmEnabled && elements.length > 10) {
					yield* Effect.logDebug(`Large result set (${elements.length}), checking for WASM optimization opportunities`)
					
					const optimizedResult = yield* wasmService.optimizeQuery(selector, elements)
					
					if (optimizedResult.optimized) {
						yield* Effect.logInfo(`WASM optimization improved query performance: ${executionTime}ms -> ${optimizedResult.executionTime}ms`)
						return optimizedResult.elements
					}
				}
				
				yield* Effect.logDebug(`Found ${elements.length} elements in ${executionTime}ms`)
				return elements
				
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `DOM queryAll failed for selector: ${selector}`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const getElementById = (
		id: string,
		sessionId: string,
		options?: DOMQueryOptions
	): Effect.Effect<DOMElement | null, BrowserSessionError> =>
		querySelector(`#${id}`, sessionId, options)
	
	const getElementByText = (
		text: string,
		sessionId: string,
		tagName = '*',
		options?: DOMQueryOptions
	): Effect.Effect<DOMElement | null, BrowserSessionError> =>
		querySelector(`${tagName}:contains("${text}")`, sessionId, options)
	
	const waitForElement = (
		selector: string,
		sessionId: string,
		timeout = 5000
	): Effect.Effect<DOMElement, BrowserSessionError> =>
		Effect.gen(function* () {
			const element = yield* querySelector(selector, sessionId, { timeout }).pipe(
				Effect.retry({ times: Math.floor(timeout / 100) }),
				Effect.timeout(`${timeout} millis`)
			)
			
			if (!element) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Element not found within timeout: ${selector}`,
					sessionId
				}))
			}
			
			return element
		})
	
	const clickElement = (
		element: DOMElement,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Clicking element: ${element.tagName}#${element.attributes.id}`)
				
				yield* CDPCommands.clickElement(element.nodeId, sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to click element: ${element.tagName}`,
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Element clicked successfully')
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Click operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const typeInElement = (
		element: DOMElement,
		text: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Typing "${text}" in element: ${element.tagName}#${element.attributes.id}`)
				
				yield* CDPCommands.typeInElement(element.nodeId, text, sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to type in element: ${element.tagName}`,
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Text typed successfully')
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Type operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const scrollToElement = (
		element: DOMElement,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Scrolling to element: ${element.tagName}#${element.attributes.id}`)
				
				yield* CDPCommands.scrollToElement(element.nodeId, sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to scroll to element: ${element.tagName}`,
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Scrolled to element successfully')
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Scroll operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const scrollPage = (
		deltaX: number,
		deltaY: number,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Scrolling page by (${deltaX}, ${deltaY})`)
				
				yield* CDPCommands.scrollPage(deltaX, deltaY, sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to scroll page`,
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Page scrolled successfully')
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Page scroll operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const highlightElement = (
		element: DOMElement,
		sessionId: string,
		highlightColor?: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Highlighting element: ${element.tagName}#${element.attributes.id}`)
				
				yield* CDPCommands.highlightNode(element.nodeId, sessionId, highlightColor).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to highlight element: ${element.tagName}`,
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Element highlighted successfully')
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Highlight operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const hideHighlight = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug('Hiding element highlights')
				
				yield* CDPCommands.hideHighlight(sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to hide highlights',
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Highlights hidden successfully')
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Hide highlight operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const takeScreenshotWithHighlight = (
		elements: readonly DOMElement[],
		sessionId: string,
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
			highlightColor?: string
		}
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Taking screenshot with ${elements.length} highlighted elements`)
				
				const nodeIds = elements.map(el => el.nodeId)
				const result = yield* CDPCommands.captureScreenshotWithHighlight(
					sessionId,
					nodeIds,
					options
				).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to capture screenshot with highlights',
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Screenshot with highlights captured successfully')
				return `data:image/${options?.format || 'png'};base64,${result.data}`
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Screenshot with highlights operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	const takeElementScreenshot = (
		element: DOMElement,
		sessionId: string,
		options?: {
			format?: 'jpeg' | 'png'
			quality?: number
		}
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Taking screenshot of element: ${element.tagName}#${element.attributes.id}`)
				
				const result = yield* CDPCommands.captureElementScreenshot(
					element.nodeId,
					sessionId,
					options
				).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to capture element screenshot: ${element.tagName}`,
							sessionId,
							cause: error
						})
					)
				)
				
				yield* Effect.logDebug('Element screenshot captured successfully')
				return `data:image/${options?.format || 'png'};base64,${result.data}`
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Element screenshot operation failed`,
					sessionId,
					cause: error
				}))
			}
		})
	
	// Serialization Operations (Epic 2.5)
	const serializeElements = (
		elements: readonly DOMElement[],
		options?: SerializationOptions
	): Effect.Effect<string, BrowserSessionError> =>
		SerializationService.serializeElements(elements, options)
	
	const createDOMSnapshot = (
		elements: readonly DOMElement[],
		sessionId: string
	): Effect.Effect<DOMSnapshot, BrowserSessionError> =>
		SerializationService.createSnapshot(elements, sessionId)
	
	const compareDOMSnapshots = (
		oldSnapshot: DOMSnapshot,
		newSnapshot: DOMSnapshot
	): Effect.Effect<DOMDiff, BrowserSessionError> =>
		SerializationService.compareSnapshots(oldSnapshot, newSnapshot)
	
	const extractText = (
		elements: readonly DOMElement[]
	): Effect.Effect<string, BrowserSessionError> =>
		SerializationService.extractText(elements)
	
	const extractStructure = (
		elements: readonly DOMElement[]
	): Effect.Effect<Record<string, unknown>, BrowserSessionError> =>
		SerializationService.extractStructure(elements)
	
	return {
		querySelector,
		querySelectorAll,
		getElementById,
		getElementByText,
		waitForElement,
		clickElement,
		typeInElement,
		scrollToElement,
		scrollPage,
		highlightElement,
		hideHighlight,
		takeScreenshotWithHighlight,
		takeElementScreenshot,
		serializeElements,
		createDOMSnapshot,
		compareDOMSnapshots,
		extractText,
		extractStructure
	} satisfies DOMServiceInterface
})

/**
 * DOM service layer (requires CDPClient and WasmOptimizationService)
 */
export const DOMServiceLive = Layer.effect(DOMService, makeDOMService)