/**
 * @fileoverview Tests for Epic 2.1: DOM querying and element selection
 */

import { describe, it, expect } from 'vitest'
import { Effect, Layer } from 'effect'
import { BrowserUse, BrowserUseLive, BrowserService, BrowserServiceLive, DOMServiceLive, AppConfigService, type BrowserUseInterface } from '../src/browser'
import { createMockCDPClientLive, CommonMockResponses, TestCDPConfigLive } from './cdp-mock'
import type { AppConfig, BrowserConfig } from '../src/config'

// Test configuration
const testConfig: AppConfig = {
	browser: {
		headless: true,
		viewport: { width: 1280, height: 720 },
		timeout: 30000,
		retryAttempts: 3,
	},
	cdp: {
		host: 'localhost',
		port: 9222,
		secure: false,
		connectionTimeout: 10000,
	},
	logLevel: 'info' as const,
}

// Mock DOM responses for testing
const mockDOMResponses = [
	CommonMockResponses.runtimeEnable,
	CommonMockResponses.pageEnable,
	CommonMockResponses.navigate,
	CommonMockResponses.screenshot,
	// DOM-specific mocks
	{
		method: 'DOM.enable',
		response: { id: 1, result: {} }
	},
	{
		method: 'DOM.getDocument',
		response: { 
			id: 2, 
			result: { 
				root: { 
					nodeId: 1, 
					nodeName: 'HTML', 
					nodeType: 1,
					childNodeCount: 2
				} 
			} 
		}
	},
	{
		method: 'DOM.querySelector',
		response: { id: 3, result: { nodeId: 42 } }
	},
	{
		method: 'DOM.querySelectorAll',
		response: { id: 4, result: { nodeIds: [42, 43, 44] } }
	},
	{
		method: 'DOM.describeNode',
		response: { 
			id: 5, 
			result: { 
				node: { 
					nodeId: 42, 
					nodeName: 'DIV', 
					nodeType: 1,
					attributes: ['id', 'test-element', 'class', 'test-class']
				} 
			} 
		}
	},
	{
		method: 'DOM.getBoxModel',
		response: { 
			id: 6, 
			result: { 
				model: {
					content: [100, 200, 300, 200, 300, 300, 100, 300],
					padding: [95, 195, 305, 195, 305, 305, 95, 305],
					border: [90, 190, 310, 190, 310, 310, 90, 310],
					margin: [85, 185, 315, 185, 315, 315, 85, 315],
					width: 200,
					height: 100
				}
			} 
		}
	}
]

// Create layers with proper dependency resolution using working pattern
const ConfigLayer = Layer.succeed(AppConfigService, testConfig)
const CDPConfigLayer = TestCDPConfigLive
const CDPLayer = createMockCDPClientLive(mockDOMResponses)

// Provide CDP dependencies first
const CDPWithConfig = Layer.provide(CDPLayer, CDPConfigLayer)

// Provide all dependencies to DOMService
const DOMServiceWithDeps = Layer.provide(DOMServiceLive, CDPWithConfig)

// Provide all dependencies to BrowserServiceLive
const BrowserServiceWithDeps = Layer.provide(
	BrowserServiceLive, 
	Layer.mergeAll(ConfigLayer, CDPWithConfig, DOMServiceWithDeps)
)

// BrowserUse layer with all dependencies
const TestLive = Layer.provide(
	Layer.effect(
		BrowserUse,
		Effect.gen(function* () {
			const browserService = yield* BrowserService
			const service: BrowserUseInterface = {
				create: (config?: Partial<BrowserConfig>) => browserService.createSession(config)
			}
			return service
		})
	),
	BrowserServiceWithDeps
)

describe('Epic 2.1: DOM Operations', () => {
	it('should enable DOM domain during session creation', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			expect(session).toBeDefined()
			expect(typeof session.querySelector).toBe('function')
			expect(typeof session.querySelectorAll).toBe('function')
			expect(typeof session.getElementById).toBe('function')
			expect(typeof session.getElementByText).toBe('function')
			expect(typeof session.waitForElement).toBe('function')
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should query single elements with querySelector', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Navigate to test page
			yield* session.navigate('https://example.com')
			
			// Query for an element
			const element = yield* session.querySelector('#test-element')
			
			expect(element).toBeDefined()
			expect(element?.nodeId).toBe(42)
			expect(element?.tagName).toBe('DIV')
			expect(element?.attributes.id).toBe('test-element')
			expect(element?.attributes.class).toBe('test-class')
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should query multiple elements with querySelectorAll', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Navigate to test page
			yield* session.navigate('https://example.com')
			
			// Query for multiple elements
			const elements = yield* session.querySelectorAll('.test-class')
			
			expect(Array.isArray(elements)).toBe(true)
			expect(elements.length).toBe(3)
			expect(elements[0].nodeId).toBe(42)
			expect(elements[0].tagName).toBe('DIV')
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should find elements by ID with getElementById', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Navigate to test page
			yield* session.navigate('https://example.com')
			
			// Find element by ID
			const element = yield* session.getElementById('test-element')
			
			expect(element).toBeDefined()
			expect(element?.nodeId).toBe(42)
			expect(element?.tagName).toBe('DIV')
			expect(element?.attributes.id).toBe('test-element')
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should handle elements not found gracefully', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Navigate to test page
			yield* session.navigate('https://example.com')
			
			// Try to find non-existent element (mock will return nodeId: 0)
			const element = yield* session.querySelector('#non-existent')
			
			expect(element).toBeNull()
			
			yield* session.close()
		})

		// Update mock to return no nodeId for non-existent elements
		const noElementMock = createMockCDPClientLive([
			CommonMockResponses.runtimeEnable,
			CommonMockResponses.pageEnable,
			CommonMockResponses.navigate,
			CommonMockResponses.screenshot,
			{ method: 'DOM.enable', response: { id: 1, result: {} } },
			{ method: 'DOM.getDocument', response: { id: 2, result: { root: { nodeId: 1, nodeName: 'HTML', nodeType: 1, childNodeCount: 2 } } } },
			{
				method: 'DOM.querySelector',
				response: { id: 3, result: { nodeId: 0 } } // No element found
			}
		])
		// Create test layers for no element case
		const NoElementCDPWithConfig = Layer.provide(noElementMock, CDPConfigLayer)
		const NoElementDOMServiceWithDeps = Layer.provide(DOMServiceLive, NoElementCDPWithConfig)
		const NoElementBrowserServiceWithDeps = Layer.provide(
			BrowserServiceLive, 
			Layer.mergeAll(ConfigLayer, NoElementCDPWithConfig, NoElementDOMServiceWithDeps)
		)
		
		const NoElementTestLive = Layer.provide(
			Layer.effect(
				BrowserUse,
				Effect.gen(function* () {
					const browserService = yield* BrowserService
					const service: BrowserUseInterface = {
						create: (config?: Partial<BrowserConfig>) => browserService.createSession(config)
					}
					return service
				})
			),
			NoElementBrowserServiceWithDeps
		)

		await Effect.runPromise(program.pipe(Effect.provide(NoElementTestLive)))
	})

	it('should include bounding box information when available', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Navigate to test page
			yield* session.navigate('https://example.com')
			
			// Query for an element (should include bounding box by default)
			const element = yield* session.querySelector('#test-element')
			
			expect(element).toBeDefined()
			expect(element?.boundingBox).toBeDefined()
			expect(element?.boundingBox?.x).toBe(90)
			expect(element?.boundingBox?.y).toBe(190)
			expect(element?.boundingBox?.width).toBe(220) // 310 - 90
			expect(element?.boundingBox?.height).toBe(120) // 310 - 190
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})

	it('should support DOM query options', async () => {
		const program = Effect.gen(function* () {
			const browserUse = yield* BrowserUse
			const session = yield* browserUse.create()
			
			// Navigate to test page
			yield* session.navigate('https://example.com')
			
			// Query with options to include invisible elements
			const element = yield* session.querySelector('#test-element', { 
				includeInvisible: true,
				timeout: 1000 
			})
			
			expect(element).toBeDefined()
			expect(element?.nodeId).toBe(42)
			// Should not have bounding box when includeInvisible is true
			expect(element?.boundingBox).toBeUndefined()
			
			yield* session.close()
		})

		await Effect.runPromise(program.pipe(Effect.provide(TestLive)))
	})
})