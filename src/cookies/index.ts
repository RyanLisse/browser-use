/**
 * @fileoverview Cookie and session management service for browser automation
 * Epic 3.3: Implement cookie and session management
 */

import { Context, Effect, Layer } from 'effect'
import { CDPClient } from '../cdp'
import { BrowserSessionError } from '../errors'

/**
 * Browser cookie representation
 */
export interface BrowserCookie {
	readonly name: string
	readonly value: string
	readonly domain: string
	readonly path?: string
	readonly expires?: number
	readonly httpOnly?: boolean
	readonly secure?: boolean
	readonly sameSite?: 'Strict' | 'Lax' | 'None'
	readonly priority?: 'Low' | 'Medium' | 'High'
}

/**
 * Cookie options for setting cookies
 */
export interface SetCookieOptions {
	readonly domain?: string
	readonly path?: string
	readonly expires?: number | Date
	readonly maxAge?: number
	readonly httpOnly?: boolean
	readonly secure?: boolean
	readonly sameSite?: 'Strict' | 'Lax' | 'None'
	readonly priority?: 'Low' | 'Medium' | 'High'
}

/**
 * Storage item for local/session storage
 */
export interface StorageItem {
	readonly key: string
	readonly value: string
}

/**
 * Session management options
 */
export interface SessionOptions {
	readonly clearOnStart?: boolean
	readonly preserveCookies?: boolean
	readonly preserveLocalStorage?: boolean
	readonly preserveSessionStorage?: boolean
}

/**
 * Cookie and session management service interface
 */
export interface CookieSessionServiceInterface {
	// Cookie management
	readonly getCookie: (
		name: string,
		sessionId: string
	) => Effect.Effect<BrowserCookie | null, BrowserSessionError>

	readonly getAllCookies: (
		sessionId: string,
		domain?: string
	) => Effect.Effect<readonly BrowserCookie[], BrowserSessionError>

	readonly setCookie: (
		cookie: Omit<BrowserCookie, 'domain'>,
		sessionId: string,
		options?: SetCookieOptions
	) => Effect.Effect<void, BrowserSessionError>

	readonly deleteCookie: (
		name: string,
		sessionId: string,
		domain?: string,
		path?: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly clearAllCookies: (
		sessionId: string,
		domain?: string
	) => Effect.Effect<void, BrowserSessionError>

	// Local Storage management
	readonly getLocalStorageItem: (
		key: string,
		sessionId: string
	) => Effect.Effect<string | null, BrowserSessionError>

	readonly setLocalStorageItem: (
		key: string,
		value: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly removeLocalStorageItem: (
		key: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly getAllLocalStorage: (
		sessionId: string
	) => Effect.Effect<readonly StorageItem[], BrowserSessionError>

	readonly clearLocalStorage: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	// Session Storage management
	readonly getSessionStorageItem: (
		key: string,
		sessionId: string
	) => Effect.Effect<string | null, BrowserSessionError>

	readonly setSessionStorageItem: (
		key: string,
		value: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly removeSessionStorageItem: (
		key: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly getAllSessionStorage: (
		sessionId: string
	) => Effect.Effect<readonly StorageItem[], BrowserSessionError>

	readonly clearSessionStorage: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	// Session management
	readonly saveSession: (
		sessionId: string,
		filePath: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly loadSession: (
		sessionId: string,
		filePath: string,
		options?: SessionOptions
	) => Effect.Effect<void, BrowserSessionError>

	readonly clearBrowserSession: (
		sessionId: string,
		options?: SessionOptions
	) => Effect.Effect<void, BrowserSessionError>

	// Utility methods
	readonly waitForCookie: (
		name: string,
		sessionId: string,
		timeout?: number
	) => Effect.Effect<BrowserCookie, BrowserSessionError>

	readonly cookieExists: (
		name: string,
		sessionId: string,
		domain?: string
	) => Effect.Effect<boolean, BrowserSessionError>
}

/**
 * Cookie and session service context tag
 */
export const CookieSessionService = Context.GenericTag<CookieSessionServiceInterface>('CookieSessionService')

/**
 * Create cookie and session management service implementation
 */
const makeCookieSessionService = Effect.gen(function* () {
	const cdp = yield* CDPClient

	const getCookie = (
		name: string,
		sessionId: string
	): Effect.Effect<BrowserCookie | null, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Getting cookie: ${name}`)

				const result = yield* cdp.send('Network.getCookies', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to get cookies`,
							sessionId,
							cause: error
						})
					)
				)

				const targetCookie = result.result.cookies.find((cookie: any) => cookie.name === name)

				if (!targetCookie) {
					return null
				}

				const browserCookie: BrowserCookie = {
					name: targetCookie.name,
					value: targetCookie.value,
					domain: targetCookie.domain,
					path: targetCookie.path,
					expires: targetCookie.expires,
					httpOnly: targetCookie.httpOnly,
					secure: targetCookie.secure,
					sameSite: targetCookie.sameSite as 'Strict' | 'Lax' | 'None',
					priority: targetCookie.priority as 'Low' | 'Medium' | 'High'
				}

				yield* Effect.logDebug(`Found cookie: ${name} = ${browserCookie.value}`)
				return browserCookie

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cookie retrieval failed: ${name}`,
					sessionId,
					cause: error
				}))
			}
		})

	const getAllCookies = (
		sessionId: string,
		domain?: string
	): Effect.Effect<readonly BrowserCookie[], BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Getting all cookies${domain ? ` for domain: ${domain}` : ''}`)

				const result = yield* cdp.send('Network.getCookies', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to get cookies`,
							sessionId,
							cause: error
						})
					)
				)

				let cookies = result.result.cookies

				// Filter by domain if specified
				if (domain) {
					cookies = cookies.filter((cookie: any) => cookie.domain === domain || cookie.domain === `.${domain}`)
				}

				const browserCookies: BrowserCookie[] = cookies.map((cookie: any) => ({
					name: cookie.name,
					value: cookie.value,
					domain: cookie.domain,
					path: cookie.path,
					expires: cookie.expires,
					httpOnly: cookie.httpOnly,
					secure: cookie.secure,
					sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None',
					priority: cookie.priority as 'Low' | 'Medium' | 'High'
				}))

				yield* Effect.logDebug(`Found ${browserCookies.length} cookies`)
				return browserCookies

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cookie retrieval failed`,
					sessionId,
					cause: error
				}))
			}
		})

	const setCookie = (
		cookie: Omit<BrowserCookie, 'domain'>,
		sessionId: string,
		options: SetCookieOptions = {}
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Setting cookie: ${cookie.name} = ${cookie.value}`)

				// Get current URL to determine domain if not specified
				const urlResult = yield* cdp.send('Target.getTargetInfo', {
					targetId: sessionId
				}).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get current URL',
							sessionId,
							cause: error
						})
					)
				)

				const currentUrl = new URL((urlResult.result as any).targetInfo.url)
				const domain = options.domain || currentUrl.hostname

				// Prepare cookie parameters
				let expires: number | undefined = undefined
				if (options.expires) {
					expires = options.expires instanceof Date 
						? Math.floor(options.expires.getTime() / 1000)
						: options.expires
				} else if (options.maxAge) {
					expires = Math.floor((Date.now() + options.maxAge * 1000) / 1000)
				}

				yield* cdp.send('Network.setCookie', {
					name: cookie.name,
					value: cookie.value,
					domain: domain,
					path: options.path || cookie.path || '/',
					expires: expires,
					httpOnly: options.httpOnly ?? cookie.httpOnly,
					secure: options.secure ?? cookie.secure,
					sameSite: options.sameSite ?? cookie.sameSite,
					priority: options.priority ?? cookie.priority
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to set cookie: ${cookie.name}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Cookie set: ${cookie.name}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cookie setting failed: ${cookie.name}`,
					sessionId,
					cause: error
				}))
			}
		})

	const deleteCookie = (
		name: string,
		sessionId: string,
		domain?: string,
		path?: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Deleting cookie: ${name}`)

				// Get current URL to determine domain if not specified
				if (!domain) {
					const urlResult = yield* cdp.send('Target.getTargetInfo', {
						targetId: sessionId
					}).pipe(
						Effect.mapError((error) =>
							new BrowserSessionError({
								message: 'Failed to get current URL',
								sessionId,
								cause: error
							})
						)
					)
					domain = new URL((urlResult.result as any).targetInfo.url).hostname
				}

				yield* cdp.send('Network.deleteCookies', {
					name,
					domain,
					path: path || '/'
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to delete cookie: ${name}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Cookie deleted: ${name}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cookie deletion failed: ${name}`,
					sessionId,
					cause: error
				}))
			}
		})

	const clearAllCookies = (
		sessionId: string,
		domain?: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Clearing all cookies${domain ? ` for domain: ${domain}` : ''}`)

				yield* cdp.send('Network.clearBrowserCookies', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to clear cookies',
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`All cookies cleared`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Cookie clearing failed`,
					sessionId,
					cause: error
				}))
			}
		})

	// Local Storage operations
	const getLocalStorageItem = (
		key: string,
		sessionId: string
	): Effect.Effect<string | null, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Getting localStorage item: ${key}`)

				const result = yield* cdp.send('Runtime.evaluate', {
					expression: `localStorage.getItem('${key}')`,
					returnByValue: true
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to get localStorage item: ${key}`,
							sessionId,
							cause: error
						})
					)
				)

				const value = (result.result as any).result.value
				yield* Effect.logDebug(`localStorage item ${key}: ${value}`)
				return value

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `localStorage get failed: ${key}`,
					sessionId,
					cause: error
				}))
			}
		})

	const setLocalStorageItem = (
		key: string,
		value: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Setting localStorage item: ${key} = ${value}`)

				yield* cdp.send('Runtime.evaluate', {
					expression: `localStorage.setItem('${key}', '${value}')`,
					returnByValue: false
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to set localStorage item: ${key}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`localStorage item set: ${key}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `localStorage set failed: ${key}`,
					sessionId,
					cause: error
				}))
			}
		})

	const removeLocalStorageItem = (
		key: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Removing localStorage item: ${key}`)

				yield* cdp.send('Runtime.evaluate', {
					expression: `localStorage.removeItem('${key}')`,
					returnByValue: false
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to remove localStorage item: ${key}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`localStorage item removed: ${key}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `localStorage remove failed: ${key}`,
					sessionId,
					cause: error
				}))
			}
		})

	const getAllLocalStorage = (
		sessionId: string
	): Effect.Effect<readonly StorageItem[], BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug('Getting all localStorage items')

				const result = yield* cdp.send('Runtime.evaluate', {
					expression: 'JSON.stringify(Object.entries(localStorage))',
					returnByValue: true
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get localStorage items',
							sessionId,
							cause: error
						})
					)
				)

				const entriesStr = (result.result as any).result.value
				const entries: [string, string][] = JSON.parse(entriesStr)
				
				const items: StorageItem[] = entries.map(([key, value]) => ({ key, value }))
				yield* Effect.logDebug(`Found ${items.length} localStorage items`)
				return items

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'localStorage retrieval failed',
					sessionId,
					cause: error
				}))
			}
		})

	const clearLocalStorage = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug('Clearing localStorage')

				yield* cdp.send('Runtime.evaluate', {
					expression: 'localStorage.clear()',
					returnByValue: false
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to clear localStorage',
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo('localStorage cleared')

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'localStorage clear failed',
					sessionId,
					cause: error
				}))
			}
		})

	// Session Storage operations (similar to localStorage but using sessionStorage)
	const getSessionStorageItem = (
		key: string,
		sessionId: string
	): Effect.Effect<string | null, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const result = yield* cdp.send('Runtime.evaluate', {
					expression: `sessionStorage.getItem('${key}')`,
					returnByValue: true
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to get sessionStorage item: ${key}`,
							sessionId,
							cause: error
						})
					)
				)

				return (result.result as any).result.value

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `sessionStorage get failed: ${key}`,
					sessionId,
					cause: error
				}))
			}
		})

	const setSessionStorageItem = (
		key: string,
		value: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Runtime.evaluate', {
					expression: `sessionStorage.setItem('${key}', '${value}')`,
					returnByValue: false
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to set sessionStorage item: ${key}`,
							sessionId,
							cause: error
						})
					)
				)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `sessionStorage set failed: ${key}`,
					sessionId,
					cause: error
				}))
			}
		})

	const removeSessionStorageItem = (
		key: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Runtime.evaluate', {
					expression: `sessionStorage.removeItem('${key}')`,
					returnByValue: false
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to remove sessionStorage item: ${key}`,
							sessionId,
							cause: error
						})
					)
				)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `sessionStorage remove failed: ${key}`,
					sessionId,
					cause: error
				}))
			}
		})

	const getAllSessionStorage = (
		sessionId: string
	): Effect.Effect<readonly StorageItem[], BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const result = yield* cdp.send('Runtime.evaluate', {
					expression: 'JSON.stringify(Object.entries(sessionStorage))',
					returnByValue: true
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get sessionStorage items',
							sessionId,
							cause: error
						})
					)
				)

				const entriesStr = (result.result as any).result.value
				const entries: [string, string][] = JSON.parse(entriesStr)
				return entries.map(([key, value]) => ({ key, value }))

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'sessionStorage retrieval failed',
					sessionId,
					cause: error
				}))
			}
		})

	const clearSessionStorage = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Runtime.evaluate', {
					expression: 'sessionStorage.clear()',
					returnByValue: false
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to clear sessionStorage',
							sessionId,
							cause: error
						})
					)
				)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'sessionStorage clear failed',
					sessionId,
					cause: error
				}))
			}
		})

	// Session management
	const saveSession = (
		sessionId: string,
		filePath: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Saving session to: ${filePath}`)

				const cookies = yield* getAllCookies(sessionId)
				const localStorage = yield* getAllLocalStorage(sessionId)
				const sessionStorage = yield* getAllSessionStorage(sessionId)

				const sessionData = {
					cookies,
					localStorage,
					sessionStorage,
					timestamp: Date.now()
				}

				const fs = require('fs')
				fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2))

				yield* Effect.logInfo(`Session saved: ${filePath}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Session save failed: ${filePath}`,
					sessionId,
					cause: error
				}))
			}
		})

	const loadSession = (
		sessionId: string,
		filePath: string,
		options: SessionOptions = {}
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Loading session from: ${filePath}`)

				const fs = require('fs')
				const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'))

				// Clear existing data if requested
				if (options.clearOnStart) {
					if (!options.preserveCookies) {
						yield* clearAllCookies(sessionId)
					}
					if (!options.preserveLocalStorage) {
						yield* clearLocalStorage(sessionId)
					}
					if (!options.preserveSessionStorage) {
						yield* clearSessionStorage(sessionId)
					}
				}

				// Restore cookies
				if (sessionData.cookies && !options.preserveCookies) {
					for (const cookie of sessionData.cookies) {
						yield* setCookie(cookie, sessionId)
					}
				}

				// Restore localStorage
				if (sessionData.localStorage && !options.preserveLocalStorage) {
					for (const item of sessionData.localStorage) {
						yield* setLocalStorageItem(item.key, item.value, sessionId)
					}
				}

				// Restore sessionStorage
				if (sessionData.sessionStorage && !options.preserveSessionStorage) {
					for (const item of sessionData.sessionStorage) {
						yield* setSessionStorageItem(item.key, item.value, sessionId)
					}
				}

				yield* Effect.logInfo(`Session loaded: ${filePath}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Session load failed: ${filePath}`,
					sessionId,
					cause: error
				}))
			}
		})

	const clearBrowserSession = (
		sessionId: string,
		options: SessionOptions = {}
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			yield* Effect.logDebug('Clearing browser session')

			if (!options.preserveCookies) {
				yield* clearAllCookies(sessionId)
			}
			if (!options.preserveLocalStorage) {
				yield* clearLocalStorage(sessionId)
			}
			if (!options.preserveSessionStorage) {
				yield* clearSessionStorage(sessionId)
			}

			yield* Effect.logInfo('Browser session cleared')
		})

	// Utility methods
	const waitForCookie = (
		name: string,
		sessionId: string,
		timeout = 5000
	): Effect.Effect<BrowserCookie, BrowserSessionError> =>
		Effect.gen(function* () {
			const startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const cookie = yield* getCookie(name, sessionId)
				if (cookie) {
					return cookie
				}
				yield* Effect.sleep('100 millis')
			}

			yield* Effect.fail(new BrowserSessionError({
				message: `Cookie timeout: ${name}`,
				sessionId
			}))
		})

	const cookieExists = (
		name: string,
		sessionId: string,
		domain?: string
	): Effect.Effect<boolean, BrowserSessionError> =>
		Effect.gen(function* () {
			const cookie = yield* getCookie(name, sessionId)
			if (!cookie) return false
			
			if (domain && cookie.domain !== domain && cookie.domain !== `.${domain}`) {
				return false
			}
			
			return true
		})

	return {
		getCookie,
		getAllCookies,
		setCookie,
		deleteCookie,
		clearAllCookies,
		getLocalStorageItem,
		setLocalStorageItem,
		removeLocalStorageItem,
		getAllLocalStorage,
		clearLocalStorage,
		getSessionStorageItem,
		setSessionStorageItem,
		removeSessionStorageItem,
		getAllSessionStorage,
		clearSessionStorage,
		saveSession,
		loadSession,
		clearBrowserSession,
		waitForCookie,
		cookieExists
	} satisfies CookieSessionServiceInterface
})

/**
 * Cookie and session management service layer
 */
export const CookieSessionServiceLive = Layer.effect(CookieSessionService, makeCookieSessionService)