/**
 * @fileoverview DOM serialization and parsing utilities
 * Epic 2.5: Create DOM serialization and parsing utilities
 */

import { Effect } from 'effect'
import { BrowserSessionError } from '../errors'
import type { DOMElement } from '../dom'

/**
 * DOM tree structure for serialization
 */
export interface DOMTree {
	readonly element: DOMElement
	readonly children: readonly DOMTree[]
	readonly parent?: DOMTree
	readonly depth: number
}

/**
 * Serialization format options
 */
export type SerializationFormat = 'json' | 'xml' | 'html' | 'markdown' | 'csv'

/**
 * Serialization options
 */
export interface SerializationOptions {
	readonly format: SerializationFormat
	readonly includeAttributes?: boolean
	readonly includeTextContent?: boolean
	readonly includePosition?: boolean
	readonly maxDepth?: number
	readonly prettyPrint?: boolean
}

/**
 * DOM snapshot for state comparison
 */
export interface DOMSnapshot {
	readonly timestamp: number
	readonly sessionId: string
	readonly elements: readonly DOMElement[]
	readonly tree: DOMTree
	readonly hash: string
}

/**
 * DOM diff result
 */
export interface DOMDiff {
	readonly added: readonly DOMElement[]
	readonly removed: readonly DOMElement[]
	readonly modified: readonly {
		readonly old: DOMElement
		readonly new: DOMElement
		readonly changes: readonly string[]
	}[]
	readonly unchanged: readonly DOMElement[]
}

/**
 * DOM serialization service interface
 */
export interface SerializationServiceInterface {
	readonly serializeElement: (
		element: DOMElement,
		options?: SerializationOptions
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly serializeElements: (
		elements: readonly DOMElement[],
		options?: SerializationOptions
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly buildDOMTree: (
		elements: readonly DOMElement[]
	) => Effect.Effect<DOMTree, BrowserSessionError>
	
	readonly createSnapshot: (
		elements: readonly DOMElement[],
		sessionId: string
	) => Effect.Effect<DOMSnapshot, BrowserSessionError>
	
	readonly compareSnapshots: (
		oldSnapshot: DOMSnapshot,
		newSnapshot: DOMSnapshot
	) => Effect.Effect<DOMDiff, BrowserSessionError>
	
	readonly parseElements: (
		serialized: string,
		format: SerializationFormat
	) => Effect.Effect<readonly DOMElement[], BrowserSessionError>
	
	readonly extractText: (
		elements: readonly DOMElement[]
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly extractStructure: (
		elements: readonly DOMElement[]
	) => Effect.Effect<Record<string, unknown>, BrowserSessionError>
}

/**
 * Create DOM serialization service implementation
 */
const makeSerializationService = (): SerializationServiceInterface => {
	const serializeElement = (
		element: DOMElement,
		options: SerializationOptions = { format: 'json' }
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				switch (options.format) {
					case 'json':
						return JSON.stringify(element, null, options.prettyPrint ? 2 : undefined)
					
					case 'xml':
						return yield* serializeToXML(element, options)
					
					case 'html':
						return yield* serializeToHTML(element, options)
					
					case 'markdown':
						return yield* serializeToMarkdown(element, options)
					
					case 'csv':
						return yield* serializeToCSV([element], options)
					
					default:
						yield* Effect.fail(new BrowserSessionError({
							message: `Unsupported serialization format: ${options.format}`
						}))
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Element serialization failed`,
					cause: error
				}))
			}
		})
	
	const serializeElements = (
		elements: readonly DOMElement[],
		options: SerializationOptions = { format: 'json' }
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				switch (options.format) {
					case 'json':
						return JSON.stringify(elements, null, options.prettyPrint ? 2 : undefined)
					
					case 'xml':
						return yield* serializeArrayToXML(elements, options)
					
					case 'html':
						return yield* serializeArrayToHTML(elements, options)
					
					case 'csv':
						return yield* serializeToCSV(elements, options)
					
					case 'markdown':
						return yield* serializeArrayToMarkdown(elements, options)
					
					default:
						yield* Effect.fail(new BrowserSessionError({
							message: `Unsupported serialization format: ${options.format}`
						}))
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Elements serialization failed`,
					cause: error
				}))
			}
		})
	
	const buildDOMTree = (
		elements: readonly DOMElement[]
	): Effect.Effect<DOMTree, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				// Simple tree building assuming first element is root
				if (elements.length === 0) {
					yield* Effect.fail(new BrowserSessionError({
						message: 'Cannot build DOM tree from empty elements array'
					}))
				}
				
				const root = elements[0]
				const tree: DOMTree = {
					element: root,
					children: [],
					depth: 0
				}
				
				// For simplicity, treat all other elements as children
				// In a real implementation, you'd use parent-child relationships
				const childTrees: DOMTree[] = elements.slice(1).map((element, index) => ({
					element,
					children: [],
					parent: tree,
					depth: 1
				}))
				
				return {
					...tree,
					children: childTrees
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `DOM tree building failed`,
					cause: error
				}))
			}
		})
	
	const createSnapshot = (
		elements: readonly DOMElement[],
		sessionId: string
	): Effect.Effect<DOMSnapshot, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const tree = yield* buildDOMTree(elements)
				
				// Create hash of the current state
				const serialized = JSON.stringify(elements)
				const hash = yield* generateHash(serialized)
				
				return {
					timestamp: Date.now(),
					sessionId,
					elements,
					tree,
					hash
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `DOM snapshot creation failed`,
					cause: error
				}))
			}
		})
	
	const compareSnapshots = (
		oldSnapshot: DOMSnapshot,
		newSnapshot: DOMSnapshot
	): Effect.Effect<DOMDiff, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const oldElementsMap = new Map(
					oldSnapshot.elements.map(el => [el.nodeId, el])
				)
				const newElementsMap = new Map(
					newSnapshot.elements.map(el => [el.nodeId, el])
				)
				
				const added: DOMElement[] = []
				const removed: DOMElement[] = []
				const modified: Array<{
					old: DOMElement
					new: DOMElement
					changes: string[]
				}> = []
				const unchanged: DOMElement[] = []
				
				// Find added and modified elements
				for (const newElement of newSnapshot.elements) {
					const oldElement = oldElementsMap.get(newElement.nodeId)
					
					if (!oldElement) {
						added.push(newElement)
					} else {
						const changes = yield* detectChanges(oldElement, newElement)
						if (changes.length > 0) {
							modified.push({
								old: oldElement,
								new: newElement,
								changes
							})
						} else {
							unchanged.push(newElement)
						}
					}
				}
				
				// Find removed elements
				for (const oldElement of oldSnapshot.elements) {
					if (!newElementsMap.has(oldElement.nodeId)) {
						removed.push(oldElement)
					}
				}
				
				return {
					added,
					removed,
					modified,
					unchanged
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Snapshot comparison failed`,
					cause: error
				}))
			}
		})
	
	const parseElements = (
		serialized: string,
		format: SerializationFormat
	): Effect.Effect<readonly DOMElement[], BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				switch (format) {
					case 'json':
						return JSON.parse(serialized) as DOMElement[]
					
					default:
						yield* Effect.fail(new BrowserSessionError({
							message: `Parsing format ${format} not implemented yet`
						}))
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Element parsing failed`,
					cause: error
				}))
			}
		})
	
	const extractText = (
		elements: readonly DOMElement[]
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const textContent = elements
					.map(element => element.textContent || '')
					.filter(text => text.trim().length > 0)
					.join(' ')
				
				return textContent
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Text extraction failed`,
					cause: error
				}))
			}
		})
	
	const extractStructure = (
		elements: readonly DOMElement[]
	): Effect.Effect<Record<string, unknown>, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const structure: Record<string, unknown> = {}
				
				// Group by tag name
				const byTagName: Record<string, DOMElement[]> = {}
				for (const element of elements) {
					if (!byTagName[element.tagName]) {
						byTagName[element.tagName] = []
					}
					byTagName[element.tagName].push(element)
				}
				
				structure.byTagName = byTagName
				structure.totalElements = elements.length
				structure.uniqueTagNames = Object.keys(byTagName).length
				
				// Extract common attributes
				const allAttributes = new Set<string>()
				for (const element of elements) {
					Object.keys(element.attributes).forEach(attr => allAttributes.add(attr))
				}
				structure.commonAttributes = Array.from(allAttributes)
				
				return structure
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Structure extraction failed`,
					cause: error
				}))
			}
		})
	
	return {
		serializeElement,
		serializeElements,
		buildDOMTree,
		createSnapshot,
		compareSnapshots,
		parseElements,
		extractText,
		extractStructure
	}
}

/**
 * Helper function to serialize element to XML
 */
const serializeToXML = (
	element: DOMElement,
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		let xml = `<${element.tagName.toLowerCase()}`
		
		if (options.includeAttributes !== false) {
			for (const [key, value] of Object.entries(element.attributes)) {
				xml += ` ${key}="${escapeXML(value)}"`
			}
		}
		
		if (options.includePosition && element.boundingBox) {
			xml += ` data-x="${element.boundingBox.x}" data-y="${element.boundingBox.y}"`
			xml += ` data-width="${element.boundingBox.width}" data-height="${element.boundingBox.height}"`
		}
		
		xml += '>'
		
		if (options.includeTextContent !== false && element.textContent) {
			xml += escapeXML(element.textContent)
		}
		
		xml += `</${element.tagName.toLowerCase()}>`
		
		return xml
	})

/**
 * Helper function to serialize elements array to XML
 */
const serializeArrayToXML = (
	elements: readonly DOMElement[],
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		const xmlElements = yield* Effect.all(
			elements.map(element => serializeToXML(element, options))
		)
		
		return `<elements>\n${xmlElements.join('\n')}\n</elements>`
	})

/**
 * Helper function to serialize element to HTML
 */
const serializeToHTML = (
	element: DOMElement,
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		let html = `<${element.tagName.toLowerCase()}`
		
		if (options.includeAttributes !== false) {
			for (const [key, value] of Object.entries(element.attributes)) {
				html += ` ${key}="${escapeHTML(value)}"`
			}
		}
		
		html += '>'
		
		if (options.includeTextContent !== false && element.textContent) {
			html += escapeHTML(element.textContent)
		}
		
		html += `</${element.tagName.toLowerCase()}>`
		
		return html
	})

/**
 * Helper function to serialize elements array to HTML
 */
const serializeArrayToHTML = (
	elements: readonly DOMElement[],
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		const htmlElements = yield* Effect.all(
			elements.map(element => serializeToHTML(element, options))
		)
		
		return htmlElements.join('\n')
	})

/**
 * Helper function to serialize element to Markdown
 */
const serializeToMarkdown = (
	element: DOMElement,
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		switch (element.tagName.toLowerCase()) {
			case 'h1':
			case 'h2':
			case 'h3':
			case 'h4':
			case 'h5':
			case 'h6':
				const level = parseInt(element.tagName.charAt(1))
				return '#'.repeat(level) + ' ' + (element.textContent || '')
			
			case 'p':
				return (element.textContent || '') + '\n'
			
			case 'a':
				const href = element.attributes.href
				return `[${element.textContent || ''}](${href || '#'})`
			
			case 'img':
				const src = element.attributes.src
				const alt = element.attributes.alt
				return `![${alt || ''}](${src || ''})`
			
			case 'strong':
			case 'b':
				return `**${element.textContent || ''}**`
			
			case 'em':
			case 'i':
				return `*${element.textContent || ''}*`
			
			default:
				return element.textContent || ''
		}
	})

/**
 * Helper function to serialize elements array to Markdown
 */
const serializeArrayToMarkdown = (
	elements: readonly DOMElement[],
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		const markdownElements = yield* Effect.all(
			elements.map(element => serializeToMarkdown(element, options))
		)
		
		return markdownElements.join('\n')
	})

/**
 * Helper function to serialize elements to CSV
 */
const serializeToCSV = (
	elements: readonly DOMElement[],
	options: SerializationOptions
): Effect.Effect<string, BrowserSessionError> =>
	Effect.gen(function* () {
		if (elements.length === 0) {
			return 'nodeId,tagName,textContent,attributes\n'
		}
		
		const headers = ['nodeId', 'tagName']
		
		if (options.includeTextContent !== false) {
			headers.push('textContent')
		}
		
		if (options.includeAttributes !== false) {
			headers.push('attributes')
		}
		
		if (options.includePosition) {
			headers.push('x', 'y', 'width', 'height')
		}
		
		const rows = elements.map(element => {
			const row = [element.nodeId.toString(), element.tagName]
			
			if (options.includeTextContent !== false) {
				row.push(escapeCSV(element.textContent || ''))
			}
			
			if (options.includeAttributes !== false) {
				row.push(escapeCSV(JSON.stringify(element.attributes)))
			}
			
			if (options.includePosition && element.boundingBox) {
				row.push(
					element.boundingBox.x.toString(),
					element.boundingBox.y.toString(),
					element.boundingBox.width.toString(),
					element.boundingBox.height.toString()
				)
			} else if (options.includePosition) {
				row.push('', '', '', '')
			}
			
			return row.join(',')
		})
		
		return headers.join(',') + '\n' + rows.join('\n')
	})

/**
 * Helper functions for escaping content
 */
const escapeXML = (text: string): string =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

const escapeHTML = (text: string): string =>
	text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')

const escapeCSV = (text: string): string => {
	if (text.includes(',') || text.includes('"') || text.includes('\n')) {
		return '"' + text.replace(/"/g, '""') + '"'
	}
	return text
}

/**
 * Generate hash for content
 */
const generateHash = (content: string): Effect.Effect<string, never> =>
	Effect.succeed(
		content.split('').reduce((a, b) => {
			a = ((a << 5) - a) + b.charCodeAt(0)
			return a & a
		}, 0).toString(36)
	)

/**
 * Detect changes between two DOM elements
 */
const detectChanges = (
	oldElement: DOMElement,
	newElement: DOMElement
): Effect.Effect<readonly string[], never> =>
	Effect.gen(function* () {
		const changes: string[] = []
		
		if (oldElement.tagName !== newElement.tagName) {
			changes.push('tagName')
		}
		
		if (oldElement.textContent !== newElement.textContent) {
			changes.push('textContent')
		}
		
		// Check attributes
		const oldAttrs = Object.keys(oldElement.attributes)
		const newAttrs = Object.keys(newElement.attributes)
		
		if (oldAttrs.length !== newAttrs.length) {
			changes.push('attributes')
		} else {
			for (const attr of oldAttrs) {
				if (oldElement.attributes[attr] !== newElement.attributes[attr]) {
					changes.push(`attribute:${attr}`)
				}
			}
		}
		
		// Check position
		if (oldElement.boundingBox && newElement.boundingBox) {
			if (
				oldElement.boundingBox.x !== newElement.boundingBox.x ||
				oldElement.boundingBox.y !== newElement.boundingBox.y ||
				oldElement.boundingBox.width !== newElement.boundingBox.width ||
				oldElement.boundingBox.height !== newElement.boundingBox.height
			) {
				changes.push('position')
			}
		}
		
		return changes
	})

/**
 * Export the service instance
 */
export const SerializationService = makeSerializationService()

/**
 * Export types and utilities
 */
export { makeSerializationService }
export type { SerializationServiceInterface }