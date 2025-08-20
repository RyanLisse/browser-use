/**
 * @fileoverview JavaScript runtime execution service for browser automation
 * Epic 3.5: Implement JavaScript execution in browser context
 */

import { Context, Effect, Layer } from 'effect'
import { CDPClient } from '../cdp'
import { BrowserSessionError } from '../errors'

/**
 * JavaScript execution result
 */
export interface ExecutionResult<T = unknown> {
	readonly result: T
	readonly type: string
	readonly exception?: {
		readonly message: string
		readonly stack?: string
		readonly name: string
	}
	readonly executionTime: number
	readonly contextId?: number
}

/**
 * JavaScript execution context information
 */
export interface ExecutionContext {
	readonly contextId: number
	readonly origin: string
	readonly name: string
	readonly auxData?: Record<string, unknown>
}

/**
 * Function execution options
 */
export interface FunctionExecutionOptions {
	readonly args?: readonly unknown[]
	readonly thisArg?: unknown
	readonly timeout?: number
	readonly awaitPromise?: boolean
	readonly returnByValue?: boolean
	readonly generatePreview?: boolean
	readonly contextId?: number
}

/**
 * Code evaluation options
 */
export interface CodeEvaluationOptions {
	readonly timeout?: number
	readonly awaitPromise?: boolean
	readonly returnByValue?: boolean
	readonly generatePreview?: boolean
	readonly contextId?: number
	readonly includeCommandLineAPI?: boolean
	readonly silent?: boolean
	readonly repl?: boolean
}

/**
 * Console message from browser
 */
export interface ConsoleMessage {
	readonly source: string
	readonly level: 'log' | 'debug' | 'info' | 'warn' | 'error'
	readonly text: string
	readonly args?: readonly unknown[]
	readonly stackTrace?: {
		readonly description?: string
		readonly callFrames: readonly {
			readonly functionName: string
			readonly scriptId: string
			readonly url: string
			readonly lineNumber: number
			readonly columnNumber: number
		}[]
	}
	readonly timestamp: number
}

/**
 * JavaScript exception information
 */
export interface JavaScriptException {
	readonly message: string
	readonly source: string
	readonly lineno?: number
	readonly colno?: number
	readonly error?: unknown
	readonly timestamp: number
}

/**
 * Runtime execution service interface
 */
export interface RuntimeExecutionServiceInterface {
	readonly enableRuntime: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly disableRuntime: (
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly evaluate: <T = unknown>(
		code: string,
		sessionId: string,
		options?: CodeEvaluationOptions
	) => Effect.Effect<ExecutionResult<T>, BrowserSessionError>

	readonly callFunction: <T = unknown>(
		functionName: string,
		sessionId: string,
		options?: FunctionExecutionOptions
	) => Effect.Effect<ExecutionResult<T>, BrowserSessionError>

	readonly defineFunction: (
		name: string,
		functionCode: string,
		sessionId: string,
		contextId?: number
	) => Effect.Effect<void, BrowserSessionError>

	readonly addScriptToEvaluateOnLoad: (
		scriptSource: string,
		sessionId: string
	) => Effect.Effect<string, BrowserSessionError>

	readonly removeScriptToEvaluateOnLoad: (
		identifier: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly addScriptToEvaluateOnNewDocument: (
		scriptSource: string,
		sessionId: string
	) => Effect.Effect<string, BrowserSessionError>

	readonly getExecutionContexts: (
		sessionId: string
	) => Effect.Effect<readonly ExecutionContext[], BrowserSessionError>

	readonly createExecutionContext: (
		name: string,
		sessionId: string
	) => Effect.Effect<ExecutionContext, BrowserSessionError>

	readonly getConsoleMessages: (
		sessionId: string
	) => Effect.Effect<readonly ConsoleMessage[], never>

	readonly clearConsoleMessages: (
		sessionId: string
	) => Effect.Effect<void, never>

	readonly onConsoleMessage: (
		sessionId: string,
		callback: (message: ConsoleMessage) => void
	) => Effect.Effect<void, never>

	readonly onException: (
		sessionId: string,
		callback: (exception: JavaScriptException) => void
	) => Effect.Effect<void, never>

	readonly waitForFunction: <T = unknown>(
		predicate: string,
		sessionId: string,
		options?: {
			readonly timeout?: number
			readonly polling?: number | 'raf' | 'mutation'
			readonly args?: readonly unknown[]
		}
	) => Effect.Effect<ExecutionResult<T>, BrowserSessionError>

	readonly injectScript: (
		scriptUrl: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly exposeFunction: (
		name: string,
		callback: (...args: unknown[]) => unknown | Promise<unknown>,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly setGlobalVariable: (
		name: string,
		value: unknown,
		sessionId: string,
		contextId?: number
	) => Effect.Effect<void, BrowserSessionError>

	readonly getGlobalVariable: <T = unknown>(
		name: string,
		sessionId: string,
		contextId?: number
	) => Effect.Effect<T, BrowserSessionError>
}

/**
 * Runtime execution service context tag
 */
export const RuntimeExecutionService = Context.GenericTag<RuntimeExecutionServiceInterface>('RuntimeExecutionService')

/**
 * Create runtime execution service implementation
 */
const makeRuntimeExecutionService = Effect.gen(function* () {
	const cdp = yield* CDPClient

	// State management for runtime
	const consoleMessages = new Map<string, ConsoleMessage[]>()
	const executionContexts = new Map<string, ExecutionContext[]>()
	const consoleCallbacks = new Map<string, Array<(message: ConsoleMessage) => void>>()
	const exceptionCallbacks = new Map<string, Array<(exception: JavaScriptException) => void>>()
	const exposedFunctions = new Map<string, Map<string, Function>>()

	const enableRuntime = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Enabling runtime for session: ${sessionId}`)

				// Enable Runtime domain
				yield* cdp.send('Runtime.enable', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to enable runtime',
							sessionId,
							cause: error
						})
					)
				)

				// Enable Console domain for console message handling
				yield* cdp.send('Console.enable', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to enable console',
							sessionId,
							cause: error
						})
					)
				)

				// Initialize session state
				if (!consoleMessages.has(sessionId)) {
					consoleMessages.set(sessionId, [])
				}
				if (!executionContexts.has(sessionId)) {
					executionContexts.set(sessionId, [])
				}

				// Set up console message listener
				yield* cdp.register.Runtime.consoleAPICalled((event) =>
					Effect.gen(function* () {
						const message: ConsoleMessage = {
							source: 'console',
							level: event.type as 'log' | 'debug' | 'info' | 'warn' | 'error',
							text: event.args?.map(arg => arg.value || String(arg.value)).join(' ') || '',
							args: event.args?.map(arg => arg.value),
							timestamp: event.timestamp
						}

						const messages = consoleMessages.get(sessionId) || []
						messages.push(message)
						consoleMessages.set(sessionId, messages)

						// Trigger callbacks
						const callbacks = consoleCallbacks.get(sessionId) || []
						callbacks.forEach(callback => callback(message))

						yield* Effect.logDebug(`Console message: ${message.level} - ${message.text}`)
					}).pipe(Effect.runSync)
				)

				// Set up exception listener
				yield* cdp.register.Runtime.exceptionThrown((event) =>
					Effect.gen(function* () {
						const exception: JavaScriptException = {
							message: event.exceptionDetails.text,
							source: event.exceptionDetails.url || 'unknown',
							lineno: event.exceptionDetails.lineNumber,
							colno: event.exceptionDetails.columnNumber,
							error: event.exceptionDetails.exception,
							timestamp: event.timestamp
						}

						// Trigger callbacks
						const callbacks = exceptionCallbacks.get(sessionId) || []
						callbacks.forEach(callback => callback(exception))

						yield* Effect.logError(`JavaScript exception: ${exception.message}`)
					}).pipe(Effect.runSync)
				)

				// Set up execution context listener
				yield* cdp.register.Runtime.executionContextCreated((event) =>
					Effect.gen(function* () {
						const context: ExecutionContext = {
							contextId: event.context.id,
							origin: event.context.origin,
							name: event.context.name,
							auxData: event.context.auxData
						}

						const contexts = executionContexts.get(sessionId) || []
						contexts.push(context)
						executionContexts.set(sessionId, contexts)

						yield* Effect.logDebug(`Execution context created: ${context.name} (${context.contextId})`)
					}).pipe(Effect.runSync)
				)

				yield* Effect.logInfo(`Runtime enabled for session: ${sessionId}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Runtime enablement failed',
					sessionId,
					cause: error
				}))
			}
		})

	const disableRuntime = (
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Runtime.disable', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to disable runtime',
							sessionId,
							cause: error
						})
					)
				)

				yield* cdp.send('Console.disable', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to disable console',
							sessionId,
							cause: error
						})
					)
				)

				// Clean up session state
				consoleMessages.delete(sessionId)
				executionContexts.delete(sessionId)
				consoleCallbacks.delete(sessionId)
				exceptionCallbacks.delete(sessionId)
				exposedFunctions.delete(sessionId)

				yield* Effect.logInfo(`Runtime disabled for session: ${sessionId}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Runtime disablement failed',
					sessionId,
					cause: error
				}))
			}
		})

	const evaluate = <T = unknown>(
		code: string,
		sessionId: string,
		options: CodeEvaluationOptions = {}
	): Effect.Effect<ExecutionResult<T>, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const startTime = performance.now()

				yield* Effect.logDebug(`Evaluating code: ${code.slice(0, 100)}${code.length > 100 ? '...' : ''}`)

				const result = yield* cdp.send('Runtime.evaluate', {
					expression: code,
					awaitPromise: options.awaitPromise ?? false,
					returnByValue: options.returnByValue ?? true,
					generatePreview: options.generatePreview ?? false,
					contextId: options.contextId,
					includeCommandLineAPI: options.includeCommandLineAPI ?? false,
					silent: options.silent ?? false,
					replMode: options.repl ?? false,
					timeout: options.timeout
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Code evaluation failed: ${code.slice(0, 50)}...`,
							sessionId,
							cause: error
						})
					)
				)

				const endTime = performance.now()

				const executionResult: ExecutionResult<T> = {
					result: result.result.result?.value as T,
					type: result.result.result?.type || 'undefined',
					exception: result.result.exceptionDetails ? {
						message: result.result.exceptionDetails.text,
						stack: result.result.exceptionDetails.stackTrace?.description,
						name: result.result.exceptionDetails.exception?.className || 'Error'
					} : undefined,
					executionTime: endTime - startTime,
					contextId: options.contextId
				}

				if (executionResult.exception) {
					yield* Effect.logError(`Code evaluation exception: ${executionResult.exception.message}`)
				} else {
					yield* Effect.logDebug(`Code evaluation completed in ${executionResult.executionTime}ms`)
				}

				return executionResult

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Code evaluation failed: ${code.slice(0, 50)}...`,
					sessionId,
					cause: error
				}))
			}
		})

	const callFunction = <T = unknown>(
		functionName: string,
		sessionId: string,
		options: FunctionExecutionOptions = {}
	): Effect.Effect<ExecutionResult<T>, BrowserSessionError> =>
		Effect.gen(function* () {
			const args = options.args || []
			const argsString = args.map(arg => JSON.stringify(arg)).join(', ')
			const callExpression = `${functionName}(${argsString})`

			return yield* evaluate<T>(callExpression, sessionId, {
				timeout: options.timeout,
				awaitPromise: options.awaitPromise,
				returnByValue: options.returnByValue,
				generatePreview: options.generatePreview,
				contextId: options.contextId
			})
		})

	const defineFunction = (
		name: string,
		functionCode: string,
		sessionId: string,
		contextId?: number
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const definition = `window.${name} = ${functionCode}`
			const result = yield* evaluate(definition, sessionId, { contextId })

			if (result.exception) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Function definition failed: ${name}`,
					sessionId,
					cause: result.exception
				}))
			}

			yield* Effect.logInfo(`Function defined: ${name}`)
		})

	const addScriptToEvaluateOnLoad = (
		scriptSource: string,
		sessionId: string
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const result = yield* cdp.send('Runtime.addScriptToEvaluateOnLoad', {
					scriptSource
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to add script to evaluate on load',
							sessionId,
							cause: error
						})
					)
				)

				const identifier = result.result.identifier
				yield* Effect.logInfo(`Script added to evaluate on load: ${identifier}`)
				return identifier

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Script addition failed',
					sessionId,
					cause: error
				}))
			}
		})

	const removeScriptToEvaluateOnLoad = (
		identifier: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* cdp.send('Runtime.removeScriptToEvaluateOnLoad', {
					identifier
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to remove script: ${identifier}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Script removed: ${identifier}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Script removal failed: ${identifier}`,
					sessionId,
					cause: error
				}))
			}
		})

	const addScriptToEvaluateOnNewDocument = (
		scriptSource: string,
		sessionId: string
	): Effect.Effect<string, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const result = yield* cdp.send('Runtime.addScriptToEvaluateOnNewDocument', {
					source: scriptSource
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to add script to evaluate on new document',
							sessionId,
							cause: error
						})
					)
				)

				const identifier = result.result.identifier
				yield* Effect.logInfo(`Script added to evaluate on new document: ${identifier}`)
				return identifier

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: 'Script addition to new document failed',
					sessionId,
					cause: error
				}))
			}
		})

	const getExecutionContexts = (
		sessionId: string
	): Effect.Effect<readonly ExecutionContext[], BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				const result = yield* cdp.send('Runtime.getIsolateId', {}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get execution contexts',
							sessionId,
							cause: error
						})
					)
				)

				const contexts = executionContexts.get(sessionId) || []
				return contexts

			} catch (error) {
				// Fallback to cached contexts
				return executionContexts.get(sessionId) || []
			}
		})

	const createExecutionContext = (
		name: string,
		sessionId: string
	): Effect.Effect<ExecutionContext, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				// Create an isolated world for the execution context
				const result = yield* cdp.send('Page.createIsolatedWorld', {
					frameId: sessionId, // Use session ID as frame ID
					worldName: name,
					grantUniveralAccess: true
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to create execution context: ${name}`,
							sessionId,
							cause: error
						})
					)
				)

				const context: ExecutionContext = {
					contextId: result.result.executionContextId,
					origin: 'isolated-world',
					name,
					auxData: { worldId: result.result.executionContextId }
				}

				const contexts = executionContexts.get(sessionId) || []
				contexts.push(context)
				executionContexts.set(sessionId, contexts)

				yield* Effect.logInfo(`Execution context created: ${name} (${context.contextId})`)
				return context

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Execution context creation failed: ${name}`,
					sessionId,
					cause: error
				}))
			}
		})

	const getConsoleMessages = (
		sessionId: string
	): Effect.Effect<readonly ConsoleMessage[], never> =>
		Effect.succeed(consoleMessages.get(sessionId) || [])

	const clearConsoleMessages = (
		sessionId: string
	): Effect.Effect<void, never> =>
		Effect.gen(function* () {
			consoleMessages.set(sessionId, [])
			yield* Effect.logInfo(`Console messages cleared for session: ${sessionId}`)
		})

	const onConsoleMessage = (
		sessionId: string,
		callback: (message: ConsoleMessage) => void
	): Effect.Effect<void, never> =>
		Effect.gen(function* () {
			if (!consoleCallbacks.has(sessionId)) {
				consoleCallbacks.set(sessionId, [])
			}
			consoleCallbacks.get(sessionId)!.push(callback)
		})

	const onException = (
		sessionId: string,
		callback: (exception: JavaScriptException) => void
	): Effect.Effect<void, never> =>
		Effect.gen(function* () {
			if (!exceptionCallbacks.has(sessionId)) {
				exceptionCallbacks.set(sessionId, [])
			}
			exceptionCallbacks.get(sessionId)!.push(callback)
		})

	const waitForFunction = <T = unknown>(
		predicate: string,
		sessionId: string,
		options: {
			readonly timeout?: number
			readonly polling?: number | 'raf' | 'mutation'
			readonly args?: readonly unknown[]
		} = {}
	): Effect.Effect<ExecutionResult<T>, BrowserSessionError> =>
		Effect.gen(function* () {
			const timeout = options.timeout || 30000
			const polling = options.polling || 100
			const startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const result = yield* evaluate<T>(predicate, sessionId, {
					returnByValue: true,
					args: options.args
				})

				if (result.exception) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Wait for function predicate error: ${result.exception.message}`,
						sessionId
					}))
				}

				if (result.result) {
					return result
				}

				if (typeof polling === 'number') {
					yield* Effect.sleep(`${polling} millis`)
				} else if (polling === 'raf') {
					yield* evaluate('new Promise(resolve => requestAnimationFrame(resolve))', sessionId, { awaitPromise: true })
				} else if (polling === 'mutation') {
					yield* Effect.sleep('50 millis') // Fallback for mutation observer
				}
			}

			yield* Effect.fail(new BrowserSessionError({
				message: `Wait for function timeout: ${predicate}`,
				sessionId
			}))
		})

	const injectScript = (
		scriptUrl: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const injectionCode = `
				new Promise((resolve, reject) => {
					const script = document.createElement('script');
					script.src = '${scriptUrl}';
					script.onload = () => resolve();
					script.onerror = (error) => reject(error);
					document.head.appendChild(script);
				})
			`

			const result = yield* evaluate(injectionCode, sessionId, { awaitPromise: true })

			if (result.exception) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Script injection failed: ${scriptUrl}`,
					sessionId,
					cause: result.exception
				}))
			}

			yield* Effect.logInfo(`Script injected: ${scriptUrl}`)
		})

	const exposeFunction = (
		name: string,
		callback: (...args: unknown[]) => unknown | Promise<unknown>,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			// Store the callback
			if (!exposedFunctions.has(sessionId)) {
				exposedFunctions.set(sessionId, new Map())
			}
			exposedFunctions.get(sessionId)!.set(name, callback)

			// Expose function to browser context
			const exposureCode = `
				window.${name} = async (...args) => {
					// This would need a communication mechanism back to Node.js
					// For now, this is a simplified implementation
					console.log('Exposed function called:', '${name}', args);
					return Promise.resolve();
				}
			`

			const result = yield* evaluate(exposureCode, sessionId)

			if (result.exception) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Function exposure failed: ${name}`,
					sessionId,
					cause: result.exception
				}))
			}

			yield* Effect.logInfo(`Function exposed: ${name}`)
		})

	const setGlobalVariable = (
		name: string,
		value: unknown,
		sessionId: string,
		contextId?: number
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const setterCode = `window.${name} = ${JSON.stringify(value)}`
			const result = yield* evaluate(setterCode, sessionId, { contextId })

			if (result.exception) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Global variable setting failed: ${name}`,
					sessionId,
					cause: result.exception
				}))
			}

			yield* Effect.logInfo(`Global variable set: ${name}`)
		})

	const getGlobalVariable = <T = unknown>(
		name: string,
		sessionId: string,
		contextId?: number
	): Effect.Effect<T, BrowserSessionError> =>
		Effect.gen(function* () {
			const result = yield* evaluate<T>(`window.${name}`, sessionId, {
				contextId,
				returnByValue: true
			})

			if (result.exception) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Global variable retrieval failed: ${name}`,
					sessionId,
					cause: result.exception
				}))
			}

			return result.result
		})

	return {
		enableRuntime,
		disableRuntime,
		evaluate,
		callFunction,
		defineFunction,
		addScriptToEvaluateOnLoad,
		removeScriptToEvaluateOnLoad,
		addScriptToEvaluateOnNewDocument,
		getExecutionContexts,
		createExecutionContext,
		getConsoleMessages,
		clearConsoleMessages,
		onConsoleMessage,
		onException,
		waitForFunction,
		injectScript,
		exposeFunction,
		setGlobalVariable,
		getGlobalVariable
	} satisfies RuntimeExecutionServiceInterface
})

/**
 * Runtime execution service layer
 */
export const RuntimeExecutionServiceLive = Layer.effect(RuntimeExecutionService, makeRuntimeExecutionService)