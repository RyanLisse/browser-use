/**
 * @fileoverview Chrome DevTools Protocol (CDP) client implementation using Effect
 */

import { Context, Effect, Layer, Schedule } from 'effect'
import CDP from 'chrome-remote-interface'
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
		}),

	/**
	 * Get DOM document
	 */
	getDocument: (sessionId?: string, depth?: number) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const result = yield* cdp.send('DOM.getDocument', depth ? { depth } : undefined, sessionId)
			return result.result as { 
				root: { 
					nodeId: number; 
					nodeName: string; 
					nodeType: number;
					attributes?: string[];
					childNodeCount?: number;
				} 
			}
		}),

	/**
	 * Query selector on a node
	 */
	querySelector: (nodeId: number, selector: string, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const result = yield* cdp.send('DOM.querySelector', { nodeId, selector }, sessionId)
			return result.result as { nodeId: number }
		}),

	/**
	 * Query all selectors on a node
	 */
	querySelectorAll: (nodeId: number, selector: string, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const result = yield* cdp.send('DOM.querySelectorAll', { nodeId, selector }, sessionId)
			return result.result as { nodeIds: number[] }
		}),

	/**
	 * Describe a DOM node
	 */
	describeNode: (nodeId: number, sessionId?: string, depth?: number) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const params = depth ? { nodeId, depth } : { nodeId }
			const result = yield* cdp.send('DOM.describeNode', params, sessionId)
			return result.result as { 
				node: { 
					nodeId: number;
					nodeName: string;
					nodeType: number;
					nodeValue?: string;
					attributes?: string[];
					childNodeCount?: number;
				} 
			}
		}),

	/**
	 * Get box model for a DOM node
	 */
	getBoxModel: (nodeId: number, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			const result = yield* cdp.send('DOM.getBoxModel', { nodeId }, sessionId)
			return result.result as { 
				model: {
					content: number[];
					padding: number[];
					border: number[];
					margin: number[];
					width: number;
					height: number;
				} | null
			}
		}),

	/**
	 * Enable DOM domain
	 */
	enableDOM: (sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('DOM.enable', undefined, sessionId)
		}),

	/**
	 * Click on a DOM element
	 */
	clickElement: (nodeId: number, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			
			// Get the center of the element's bounding box
			const boxResult = yield* cdp.send('DOM.getBoxModel', { nodeId }, sessionId)
			const model = (boxResult.result as { model: { border: number[] } }).model
			
			if (!model.border) {
				yield* Effect.fail(new CDPCommandError({
					message: 'Element has no visible box model',
					command: 'DOM.getBoxModel'
				}))
			}
			
			const border = model.border
			const centerX = (Math.max(...border.filter((_, i) => i % 2 === 0)) + Math.min(...border.filter((_, i) => i % 2 === 0))) / 2
			const centerY = (Math.max(...border.filter((_, i) => i % 2 === 1)) + Math.min(...border.filter((_, i) => i % 2 === 1))) / 2
			
			// Perform the click
			yield* cdp.send('Runtime.evaluate', {
				expression: `
					document.elementFromPoint(${centerX}, ${centerY}).click();
				`
			}, sessionId)
		}),

	/**
	 * Type text into a DOM element
	 */
	typeInElement: (nodeId: number, text: string, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			
			// Focus the element first
			yield* cdp.send('DOM.focus', { nodeId }, sessionId)
			
			// Clear existing content
			yield* cdp.send('Runtime.evaluate', {
				expression: `document.activeElement.value = '';`
			}, sessionId)
			
			// Type the text
			for (const char of text) {
				yield* cdp.send('Input.dispatchKeyEvent', {
					type: 'keyDown',
					text: char
				}, sessionId)
				yield* cdp.send('Input.dispatchKeyEvent', {
					type: 'char',
					text: char
				}, sessionId)
				yield* cdp.send('Input.dispatchKeyEvent', {
					type: 'keyUp',
					text: char
				}, sessionId)
			}
		}),

	/**
	 * Scroll to a DOM element
	 */
	scrollToElement: (nodeId: number, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('Runtime.evaluate', {
				expression: `
					const element = document.querySelector('[data-node-id="${nodeId}"]') || 
					                 document.evaluate('//node()[position()=${nodeId}]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
					if (element) {
						element.scrollIntoView({ behavior: 'smooth', block: 'center' });
					}
				`
			}, sessionId)
		}),

	/**
	 * Scroll page by offset
	 */
	scrollPage: (deltaX: number, deltaY: number, sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('Runtime.evaluate', {
				expression: `window.scrollBy(${deltaX}, ${deltaY});`
			}, sessionId)
		}),

	/**
	 * Enable Input domain
	 */
	enableInput: (sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('Input.enable', undefined, sessionId)
		}),

	/**
	 * Highlight DOM elements on the page
	 */
	highlightNode: (nodeId: number, sessionId?: string, highlightColor?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			
			const color = highlightColor || 'rgba(255, 0, 0, 0.3)'
			const highlightConfig = {
				showInfo: true,
				showStyles: false,
				showRulers: false,
				showExtensionLines: false,
				contentColor: color,
				paddingColor: 'rgba(147, 196, 125, 0.3)',
				borderColor: 'rgba(255, 229, 153, 0.3)',
				marginColor: 'rgba(246, 178, 107, 0.3)'
			}
			
			yield* cdp.send('DOM.highlightNode', {
				nodeId,
				highlightConfig
			}, sessionId)
		}),

	/**
	 * Hide element highlighting
	 */
	hideHighlight: (sessionId?: string) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			yield* cdp.send('DOM.hideHighlight', undefined, sessionId)
		}),

	/**
	 * Take screenshot with optional element highlighting
	 */
	captureScreenshotWithHighlight: (
		sessionId?: string, 
		nodeIds?: number[], 
		options?: { 
			format?: 'jpeg' | 'png'; 
			quality?: number;
			highlightColor?: string;
		}
	) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			
			// Highlight elements if provided
			if (nodeIds?.length) {
				yield* Effect.all(
					nodeIds.map(nodeId => 
						cdp.send('DOM.highlightNode', {
							nodeId,
							highlightConfig: {
								showInfo: true,
								showStyles: false,
								showRulers: false,
								showExtensionLines: false,
								contentColor: options?.highlightColor || 'rgba(255, 0, 0, 0.3)',
								paddingColor: 'rgba(147, 196, 125, 0.3)',
								borderColor: 'rgba(255, 229, 153, 0.3)',
								marginColor: 'rgba(246, 178, 107, 0.3)'
							}
						}, sessionId)
					)
				)
			}
			
			// Take screenshot
			const params = {
				format: options?.format || 'png',
				...(options?.quality && { quality: options.quality })
			}
			const result = yield* cdp.send('Page.captureScreenshot', params, sessionId)
			
			// Remove highlighting
			if (nodeIds?.length) {
				yield* cdp.send('DOM.hideHighlight', undefined, sessionId)
			}
			
			return result.result as { data: string }
		}),

	/**
	 * Capture screenshot of specific elements
	 */
	captureElementScreenshot: (nodeId: number, sessionId?: string, options?: { format?: 'jpeg' | 'png'; quality?: number }) =>
		Effect.gen(function* () {
			const cdp = yield* CDPClient
			
			// Get element's bounding box
			const boxResult = yield* cdp.send('DOM.getBoxModel', { nodeId }, sessionId)
			const model = (boxResult.result as { model: { border: number[] } }).model
			
			if (!model.border) {
				yield* Effect.fail(new CDPCommandError({
					message: 'Element has no visible box model for screenshot',
					command: 'DOM.getBoxModel'
				}))
			}
			
			const border = model.border
			const clip = {
				x: Math.min(...border.filter((_, i) => i % 2 === 0)),
				y: Math.min(...border.filter((_, i) => i % 2 === 1)),
				width: Math.max(...border.filter((_, i) => i % 2 === 0)) - Math.min(...border.filter((_, i) => i % 2 === 0)),
				height: Math.max(...border.filter((_, i) => i % 2 === 1)) - Math.min(...border.filter((_, i) => i % 2 === 1)),
				scale: 1
			}
			
			// Take screenshot with clipping
			const params = {
				format: options?.format || 'png',
				clip,
				...(options?.quality && { quality: options.quality })
			}
			const result = yield* cdp.send('Page.captureScreenshot', params, sessionId)
			
			return result.result as { data: string }
		})
}