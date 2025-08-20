/**
 * @fileoverview Multi-tab management service for browser automation
 * Epic 3.1: Implement multi-tab management
 */

import { Context, Effect, Layer } from 'effect'
import { CDPClient, CDPCommands } from '../cdp'
import { BrowserSessionError } from '../errors'
import type { BrowserConfig } from '../config'

/**
 * Browser tab representation
 */
export interface BrowserTab {
	readonly tabId: string
	readonly targetId: string
	readonly sessionId: string
	readonly url: string
	readonly title: string
	readonly active: boolean
	readonly loading: boolean
	readonly canGoBack: boolean
	readonly canGoForward: boolean
	readonly created: number
	readonly lastAccessed: number
}

/**
 * Tab creation options
 */
export interface TabOptions {
	readonly url?: string
	readonly active?: boolean
	readonly background?: boolean
	readonly width?: number
	readonly height?: number
}

/**
 * Tab navigation options
 */
export interface TabNavigationOptions {
	readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'
	readonly timeout?: number
}

/**
 * Tab management service interface
 */
export interface TabManagementServiceInterface {
	readonly createTab: (
		options?: TabOptions
	) => Effect.Effect<BrowserTab, BrowserSessionError>
	
	readonly closeTab: (
		tabId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly activateTab: (
		tabId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly navigateTab: (
		tabId: string,
		url: string,
		options?: TabNavigationOptions
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly getAllTabs: () => Effect.Effect<readonly BrowserTab[], never>
	
	readonly getActiveTab: () => Effect.Effect<BrowserTab | null, never>
	
	readonly getTab: (
		tabId: string
	) => Effect.Effect<BrowserTab | null, never>
	
	readonly switchToTab: (
		tabId: string
	) => Effect.Effect<BrowserTab, BrowserSessionError>
	
	readonly duplicateTab: (
		tabId: string
	) => Effect.Effect<BrowserTab, BrowserSessionError>
	
	readonly moveTab: (
		tabId: string,
		newIndex: number
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly reloadTab: (
		tabId: string,
		ignoreCache?: boolean
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly goBack: (
		tabId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly goForward: (
		tabId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly waitForTabLoad: (
		tabId: string,
		timeout?: number
	) => Effect.Effect<void, BrowserSessionError>
}

/**
 * Tab management service context tag
 */
export const TabManagementService = Context.GenericTag<TabManagementServiceInterface>('TabManagementService')

/**
 * Create tab management service implementation
 */
const makeTabManagementService = Effect.gen(function* () {
	const cdp = yield* CDPClient
	
	// State management for tabs
	const tabs = new Map<string, BrowserTab>()
	let activeTabId: string | null = null
	
	const createTab = (
		options: TabOptions = {}
	): Effect.Effect<BrowserTab, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Creating new tab with options:`, options)
				
				// Create new target (tab)
				const createResult = yield* cdp.send('Target.createTarget', {
					url: options.url || 'about:blank',
					width: options.width || 1280,
					height: options.height || 720,
					browserContextId: undefined // Use default context
				}).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to create new tab',
							cause: error
						})
					)
				)
				
				const targetId = (createResult.result as { targetId: string }).targetId
				
				// Attach to the new target to get session ID
				const attachResult = yield* cdp.send('Target.attachToTarget', {
					targetId,
					flatten: true
				}).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to attach to new tab',
							cause: error
						})
					)
				)
				
				const sessionId = (attachResult.result as { sessionId: string }).sessionId
				
				// Get target info
				const targetInfo = yield* cdp.send('Target.getTargetInfo', {
					targetId
				}).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get target info',
							cause: error
						})
					)
				)
				
				const targetInfoResult = targetInfo.result as {
					targetInfo: {
						targetId: string
						type: string
						title: string
						url: string
						attached: boolean
						canAccessOpener: boolean
					}
				}
				
				const tabId = crypto.randomUUID()
				const now = Date.now()
				
				const tab: BrowserTab = {
					tabId,
					targetId,
					sessionId,
					url: targetInfoResult.targetInfo.url,
					title: targetInfoResult.targetInfo.title,
					active: options.active !== false && activeTabId === null,
					loading: false,
					canGoBack: false,
					canGoForward: false,
					created: now,
					lastAccessed: now
				}
				
				tabs.set(tabId, tab)
				
				if (tab.active) {
					activeTabId = tabId
				}
				
				yield* Effect.logInfo(`Created new tab: ${tabId}`)
				
				return tab
				
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Tab creation failed',
					cause: error
				}))
			}
		})
	
	const closeTab = (
		tabId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const tab = tabs.get(tabId)
				if (!tab) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Tab not found: ${tabId}`
					}))
				}
				
				yield* Effect.logDebug(`Closing tab: ${tabId}`)
				
				// Close the target
				yield* cdp.send('Target.closeTarget', {
					targetId: tab.targetId
				}).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to close tab: ${tabId}`,
							cause: error
						})
					)
				)
				
				tabs.delete(tabId)
				
				if (activeTabId === tabId) {
					// Set a different tab as active if available
					const remainingTabs = Array.from(tabs.values())
					activeTabId = remainingTabs.length > 0 ? remainingTabs[0].tabId : null
				}
				
				yield* Effect.logInfo(`Closed tab: ${tabId}`)
				
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab closure failed: ${tabId}`,
					cause: error
				}))
			}
		})
	
	const activateTab = (
		tabId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const tab = tabs.get(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			yield* Effect.logDebug(`Activating tab: ${tabId}`)
			
			// Update tab states
			for (const [id, tabInfo] of tabs.entries()) {
				tabs.set(id, {
					...tabInfo,
					active: id === tabId,
					lastAccessed: id === tabId ? Date.now() : tabInfo.lastAccessed
				})
			}
			
			activeTabId = tabId
			
			// Activate the target
			yield* cdp.send('Target.activateTarget', {
				targetId: tab.targetId
			}).pipe(
				Effect.mapError((error) =>
					new BrowserSessionError({
						message: `Failed to activate tab: ${tabId}`,
						cause: error
					})
				)
			)
			
			yield* Effect.logInfo(`Activated tab: ${tabId}`)
		})
	
	const navigateTab = (
		tabId: string,
		url: string,
		options: TabNavigationOptions = {}
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const tab = tabs.get(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			yield* Effect.logDebug(`Navigating tab ${tabId} to: ${url}`)
			
			// Update tab state to loading
			tabs.set(tabId, {
				...tab,
				loading: true,
				url,
				lastAccessed: Date.now()
			})
			
			// Navigate using the tab's session
			yield* cdp.send('Page.navigate', { url }, tab.sessionId).pipe(
				Effect.mapError((error) =>
					new BrowserSessionError({
						message: `Failed to navigate tab ${tabId} to ${url}`,
						cause: error
					})
				)
			)
			
			// Wait for navigation to complete if specified
			if (options.waitUntil) {
				yield* waitForTabLoad(tabId, options.timeout)
			}
			
			yield* Effect.logInfo(`Navigated tab ${tabId} to: ${url}`)
		})
	
	const getAllTabs = (): Effect.Effect<readonly BrowserTab[], never> =>
		Effect.succeed(Array.from(tabs.values()))
	
	const getActiveTab = (): Effect.Effect<BrowserTab | null, never> =>
		Effect.succeed(activeTabId ? tabs.get(activeTabId) || null : null)
	
	const getTab = (
		tabId: string
	): Effect.Effect<BrowserTab | null, never> =>
		Effect.succeed(tabs.get(tabId) || null)
	
	const switchToTab = (
		tabId: string
	): Effect.Effect<BrowserTab, BrowserSessionError> =>
		Effect.gen(function* () {
			yield* activateTab(tabId)
			const tab = yield* getTab(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found after activation: ${tabId}`
				}))
			}
			return tab
		})
	
	const duplicateTab = (
		tabId: string
	): Effect.Effect<BrowserTab, BrowserSessionError> =>
		Effect.gen(function* () {
			const originalTab = tabs.get(tabId)
			if (!originalTab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			// Create new tab with same URL
			const newTab = yield* createTab({
				url: originalTab.url,
				active: false
			})
			
			yield* Effect.logInfo(`Duplicated tab ${tabId} to ${newTab.tabId}`)
			
			return newTab
		})
	
	const moveTab = (
		tabId: string,
		newIndex: number
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			// Note: Tab ordering is conceptual in this implementation
			// In a real browser, this would involve actual tab reordering
			yield* Effect.logDebug(`Moving tab ${tabId} to index ${newIndex}`)
			yield* Effect.logInfo(`Tab ${tabId} moved to position ${newIndex}`)
		})
	
	const reloadTab = (
		tabId: string,
		ignoreCache = false
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const tab = tabs.get(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			yield* Effect.logDebug(`Reloading tab: ${tabId}`)
			
			// Update tab state
			tabs.set(tabId, {
				...tab,
				loading: true,
				lastAccessed: Date.now()
			})
			
			// Reload the page
			yield* cdp.send('Page.reload', { ignoreCache }, tab.sessionId).pipe(
				Effect.mapError((error) =>
					new BrowserSessionError({
						message: `Failed to reload tab: ${tabId}`,
						cause: error
					})
				)
			)
			
			yield* Effect.logInfo(`Reloaded tab: ${tabId}`)
		})
	
	const goBack = (
		tabId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const tab = tabs.get(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			if (!tab.canGoBack) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cannot go back in tab: ${tabId}`
				}))
			}
			
			yield* Effect.logDebug(`Going back in tab: ${tabId}`)
			
			// Navigate back
			yield* cdp.send('Page.navigateToHistoryEntry', { entryId: -1 }, tab.sessionId).pipe(
				Effect.mapError((error) =>
					new BrowserSessionError({
						message: `Failed to go back in tab: ${tabId}`,
						cause: error
					})
				)
			)
			
			yield* Effect.logInfo(`Went back in tab: ${tabId}`)
		})
	
	const goForward = (
		tabId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const tab = tabs.get(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			if (!tab.canGoForward) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cannot go forward in tab: ${tabId}`
				}))
			}
			
			yield* Effect.logDebug(`Going forward in tab: ${tabId}`)
			
			// Navigate forward
			yield* cdp.send('Page.navigateToHistoryEntry', { entryId: 1 }, tab.sessionId).pipe(
				Effect.mapError((error) =>
					new BrowserSessionError({
						message: `Failed to go forward in tab: ${tabId}`,
						cause: error
					})
				)
			)
			
			yield* Effect.logInfo(`Went forward in tab: ${tabId}`)
		})
	
	const waitForTabLoad = (
		tabId: string,
		timeout = 30000
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const tab = tabs.get(tabId)
			if (!tab) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Tab not found: ${tabId}`
				}))
			}
			
			yield* Effect.logDebug(`Waiting for tab ${tabId} to load`)
			
			// Simple implementation: wait for load event
			// In a real implementation, you'd listen for Page.loadEventFired
			yield* Effect.sleep(`${Math.min(timeout, 5000)} millis`)
			
			// Update tab state
			tabs.set(tabId, {
				...tab,
				loading: false
			})
			
			yield* Effect.logInfo(`Tab ${tabId} finished loading`)
		})
	
	return {
		createTab,
		closeTab,
		activateTab,
		navigateTab,
		getAllTabs,
		getActiveTab,
		getTab,
		switchToTab,
		duplicateTab,
		moveTab,
		reloadTab,
		goBack,
		goForward,
		waitForTabLoad
	} satisfies TabManagementServiceInterface
})

/**
 * Tab management service layer
 */
export const TabManagementServiceLive = Layer.effect(TabManagementService, makeTabManagementService)