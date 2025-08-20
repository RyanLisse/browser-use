/**
 * @fileoverview Tests for Epic 4.3: Metrics, monitoring and observability
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, Layer } from 'effect'
import { ObservabilityService, ObservabilityServiceLive, defaultObservabilityConfig, traced, type ObservabilityConfig } from '../../src/observability'
import { BrowserSessionError } from '../../src/errors'

// Test configuration for observability service
const testObservabilityConfig: ObservabilityConfig = {
	metricsRetentionDays: 1,
	tracingEnabled: true,
	samplingRate: 1.0, // Sample all operations for testing
	batchSize: 10,
	flushInterval: 1000,
	healthCheckInterval: 5000,
	alerting: {
		enabled: true,
		rules: [
			{
				name: 'test_high_error_rate',
				condition: 'error_rate > 0.1',
				threshold: 0.1,
				window: 60000,
				severity: 'high',
				enabled: true
			}
		]
	}
}

describe('Observability Service', () => {
	const TestObservabilityServiceLive = ObservabilityServiceLive(testObservabilityConfig)

	describe('Metrics Collection', () => {
		it('should record counter metrics', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				yield* observability.incrementCounter('test_counter', { category: 'test' })
				yield* observability.incrementCounter('test_counter', { category: 'test' })
				yield* observability.incrementCounter('test_counter', { category: 'other' })
				
				const metrics = yield* observability.getMetrics('test_counter')
				
				expect(metrics).toHaveLength(1)
				expect(metrics[0].name).toBe('test_counter')
				expect(metrics[0].type).toBe('counter')
				expect(metrics[0].values.length).toBeGreaterThan(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should record gauge metrics', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				yield* observability.setGauge('test_gauge', 42.5, { unit: 'bytes' })
				yield* observability.setGauge('test_gauge', 37.2, { unit: 'bytes' })
				
				const metrics = yield* observability.getMetrics('test_gauge')
				
				expect(metrics).toHaveLength(1)
				expect(metrics[0].name).toBe('test_gauge')
				expect(metrics[0].type).toBe('gauge')
				expect(metrics[0].values[metrics[0].values.length - 1].value).toBe(37.2)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should record histogram metrics', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				yield* observability.recordHistogram('response_time', 150)
				yield* observability.recordHistogram('response_time', 200)
				yield* observability.recordHistogram('response_time', 175)
				
				const metrics = yield* observability.getMetrics('response_time')
				
				expect(metrics).toHaveLength(1)
				expect(metrics[0].name).toBe('response_time')
				expect(metrics[0].type).toBe('histogram')
				expect(metrics[0].values).toHaveLength(3)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should record timer metrics', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const operation = () => Effect.gen(function* () {
					yield* Effect.sleep('50 millis')
					return 'completed'
				})
				
				const result = yield* observability.recordTimer(
					'operation_duration',
					operation,
					{ operation: 'test' }
				)
				
				expect(result).toBe('completed')
				
				const metrics = yield* observability.getMetrics('operation_duration')
				
				expect(metrics).toHaveLength(1)
				expect(metrics[0].name).toBe('operation_duration')
				expect(metrics[0].type).toBe('timer')
				expect(metrics[0].values[0].value).toBeGreaterThan(40) // Should be around 50ms
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should record timer metrics for failed operations', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const failingOperation = () => Effect.gen(function* () {
					yield* Effect.sleep('25 millis')
					yield* Effect.fail(new BrowserSessionError({
						message: 'Operation failed'
					}))
				})
				
				const result = yield* observability.recordTimer(
					'failed_operation_duration',
					failingOperation,
					{ operation: 'failing_test' }
				).pipe(Effect.either)
				
				expect(result._tag).toBe('Left')
				
				const metrics = yield* observability.getMetrics('failed_operation_duration')
				
				expect(metrics).toHaveLength(1)
				expect(metrics[0].values[0].value).toBeGreaterThan(20)
				expect(metrics[0].values[0].labels?.status).toBe('error')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('Distributed Tracing', () => {
		it('should create and finish trace spans', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const span = yield* observability.startSpan('test_operation')
				
				expect(span.operationName).toBe('test_operation')
				expect(span.traceId).toBeDefined()
				expect(span.spanId).toBeDefined()
				expect(span.startTime).toBeGreaterThan(0)
				
				yield* observability.finishSpan(span.spanId, 'success')
				
				// Check that timer metric was recorded
				const metrics = yield* observability.getMetrics('span_duration_test_operation')
				expect(metrics).toHaveLength(1)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should add tags and logs to spans', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const span = yield* observability.startSpan('tagged_operation')
				
				yield* observability.addSpanTag(span.spanId, 'user_id', '12345')
				yield* observability.addSpanTag(span.spanId, 'action', 'click')
				
				yield* observability.addSpanLog(span.spanId, 'info', 'Operation started')
				yield* observability.addSpanLog(span.spanId, 'debug', 'Processing data', { count: 42 })
				
				yield* observability.finishSpan(span.spanId, 'success')
				
				// Spans are mostly internal, so we just verify no errors occurred
				expect(span.spanId).toBeDefined()
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should handle parent-child span relationships', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const parentSpan = yield* observability.startSpan('parent_operation')
				const childSpan = yield* observability.startSpan('child_operation', parentSpan.spanId)
				
				expect(childSpan.parentSpanId).toBe(parentSpan.spanId)
				expect(childSpan.traceId).toBe(parentSpan.traceId)
				
				yield* observability.finishSpan(childSpan.spanId, 'success')
				yield* observability.finishSpan(parentSpan.spanId, 'success')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('Performance Metrics', () => {
		it('should provide performance metrics', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				// Generate some test data
				yield* observability.incrementCounter('dom_queries_total')
				yield* observability.incrementCounter('navigation_total')
				yield* observability.recordHistogram('dom_query_duration', 100)
				yield* observability.recordHistogram('navigation_duration', 500)
				
				const perfMetrics = yield* observability.getPerformanceMetrics()
				
				expect(perfMetrics.operations).toBeDefined()
				expect(perfMetrics.operations.domOperations).toBeDefined()
				expect(perfMetrics.operations.navigation).toBeDefined()
				expect(perfMetrics.operations.screenshots).toBeDefined()
				
				expect(perfMetrics.connections).toBeDefined()
				expect(perfMetrics.sessions).toBeDefined()
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('System Health', () => {
		it('should run health checks', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const memoryCheck = yield* observability.runHealthCheck('memory')
				expect(memoryCheck.name).toBe('memory')
				expect(['pass', 'warn', 'fail']).toContain(memoryCheck.status)
				expect(memoryCheck.responseTime).toBeGreaterThan(0)
				
				const connectionCheck = yield* observability.runHealthCheck('connections')
				expect(connectionCheck.name).toBe('connections')
				expect(['pass', 'warn', 'fail']).toContain(connectionCheck.status)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should provide system health summary', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				const health = yield* observability.getSystemHealth()
				
				expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status)
				expect(health.score).toBeGreaterThanOrEqual(0)
				expect(health.score).toBeLessThanOrEqual(100)
				expect(health.checks).toBeInstanceOf(Array)
				expect(health.uptime).toBeGreaterThan(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('Alerting', () => {
		it('should check alert rules', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				// Generate metrics that might trigger alerts
				yield* observability.incrementCounter('dom_query_errors_total')
				yield* observability.incrementCounter('dom_queries_total')
				
				const alerts = yield* observability.checkAlerts()
				
				expect(Array.isArray(alerts)).toBe(true)
				// Specific alerts depend on the data, so we just verify the structure
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should resolve alerts', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				// This would typically be called with a real alert ID
				yield* observability.resolveAlert('test-alert-id')
				
				// No error should occur
				expect(true).toBe(true)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('Metrics Export', () => {
		it('should export metrics in Prometheus format', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				yield* observability.incrementCounter('test_exported_counter')
				yield* observability.setGauge('test_exported_gauge', 42)
				
				const prometheusOutput = yield* observability.exportMetrics('prometheus')
				
				expect(typeof prometheusOutput).toBe('string')
				expect(prometheusOutput).toContain('test_exported_counter')
				expect(prometheusOutput).toContain('test_exported_gauge')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should export metrics in JSON format', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				yield* observability.recordHistogram('test_exported_histogram', 123)
				
				const jsonOutput = yield* observability.exportMetrics('json')
				
				expect(typeof jsonOutput).toBe('string')
				const parsed = JSON.parse(jsonOutput)
				expect(Array.isArray(parsed)).toBe(true)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should export metrics in CSV format', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				yield* observability.recordTimer('test_csv_timer', () => Effect.succeed('done'))
				
				const csvOutput = yield* observability.exportMetrics('csv')
				
				expect(typeof csvOutput).toBe('string')
				expect(csvOutput).toContain('name,type,value,timestamp,labels')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('Traced Operations', () => {
		it('should trace operations with convenience function', async () => {
			const program = Effect.gen(function* () {
				const operation = (span: any) => Effect.gen(function* () {
					yield* Effect.sleep('10 millis')
					return 'traced_result'
				})
				
				const result = yield* traced('convenience_operation', operation).pipe(
					Effect.provide(TestObservabilityServiceLive)
				)
				
				expect(result).toBe('traced_result')
				
				const observability = yield* ObservabilityService
				const metrics = yield* observability.getMetrics('span_duration_convenience_operation')
				expect(metrics).toHaveLength(1)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})

		it('should trace failed operations', async () => {
			const program = Effect.gen(function* () {
				const failingOperation = (span: any) => Effect.gen(function* () {
					yield* Effect.sleep('5 millis')
					yield* Effect.fail(new BrowserSessionError({
						message: 'Traced operation failed'
					}))
				})
				
				const result = yield* traced('failing_traced_operation', failingOperation).pipe(
					Effect.provide(TestObservabilityServiceLive),
					Effect.either
				)
				
				expect(result._tag).toBe('Left')
				
				const observability = yield* ObservabilityService
				const metrics = yield* observability.getMetrics('span_duration_failing_traced_operation')
				expect(metrics).toHaveLength(1)
				expect(metrics[0].values[0].labels?.status).toBe('error')
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})

	describe('Flush and Cleanup', () => {
		it('should flush pending metrics', async () => {
			const program = Effect.gen(function* () {
				const observability = yield* ObservabilityService
				
				// Generate some metrics
				yield* observability.incrementCounter('flush_test_counter')
				yield* observability.setGauge('flush_test_gauge', 99)
				
				// Flush should complete without error
				yield* observability.flush()
				
				expect(true).toBe(true)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestObservabilityServiceLive)
			))
		})
	})
})