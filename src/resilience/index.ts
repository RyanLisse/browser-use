/**
 * @fileoverview Comprehensive error recovery and retry logic
 * Epic 4.2: Add comprehensive error recovery and retry logic
 */

import { Context, Effect, Layer, Ref, Schedule, Duration } from 'effect'
import { BrowserSessionError, CDPConnectionError, CDPCommandError } from '../errors'

/**
 * Circuit breaker states
 */
type CircuitBreakerState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
	readonly failureThreshold: number
	readonly timeoutDuration: number // milliseconds
	readonly resetTimeout: number // milliseconds
	readonly halfOpenMaxCalls: number
}

/**
 * Retry policy configuration
 */
export interface RetryPolicyConfig {
	readonly maxAttempts: number
	readonly initialDelay: number // milliseconds
	readonly maxDelay: number // milliseconds
	readonly backoffFactor: number
	readonly jitter: boolean
	readonly retryableErrors: readonly string[]
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
	readonly operationTimeout: number // milliseconds
	readonly connectionTimeout: number // milliseconds
	readonly commandTimeout: number // milliseconds
}

/**
 * Resilience configuration
 */
export interface ResilienceConfig {
	readonly circuitBreaker: CircuitBreakerConfig
	readonly retryPolicy: RetryPolicyConfig
	readonly timeout: TimeoutConfig
	readonly enableBulkheads: boolean
	readonly maxConcurrentOperations: number
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
	readonly state: CircuitBreakerState
	readonly failureCount: number
	readonly successCount: number
	readonly totalRequests: number
	readonly lastFailureTime: number | null
	readonly lastStateChange: number
}

/**
 * Error recovery context
 */
export interface ErrorRecoveryContext {
	readonly operationId: string
	readonly attempt: number
	readonly lastError: unknown
	readonly startTime: number
	readonly operationType: 'connection' | 'command' | 'session' | 'navigation'
}

/**
 * Recovery strategy result
 */
export interface RecoveryResult<T> {
	readonly success: boolean
	readonly result?: T
	readonly error?: BrowserSessionError
	readonly recoveryActions: readonly string[]
	readonly duration: number
}

/**
 * Resilience service interface
 */
export interface ResilienceServiceInterface {
	readonly withRetry: <A, E extends BrowserSessionError>(
		operation: () => Effect.Effect<A, E>,
		operationType: string
	) => Effect.Effect<A, E>
	
	readonly withCircuitBreaker: <A, E extends BrowserSessionError>(
		operation: () => Effect.Effect<A, E>,
		breakerName: string
	) => Effect.Effect<A, E>
	
	readonly withTimeout: <A, E extends BrowserSessionError>(
		operation: () => Effect.Effect<A, E>,
		timeoutMs?: number
	) => Effect.Effect<A, E>
	
	readonly withBulkhead: <A, E extends BrowserSessionError>(
		operation: () => Effect.Effect<A, E>,
		bulkheadName: string
	) => Effect.Effect<A, E>
	
	readonly recoverFromError: <A>(
		error: BrowserSessionError,
		context: ErrorRecoveryContext,
		recoveryFn: () => Effect.Effect<A, BrowserSessionError>
	) => Effect.Effect<RecoveryResult<A>, never>
	
	readonly getCircuitBreakerMetrics: (
		breakerName: string
	) => Effect.Effect<CircuitBreakerMetrics | null, never>
	
	readonly resetCircuitBreaker: (
		breakerName: string
	) => Effect.Effect<void, never>
	
	readonly healthCheck: () => Effect.Effect<boolean, never>
}

/**
 * Resilience service context tag
 */
export const ResilienceService = Context.GenericTag<ResilienceServiceInterface>('ResilienceService')

/**
 * Default resilience configuration
 */
export const defaultResilienceConfig: ResilienceConfig = {
	circuitBreaker: {
		failureThreshold: 5,
		timeoutDuration: 10000,
		resetTimeout: 60000,
		halfOpenMaxCalls: 3
	},
	retryPolicy: {
		maxAttempts: 3,
		initialDelay: 100,
		maxDelay: 5000,
		backoffFactor: 2,
		jitter: true,
		retryableErrors: ['CDPConnectionError', 'CDPCommandError', 'TimeoutError', 'NetworkError']
	},
	timeout: {
		operationTimeout: 30000,
		connectionTimeout: 10000,
		commandTimeout: 5000
	},
	enableBulkheads: true,
	maxConcurrentOperations: 100
}

/**
 * Circuit breaker state management
 */
interface CircuitBreakerState_Internal {
	readonly state: CircuitBreakerState
	readonly failureCount: number
	readonly successCount: number
	readonly totalRequests: number
	readonly lastFailureTime: number | null
	readonly lastStateChange: number
	readonly halfOpenCalls: number
}

/**
 * Bulkhead (resource isolation) state
 */
interface BulkheadState {
	readonly name: string
	readonly maxConcurrency: number
	readonly currentConcurrency: number
	readonly queueSize: number
	readonly rejectedCount: number
}

/**
 * Create resilience service implementation
 */
const makeResilienceService = (config: ResilienceConfig = defaultResilienceConfig) =>
	Effect.gen(function* () {
		// Circuit breaker state management
		const circuitBreakers = yield* Ref.make(new Map<string, CircuitBreakerState_Internal>())
		
		// Bulkhead state management
		const bulkheads = yield* Ref.make(new Map<string, BulkheadState>())
		
		// Global semaphore for concurrent operations
		const globalSemaphore = yield* Effect.makeSemaphore(config.maxConcurrentOperations)
		
		/**
		 * Determine if an error is retryable
		 */
		const isRetryableError = (error: unknown): boolean => {
			if (error instanceof BrowserSessionError) {
				return config.retryPolicy.retryableErrors.some(errorType =>
					error.constructor.name === errorType ||
					error.message.includes(errorType.replace('Error', ''))
				)
			}
			return false
		}
		
		/**
		 * Calculate retry delay with jitter
		 */
		const calculateRetryDelay = (attempt: number): number => {
			const baseDelay = Math.min(
				config.retryPolicy.initialDelay * Math.pow(config.retryPolicy.backoffFactor, attempt - 1),
				config.retryPolicy.maxDelay
			)
			
			if (config.retryPolicy.jitter) {
				// Add ±25% jitter
				const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1)
				return Math.max(0, baseDelay + jitter)
			}
			
			return baseDelay
		}
		
		/**
		 * Get or create circuit breaker state
		 */
		const getCircuitBreakerState = (breakerName: string): Effect.Effect<CircuitBreakerState_Internal, never> =>
			Effect.gen(function* () {
				const breakers = yield* Ref.get(circuitBreakers)
				const existing = breakers.get(breakerName)
				
				if (existing) {
					return existing
				}
				
				const newState: CircuitBreakerState_Internal = {
					state: 'closed',
					failureCount: 0,
					successCount: 0,
					totalRequests: 0,
					lastFailureTime: null,
					lastStateChange: Date.now(),
					halfOpenCalls: 0
				}
				
				yield* Ref.update(circuitBreakers, breakers =>
					new Map(breakers).set(breakerName, newState)
				)
				
				return newState
			})
		
		/**
		 * Update circuit breaker state
		 */
		const updateCircuitBreakerState = (
			breakerName: string,
			update: (state: CircuitBreakerState_Internal) => CircuitBreakerState_Internal
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* Ref.update(circuitBreakers, breakers => {
					const current = breakers.get(breakerName)
					if (!current) return breakers
					
					const newState = update(current)
					return new Map(breakers).set(breakerName, newState)
				})
			})
		
		/**
		 * Check if circuit breaker should allow request
		 */
		const shouldAllowRequest = (state: CircuitBreakerState_Internal): boolean => {
			const now = Date.now()
			
			switch (state.state) {
				case 'closed':
					return true
				case 'open':
					return now - state.lastStateChange >= config.circuitBreaker.resetTimeout
				case 'half-open':
					return state.halfOpenCalls < config.circuitBreaker.halfOpenMaxCalls
				default:
					return false
			}
		}
		
		/**
		 * Handle circuit breaker success
		 */
		const onCircuitBreakerSuccess = (breakerName: string): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* updateCircuitBreakerState(breakerName, state => {
					const newSuccessCount = state.successCount + 1
					const newTotalRequests = state.totalRequests + 1
					
					if (state.state === 'half-open') {
						// Reset to closed if enough successful calls
						if (newSuccessCount >= config.circuitBreaker.halfOpenMaxCalls) {
							return {
								...state,
								state: 'closed',
								failureCount: 0,
								successCount: newSuccessCount,
								totalRequests: newTotalRequests,
								halfOpenCalls: 0,
								lastStateChange: Date.now()
							}
						}
						
						return {
							...state,
							successCount: newSuccessCount,
							totalRequests: newTotalRequests,
							halfOpenCalls: state.halfOpenCalls + 1
						}
					}
					
					return {
						...state,
						successCount: newSuccessCount,
						totalRequests: newTotalRequests
					}
				})
			})
		
		/**
		 * Handle circuit breaker failure
		 */
		const onCircuitBreakerFailure = (breakerName: string): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				const now = Date.now()
				
				yield* updateCircuitBreakerState(breakerName, state => {
					const newFailureCount = state.failureCount + 1
					const newTotalRequests = state.totalRequests + 1
					
					// Open circuit if failure threshold exceeded
					if (newFailureCount >= config.circuitBreaker.failureThreshold) {
						return {
							...state,
							state: 'open',
							failureCount: newFailureCount,
							totalRequests: newTotalRequests,
							lastFailureTime: now,
							lastStateChange: now,
							halfOpenCalls: 0
						}
					}
					
					// Transition from half-open to open on any failure
					if (state.state === 'half-open') {
						return {
							...state,
							state: 'open',
							failureCount: newFailureCount,
							totalRequests: newTotalRequests,
							lastFailureTime: now,
							lastStateChange: now,
							halfOpenCalls: 0
						}
					}
					
					return {
						...state,
						failureCount: newFailureCount,
						totalRequests: newTotalRequests,
						lastFailureTime: now
					}
				})
			})
		
		/**
		 * Transition circuit breaker to half-open
		 */
		const transitionToHalfOpen = (breakerName: string): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* updateCircuitBreakerState(breakerName, state => ({
					...state,
					state: 'half-open',
					halfOpenCalls: 0,
					lastStateChange: Date.now()
				}))
			})
		
		/**
		 * Implement retry logic
		 */
		const withRetry = <A, E extends BrowserSessionError>(
			operation: () => Effect.Effect<A, E>,
			operationType: string
		): Effect.Effect<A, E> =>
			Effect.gen(function* () {
				yield* Effect.logDebug(`Starting retry wrapper for operation: ${operationType}`)
				
				const retrySchedule = Schedule.exponential(config.retryPolicy.initialDelay).pipe(
					Schedule.whileInput<E>((error) => isRetryableError(error)),
					Schedule.recurs(config.retryPolicy.maxAttempts - 1),
					Schedule.delayed((delay) => {
						const jitterDelay = config.retryPolicy.jitter
							? delay + (Math.random() * delay * 0.25)
							: delay
						return Duration.millis(Math.min(jitterDelay, config.retryPolicy.maxDelay))
					})
				)
				
				return yield* operation().pipe(
					Effect.retry(retrySchedule),
					Effect.tapError((error) =>
						Effect.logError(`Operation ${operationType} failed after all retry attempts: ${error.message}`)
					)
				)
			})
		
		/**
		 * Implement circuit breaker pattern
		 */
		const withCircuitBreaker = <A, E extends BrowserSessionError>(
			operation: () => Effect.Effect<A, E>,
			breakerName: string
		): Effect.Effect<A, E> =>
			Effect.gen(function* () {
				const state = yield* getCircuitBreakerState(breakerName)
				
				// Check if request should be allowed
				if (!shouldAllowRequest(state)) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Circuit breaker ${breakerName} is open`,
						context: { breakerName, state: state.state }
					}) as E)
				}
				
				// Transition to half-open if needed
				if (state.state === 'open' && shouldAllowRequest(state)) {
					yield* transitionToHalfOpen(breakerName)
				}
				
				const result = yield* operation().pipe(
					Effect.tap(() => onCircuitBreakerSuccess(breakerName)),
					Effect.tapError(() => onCircuitBreakerFailure(breakerName))
				)
				
				return result
			})
		
		/**
		 * Implement timeout wrapper
		 */
		const withTimeout = <A, E extends BrowserSessionError>(
			operation: () => Effect.Effect<A, E>,
			timeoutMs: number = config.timeout.operationTimeout
		): Effect.Effect<A, E> =>
			Effect.gen(function* () {
				return yield* operation().pipe(
					Effect.timeout(Duration.millis(timeoutMs)),
					Effect.mapError((error) => {
						if (error._tag === 'TimeoutException') {
							return new BrowserSessionError({
								message: `Operation timed out after ${timeoutMs}ms`,
								cause: error
							}) as E
						}
						return error
					})
				)
			})
		
		/**
		 * Implement bulkhead pattern
		 */
		const withBulkhead = <A, E extends BrowserSessionError>(
			operation: () => Effect.Effect<A, E>,
			bulkheadName: string
		): Effect.Effect<A, E> =>
			Effect.gen(function* () {
				if (!config.enableBulkheads) {
					return yield* operation()
				}
				
				// Use global semaphore for now (could be per-bulkhead)
				return yield* globalSemaphore.withPermit(operation())
			})
		
		/**
		 * Comprehensive error recovery
		 */
		const recoverFromError = <A>(
			error: BrowserSessionError,
			context: ErrorRecoveryContext,
			recoveryFn: () => Effect.Effect<A, BrowserSessionError>
		): Effect.Effect<RecoveryResult<A>, never> =>
			Effect.gen(function* () {
				const startTime = Date.now()
				const recoveryActions: string[] = []
				
				yield* Effect.logWarn(`Attempting error recovery for ${context.operationType} operation`, {
					operationId: context.operationId,
					attempt: context.attempt,
					error: error.message
				})
				
				// Determine recovery strategy based on error type and context
				if (error instanceof CDPConnectionError) {
					recoveryActions.push('reconnect-cdp')
					yield* Effect.logInfo('Attempting CDP reconnection for recovery')
				}
				
				if (error instanceof CDPCommandError) {
					recoveryActions.push('retry-command')
					yield* Effect.logInfo('Retrying CDP command for recovery')
				}
				
				if (context.operationType === 'navigation' && context.attempt < 2) {
					recoveryActions.push('refresh-page')
					yield* Effect.logInfo('Adding page refresh to recovery strategy')
				}
				
				// Execute recovery function
				const recoveryResult = yield* recoveryFn().pipe(
					Effect.either
				)
				
				const duration = Date.now() - startTime
				
				if (recoveryResult._tag === 'Right') {
					yield* Effect.logInfo(`Error recovery successful for ${context.operationType}`, {
						operationId: context.operationId,
						duration,
						actions: recoveryActions
					})
					
					return {
						success: true,
						result: recoveryResult.right,
						recoveryActions,
						duration
					}
				} else {
					yield* Effect.logError(`Error recovery failed for ${context.operationType}`, {
						operationId: context.operationId,
						duration,
						actions: recoveryActions,
						finalError: recoveryResult.left.message
					})
					
					return {
						success: false,
						error: recoveryResult.left,
						recoveryActions,
						duration
					}
				}
			})
		
		/**
		 * Get circuit breaker metrics
		 */
		const getCircuitBreakerMetrics = (
			breakerName: string
		): Effect.Effect<CircuitBreakerMetrics | null, never> =>
			Effect.gen(function* () {
				const breakers = yield* Ref.get(circuitBreakers)
				const state = breakers.get(breakerName)
				
				if (!state) {
					return null
				}
				
				return {
					state: state.state,
					failureCount: state.failureCount,
					successCount: state.successCount,
					totalRequests: state.totalRequests,
					lastFailureTime: state.lastFailureTime,
					lastStateChange: state.lastStateChange
				}
			})
		
		/**
		 * Reset circuit breaker
		 */
		const resetCircuitBreaker = (breakerName: string): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* updateCircuitBreakerState(breakerName, state => ({
					...state,
					state: 'closed',
					failureCount: 0,
					successCount: 0,
					halfOpenCalls: 0,
					lastStateChange: Date.now()
				}))
				
				yield* Effect.logInfo(`Circuit breaker ${breakerName} has been reset`)
			})
		
		/**
		 * Health check for resilience components
		 */
		const healthCheck = (): Effect.Effect<boolean, never> =>
			Effect.gen(function* () {
				const breakers = yield* Ref.get(circuitBreakers)
				const openBreakers = Array.from(breakers.values()).filter(b => b.state === 'open')
				
				// Consider system unhealthy if too many circuit breakers are open
				const maxOpenBreakers = Math.ceil(breakers.size * 0.5)
				const systemHealthy = openBreakers.length <= maxOpenBreakers
				
				if (!systemHealthy) {
					yield* Effect.logWarn(`System health degraded: ${openBreakers.length}/${breakers.size} circuit breakers are open`)
				}
				
				return systemHealthy
			})
		
		return {
			withRetry,
			withCircuitBreaker,
			withTimeout,
			withBulkhead,
			recoverFromError,
			getCircuitBreakerMetrics,
			resetCircuitBreaker,
			healthCheck
		} satisfies ResilienceServiceInterface
	})

/**
 * Resilience service layer
 */
export const ResilienceServiceLive = (config?: Partial<ResilienceConfig>) =>
	Layer.effect(
		ResilienceService,
		makeResilienceService({ ...defaultResilienceConfig, ...config })
	)

/**
 * Convenience function to apply all resilience patterns
 */
export const withFullResilience = <A, E extends BrowserSessionError>(
	operation: () => Effect.Effect<A, E>,
	operationType: string,
	breakerName: string = operationType,
	timeoutMs?: number
) =>
	Effect.gen(function* () {
		const resilience = yield* ResilienceService
		
		return yield* resilience.withBulkhead(
			() => resilience.withCircuitBreaker(
				() => resilience.withTimeout(
					() => resilience.withRetry(operation, operationType),
					timeoutMs
				),
				breakerName
			),
			`${operationType}-bulkhead`
		)
	})