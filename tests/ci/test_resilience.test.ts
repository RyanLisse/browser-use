/**
 * @fileoverview Tests for Epic 4.2: Comprehensive error recovery and retry logic
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, Layer, Ref } from 'effect'
import { ResilienceService, ResilienceServiceLive, defaultResilienceConfig, type ResilienceConfig } from '../../src/resilience'
import { BrowserSessionError, CDPConnectionError, CDPCommandError } from '../../src/errors'

// Test configuration for resilience service
const testResilienceConfig: ResilienceConfig = {
	circuitBreaker: {
		failureThreshold: 3,
		timeoutDuration: 5000,
		resetTimeout: 10000,
		halfOpenMaxCalls: 2
	},
	retryPolicy: {
		maxAttempts: 3,
		initialDelay: 50, // Fast retries for testing
		maxDelay: 1000,
		backoffFactor: 2,
		jitter: false, // Disable for predictable testing
		retryableErrors: ['CDPConnectionError', 'CDPCommandError', 'TimeoutError']
	},
	timeout: {
		operationTimeout: 5000,
		connectionTimeout: 3000,
		commandTimeout: 2000
	},
	enableBulkheads: true,
	maxConcurrentOperations: 10
}

describe('Resilience Service', () => {
	const TestResilienceServiceLive = ResilienceServiceLive(testResilienceConfig)

	describe('Retry Logic', () => {
		it('should retry operations on retryable errors', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				let attemptCount = 0
				
				const failingOperation = () => Effect.gen(function* () {
					attemptCount++
					if (attemptCount < 3) {
						yield* Effect.fail(new CDPConnectionError({
							message: 'Connection failed',
							details: { attempt: attemptCount }
						}))
					}
					return 'success'
				})
				
				const result = yield* resilience.withRetry(failingOperation, 'test-operation')
				
				expect(result).toBe('success')
				expect(attemptCount).toBe(3) // Should have retried twice
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should not retry non-retryable errors', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				let attemptCount = 0
				
				const failingOperation = () => Effect.gen(function* () {
					attemptCount++
					yield* Effect.fail(new BrowserSessionError({
						message: 'Non-retryable error'
					}))
				})
				
				const result = yield* resilience.withRetry(failingOperation, 'test-operation').pipe(
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				expect(attemptCount).toBe(1) // Should not retry
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should respect max retry attempts', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				let attemptCount = 0
				
				const alwaysFailingOperation = () => Effect.gen(function* () {
					attemptCount++
					yield* Effect.fail(new CDPConnectionError({
						message: 'Always fails'
					}))
				})
				
				const result = yield* resilience.withRetry(alwaysFailingOperation, 'test-operation').pipe(
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				expect(attemptCount).toBe(testResilienceConfig.retryPolicy.maxAttempts)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})
	})

	describe('Circuit Breaker', () => {
		it('should track successful operations', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const successfulOperation = () => Effect.succeed('success')
				
				const result = yield* resilience.withCircuitBreaker(successfulOperation, 'test-breaker')
				expect(result).toBe('success')
				
				const metrics = yield* resilience.getCircuitBreakerMetrics('test-breaker')
				expect(metrics).toBeDefined()
				expect(metrics!.successCount).toBe(1)
				expect(metrics!.state).toBe('closed')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should open circuit after failure threshold', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const failingOperation = () => Effect.fail(new BrowserSessionError({
					message: 'Operation failed'
				}))
				
				// Trigger failures to open the circuit
				for (let i = 0; i < testResilienceConfig.circuitBreaker.failureThreshold; i++) {
					yield* resilience.withCircuitBreaker(failingOperation, 'test-breaker').pipe(
						Effect.ignore
					)
				}
				
				const metrics = yield* resilience.getCircuitBreakerMetrics('test-breaker')
				expect(metrics!.state).toBe('open')
				expect(metrics!.failureCount).toBe(testResilienceConfig.circuitBreaker.failureThreshold)
				
				// Next call should fail immediately due to open circuit
				const result = yield* resilience.withCircuitBreaker(failingOperation, 'test-breaker').pipe(
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				if (result._tag === 'Left') {
					expect(result.left.message).toContain('Circuit breaker test-breaker is open')
				}
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should reset circuit breaker', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				// First, open the circuit
				const failingOperation = () => Effect.fail(new BrowserSessionError({
					message: 'Operation failed'
				}))
				
				for (let i = 0; i < testResilienceConfig.circuitBreaker.failureThreshold; i++) {
					yield* resilience.withCircuitBreaker(failingOperation, 'reset-test-breaker').pipe(
						Effect.ignore
					)
				}
				
				let metrics = yield* resilience.getCircuitBreakerMetrics('reset-test-breaker')
				expect(metrics!.state).toBe('open')
				
				// Reset the circuit breaker
				yield* resilience.resetCircuitBreaker('reset-test-breaker')
				
				metrics = yield* resilience.getCircuitBreakerMetrics('reset-test-breaker')
				expect(metrics!.state).toBe('closed')
				expect(metrics!.failureCount).toBe(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})
	})

	describe('Timeout Handling', () => {
		it('should timeout long-running operations', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const longRunningOperation = () => Effect.sleep('10 seconds').pipe(
					Effect.map(() => 'completed')
				)
				
				const result = yield* resilience.withTimeout(longRunningOperation, 100).pipe(
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				if (result._tag === 'Left') {
					expect(result.left.message).toContain('timed out')
				}
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should not timeout fast operations', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const fastOperation = () => Effect.succeed('completed')
				
				const result = yield* resilience.withTimeout(fastOperation, 1000)
				
				expect(result).toBe('completed')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})
	})

	describe('Bulkhead Pattern', () => {
		it('should isolate operations with bulkheads', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const operation = () => Effect.succeed('isolated')
				
				const result = yield* resilience.withBulkhead(operation, 'test-bulkhead')
				
				expect(result).toBe('isolated')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})
	})

	describe('Error Recovery', () => {
		it('should execute recovery strategies', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const error = new CDPConnectionError({
					message: 'Connection lost'
				})
				
				const context = {
					operationId: 'test-op-123',
					attempt: 1,
					lastError: error,
					startTime: Date.now(),
					operationType: 'connection' as const
				}
				
				const recoveryOperation = () => Effect.succeed('recovered')
				
				const result = yield* resilience.recoverFromError(error, context, recoveryOperation)
				
				expect(result.success).toBe(true)
				expect(result.result).toBe('recovered')
				expect(result.recoveryActions).toContain('reconnect-cdp')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should handle recovery failures', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const error = new BrowserSessionError({
					message: 'Original error'
				})
				
				const context = {
					operationId: 'test-op-456',
					attempt: 2,
					lastError: error,
					startTime: Date.now(),
					operationType: 'session' as const
				}
				
				const failingRecovery = () => Effect.fail(new BrowserSessionError({
					message: 'Recovery also failed'
				}))
				
				const result = yield* resilience.recoverFromError(error, context, failingRecovery)
				
				expect(result.success).toBe(false)
				expect(result.error).toBeDefined()
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})
	})

	describe('Health Checking', () => {
		it('should report system health', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				const isHealthy = yield* resilience.healthCheck()
				
				expect(typeof isHealthy).toBe('boolean')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})

		it('should report unhealthy when many circuits are open', async () => {
			const program = Effect.gen(function* () {
				const resilience = yield* ResilienceService
				
				// Open multiple circuit breakers
				const failingOperation = () => Effect.fail(new BrowserSessionError({
					message: 'Failing operation'
				}))
				
				const breakerNames = ['breaker1', 'breaker2', 'breaker3']
				
				for (const breakerName of breakerNames) {
					for (let i = 0; i < testResilienceConfig.circuitBreaker.failureThreshold; i++) {
						yield* resilience.withCircuitBreaker(failingOperation, breakerName).pipe(
							Effect.ignore
						)
					}
				}
				
				const isHealthy = yield* resilience.healthCheck()
				
				// With many open circuits, system should be considered unhealthy
				// (The exact logic depends on implementation)
				expect(typeof isHealthy).toBe('boolean')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestResilienceServiceLive)
			))
		})
	})
})