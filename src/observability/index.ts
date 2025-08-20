/**
 * @fileoverview Comprehensive metrics, monitoring and observability
 * Epic 4.3: Implement metrics, monitoring and observability
 */

import { Context, Effect, Layer, Ref, Queue, Schedule, Duration } from 'effect'
import { BrowserSessionError } from '../errors'

/**
 * Metric types
 */
type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer'

/**
 * Metric value
 */
export interface MetricValue {
	readonly value: number
	readonly timestamp: number
	readonly labels?: Record<string, string>
}

/**
 * Metric definition
 */
export interface Metric {
	readonly name: string
	readonly type: MetricType
	readonly description: string
	readonly unit?: string
	readonly values: readonly MetricValue[]
	readonly labels: Record<string, string>
}

/**
 * Trace span
 */
export interface TraceSpan {
	readonly traceId: string
	readonly spanId: string
	readonly parentSpanId?: string
	readonly operationName: string
	readonly startTime: number
	readonly endTime?: number
	readonly duration?: number
	readonly tags: Record<string, unknown>
	readonly logs: readonly TraceLog[]
	readonly status: 'success' | 'error' | 'timeout'
}

/**
 * Trace log entry
 */
export interface TraceLog {
	readonly timestamp: number
	readonly level: 'debug' | 'info' | 'warn' | 'error'
	readonly message: string
	readonly fields?: Record<string, unknown>
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
	readonly operations: {
		readonly domOperations: {
			readonly totalQueries: number
			readonly averageQueryTime: number
			readonly failureRate: number
		}
		readonly navigation: {
			readonly totalNavigations: number
			readonly averageLoadTime: number
			readonly timeouts: number
		}
		readonly screenshots: {
			readonly totalCaptures: number
			readonly averageCaptureTime: number
			readonly failureRate: number
		}
	}
	readonly connections: {
		readonly totalConnections: number
		readonly activeConnections: number
		readonly connectionErrors: number
		readonly averageConnectionTime: number
	}
	readonly sessions: {
		readonly activeSessions: number
		readonly totalCreated: number
		readonly averageLifetime: number
		readonly errorRate: number
	}
}

/**
 * System health status
 */
export interface SystemHealth {
	readonly status: 'healthy' | 'degraded' | 'unhealthy'
	readonly score: number // 0-100
	readonly checks: readonly HealthCheck[]
	readonly timestamp: number
	readonly uptime: number
}

/**
 * Health check result
 */
export interface HealthCheck {
	readonly name: string
	readonly status: 'pass' | 'fail' | 'warn'
	readonly message: string
	readonly responseTime: number
	readonly metadata?: Record<string, unknown>
}

/**
 * Alert configuration
 */
export interface AlertConfig {
	readonly name: string
	readonly condition: string // e.g., 'error_rate > 0.05'
	readonly threshold: number
	readonly window: number // time window in milliseconds
	readonly severity: 'low' | 'medium' | 'high' | 'critical'
	readonly enabled: boolean
}

/**
 * Alert event
 */
export interface AlertEvent {
	readonly id: string
	readonly config: AlertConfig
	readonly triggered: number
	readonly resolved?: number
	readonly value: number
	readonly message: string
	readonly metadata: Record<string, unknown>
}

/**
 * Observability configuration
 */
export interface ObservabilityConfig {
	readonly metricsRetentionDays: number
	readonly tracingEnabled: boolean
	readonly samplingRate: number // 0.0 to 1.0
	readonly batchSize: number
	readonly flushInterval: number // milliseconds
	readonly healthCheckInterval: number // milliseconds
	readonly alerting: {
		readonly enabled: boolean
		readonly rules: readonly AlertConfig[]
	}
}

/**
 * Observability service interface
 */
export interface ObservabilityServiceInterface {
	// Metrics
	readonly recordMetric: (
		name: string,
		value: number,
		type: MetricType,
		labels?: Record<string, string>
	) => Effect.Effect<void, never>
	
	readonly incrementCounter: (
		name: string,
		labels?: Record<string, string>
	) => Effect.Effect<void, never>
	
	readonly setGauge: (
		name: string,
		value: number,
		labels?: Record<string, string>
	) => Effect.Effect<void, never>
	
	readonly recordHistogram: (
		name: string,
		value: number,
		labels?: Record<string, string>
	) => Effect.Effect<void, never>
	
	readonly recordTimer: <A>(
		name: string,
		operation: () => Effect.Effect<A, BrowserSessionError>,
		labels?: Record<string, string>
	) => Effect.Effect<A, BrowserSessionError>
	
	// Tracing
	readonly startSpan: (
		operationName: string,
		parentSpanId?: string
	) => Effect.Effect<TraceSpan, never>
	
	readonly finishSpan: (
		spanId: string,
		status?: 'success' | 'error' | 'timeout'
	) => Effect.Effect<void, never>
	
	readonly addSpanTag: (
		spanId: string,
		key: string,
		value: unknown
	) => Effect.Effect<void, never>
	
	readonly addSpanLog: (
		spanId: string,
		level: 'debug' | 'info' | 'warn' | 'error',
		message: string,
		fields?: Record<string, unknown>
	) => Effect.Effect<void, never>
	
	// Monitoring
	readonly getMetrics: (
		namePattern?: string
	) => Effect.Effect<readonly Metric[], never>
	
	readonly getPerformanceMetrics: () => Effect.Effect<PerformanceMetrics, never>
	
	readonly getSystemHealth: () => Effect.Effect<SystemHealth, never>
	
	readonly runHealthCheck: (
		checkName: string
	) => Effect.Effect<HealthCheck, never>
	
	// Alerting
	readonly checkAlerts: () => Effect.Effect<readonly AlertEvent[], never>
	
	readonly resolveAlert: (
		alertId: string
	) => Effect.Effect<void, never>
	
	// Export/Integration
	readonly exportMetrics: (
		format: 'prometheus' | 'json' | 'csv'
	) => Effect.Effect<string, BrowserSessionError>
	
	readonly flush: () => Effect.Effect<void, never>
}

/**
 * Observability service context tag
 */
export const ObservabilityService = Context.GenericTag<ObservabilityServiceInterface>('ObservabilityService')

/**
 * Default observability configuration
 */
export const defaultObservabilityConfig: ObservabilityConfig = {
	metricsRetentionDays: 30,
	tracingEnabled: true,
	samplingRate: 0.1,
	batchSize: 100,
	flushInterval: 10000,
	healthCheckInterval: 30000,
	alerting: {
		enabled: true,
		rules: [
			{
				name: 'high_error_rate',
				condition: 'error_rate > 0.05',
				threshold: 0.05,
				window: 300000, // 5 minutes
				severity: 'high',
				enabled: true
			},
			{
				name: 'connection_pool_exhausted',
				condition: 'connection_pool_usage > 0.9',
				threshold: 0.9,
				window: 60000, // 1 minute
				severity: 'critical',
				enabled: true
			}
		]
	}
}

/**
 * Create observability service implementation
 */
const makeObservabilityService = (config: ObservabilityConfig = defaultObservabilityConfig) =>
	Effect.gen(function* () {
		// State management
		const metrics = yield* Ref.make(new Map<string, Metric>())
		const traces = yield* Ref.make(new Map<string, TraceSpan>())
		const activeSpans = yield* Ref.make(new Map<string, TraceSpan>())
		const alerts = yield* Ref.make(new Map<string, AlertEvent>())
		const healthChecks = yield* Ref.make(new Map<string, HealthCheck>())
		
		// Buffer for batch processing
		const metricsQueue = yield* Queue.bounded<MetricValue & { name: string; type: MetricType; labels?: Record<string, string> }>(config.batchSize)
		
		// System start time for uptime calculation
		const systemStartTime = Date.now()
		
		/**
		 * Generate unique IDs
		 */
		const generateTraceId = (): string => crypto.randomUUID()
		const generateSpanId = (): string => crypto.randomUUID().slice(0, 16)
		
		/**
		 * Check if operation should be sampled
		 */
		const shouldSample = (): boolean => Math.random() < config.samplingRate
		
		/**
		 * Record a metric
		 */
		const recordMetric = (
			name: string,
			value: number,
			type: MetricType,
			labels: Record<string, string> = {}
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				const timestamp = Date.now()
				const metricValue: MetricValue = {
					value,
					timestamp,
					labels
				}
				
				// Add to queue for batch processing
				yield* Queue.offer(metricsQueue, { name, type, labels, ...metricValue }).pipe(
					Effect.ignore // Don't fail if queue is full
				)
				
				// Update metric in store
				yield* Ref.update(metrics, metricsMap => {
					const existing = metricsMap.get(name)
					const updatedMetric: Metric = {
						name,
						type,
						description: existing?.description || `${type} metric for ${name}`,
						unit: existing?.unit,
						values: existing ? [...existing.values.slice(-99), metricValue] : [metricValue], // Keep last 100 values
						labels: { ...existing?.labels, ...labels }
					}
					
					return new Map(metricsMap).set(name, updatedMetric)
				})
			})
		
		/**
		 * Increment counter
		 */
		const incrementCounter = (
			name: string,
			labels?: Record<string, string>
		): Effect.Effect<void, never> =>
			recordMetric(name, 1, 'counter', labels)
		
		/**
		 * Set gauge value
		 */
		const setGauge = (
			name: string,
			value: number,
			labels?: Record<string, string>
		): Effect.Effect<void, never> =>
			recordMetric(name, value, 'gauge', labels)
		
		/**
		 * Record histogram value
		 */
		const recordHistogram = (
			name: string,
			value: number,
			labels?: Record<string, string>
		): Effect.Effect<void, never> =>
			recordMetric(name, value, 'histogram', labels)
		
		/**
		 * Record timer operation
		 */
		const recordTimer = <A>(
			name: string,
			operation: () => Effect.Effect<A, BrowserSessionError>,
			labels?: Record<string, string>
		): Effect.Effect<A, BrowserSessionError> =>
			Effect.gen(function* () {
				const startTime = Date.now()
				
				const result = yield* operation().pipe(
					Effect.tap(() => {
						const duration = Date.now() - startTime
						return recordMetric(name, duration, 'timer', { ...labels, status: 'success' })
					}),
					Effect.tapError((error) => {
						const duration = Date.now() - startTime
						return recordMetric(name, duration, 'timer', { 
							...labels, 
							status: 'error', 
							error_type: error.constructor.name 
						})
					})
				)
				
				return result
			})
		
		/**
		 * Start trace span
		 */
		const startSpan = (
			operationName: string,
			parentSpanId?: string
		): Effect.Effect<TraceSpan, never> =>
			Effect.gen(function* () {
				if (!config.tracingEnabled || !shouldSample()) {
					// Create minimal span for API compatibility
					const span: TraceSpan = {
						traceId: 'disabled',
						spanId: 'disabled',
						parentSpanId,
						operationName,
						startTime: Date.now(),
						tags: {},
						logs: [],
						status: 'success'
					}
					return span
				}
				
				const traceId = parentSpanId ? 
					(yield* Ref.get(activeSpans)).get(parentSpanId)?.traceId || generateTraceId() :
					generateTraceId()
				
				const spanId = generateSpanId()
				const startTime = Date.now()
				
				const span: TraceSpan = {
					traceId,
					spanId,
					parentSpanId,
					operationName,
					startTime,
					tags: {},
					logs: [],
					status: 'success'
				}
				
				yield* Ref.update(activeSpans, spans =>
					new Map(spans).set(spanId, span)
				)
				
				return span
			})
		
		/**
		 * Finish trace span
		 */
		const finishSpan = (
			spanId: string,
			status: 'success' | 'error' | 'timeout' = 'success'
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				if (spanId === 'disabled') return
				
				const activeSpansMap = yield* Ref.get(activeSpans)
				const span = activeSpansMap.get(spanId)
				
				if (!span) return
				
				const endTime = Date.now()
				const finishedSpan: TraceSpan = {
					...span,
					endTime,
					duration: endTime - span.startTime,
					status
				}
				
				// Move to completed traces
				yield* Ref.update(traces, tracesMap =>
					new Map(tracesMap).set(spanId, finishedSpan)
				)
				
				// Remove from active spans
				yield* Ref.update(activeSpans, spans => {
					const newSpans = new Map(spans)
					newSpans.delete(spanId)
					return newSpans
				})
				
				// Record timing metric
				yield* recordMetric(
					`span_duration_${span.operationName}`,
					finishedSpan.duration!,
					'timer',
					{ status, operation: span.operationName }
				)
			})
		
		/**
		 * Add span tag
		 */
		const addSpanTag = (
			spanId: string,
			key: string,
			value: unknown
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				if (spanId === 'disabled') return
				
				yield* Ref.update(activeSpans, spans => {
					const span = spans.get(spanId)
					if (!span) return spans
					
					const updatedSpan = {
						...span,
						tags: { ...span.tags, [key]: value }
					}
					
					return new Map(spans).set(spanId, updatedSpan)
				})
			})
		
		/**
		 * Add span log
		 */
		const addSpanLog = (
			spanId: string,
			level: 'debug' | 'info' | 'warn' | 'error',
			message: string,
			fields?: Record<string, unknown>
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				if (spanId === 'disabled') return
				
				const logEntry: TraceLog = {
					timestamp: Date.now(),
					level,
					message,
					fields
				}
				
				yield* Ref.update(activeSpans, spans => {
					const span = spans.get(spanId)
					if (!span) return spans
					
					const updatedSpan = {
						...span,
						logs: [...span.logs, logEntry]
					}
					
					return new Map(spans).set(spanId, updatedSpan)
				})
			})
		
		/**
		 * Get metrics
		 */
		const getMetrics = (
			namePattern?: string
		): Effect.Effect<readonly Metric[], never> =>
			Effect.gen(function* () {
				const metricsMap = yield* Ref.get(metrics)
				const allMetrics = Array.from(metricsMap.values())
				
				if (!namePattern) {
					return allMetrics
				}
				
				const regex = new RegExp(namePattern)
				return allMetrics.filter(metric => regex.test(metric.name))
			})
		
		/**
		 * Get performance metrics
		 */
		const getPerformanceMetrics = (): Effect.Effect<PerformanceMetrics, never> =>
			Effect.gen(function* () {
				const metricsMap = yield* Ref.get(metrics)
				
				// Helper to get metric value
				const getMetricValue = (name: string, defaultValue = 0): number => {
					const metric = metricsMap.get(name)
					return metric?.values[metric.values.length - 1]?.value || defaultValue
				}
				
				const getMetricAverage = (name: string, defaultValue = 0): number => {
					const metric = metricsMap.get(name)
					if (!metric?.values.length) return defaultValue
					
					const sum = metric.values.reduce((acc, val) => acc + val.value, 0)
					return sum / metric.values.length
				}
				
				return {
					operations: {
						domOperations: {
							totalQueries: getMetricValue('dom_queries_total'),
							averageQueryTime: getMetricAverage('dom_query_duration'),
							failureRate: getMetricValue('dom_query_errors_total') / Math.max(1, getMetricValue('dom_queries_total'))
						},
						navigation: {
							totalNavigations: getMetricValue('navigation_total'),
							averageLoadTime: getMetricAverage('navigation_duration'),
							timeouts: getMetricValue('navigation_timeouts_total')
						},
						screenshots: {
							totalCaptures: getMetricValue('screenshots_total'),
							averageCaptureTime: getMetricAverage('screenshot_duration'),
							failureRate: getMetricValue('screenshot_errors_total') / Math.max(1, getMetricValue('screenshots_total'))
						}
					},
					connections: {
						totalConnections: getMetricValue('connections_total'),
						activeConnections: getMetricValue('connections_active'),
						connectionErrors: getMetricValue('connection_errors_total'),
						averageConnectionTime: getMetricAverage('connection_duration')
					},
					sessions: {
						activeSessions: getMetricValue('sessions_active'),
						totalCreated: getMetricValue('sessions_total'),
						averageLifetime: getMetricAverage('session_lifetime'),
						errorRate: getMetricValue('session_errors_total') / Math.max(1, getMetricValue('sessions_total'))
					}
				}
			})
		
		/**
		 * Run health check
		 */
		const runHealthCheck = (
			checkName: string
		): Effect.Effect<HealthCheck, never> =>
			Effect.gen(function* () {
				const startTime = Date.now()
				
				let result: HealthCheck
				
				switch (checkName) {
					case 'memory':
						const memInfo = process.memoryUsage()
						const memUsagePercent = (memInfo.heapUsed / memInfo.heapTotal) * 100
						result = {
							name: 'memory',
							status: memUsagePercent > 90 ? 'fail' : memUsagePercent > 70 ? 'warn' : 'pass',
							message: `Memory usage: ${memUsagePercent.toFixed(1)}%`,
							responseTime: Date.now() - startTime,
							metadata: { ...memInfo, percentage: memUsagePercent }
						}
						break
						
					case 'connections':
						const perfMetrics = yield* getPerformanceMetrics()
						const errorRate = perfMetrics.connections.connectionErrors / Math.max(1, perfMetrics.connections.totalConnections)
						result = {
							name: 'connections',
							status: errorRate > 0.1 ? 'fail' : errorRate > 0.05 ? 'warn' : 'pass',
							message: `Connection error rate: ${(errorRate * 100).toFixed(1)}%`,
							responseTime: Date.now() - startTime,
							metadata: { errorRate, ...perfMetrics.connections }
						}
						break
						
					default:
						result = {
							name: checkName,
							status: 'warn',
							message: `Unknown health check: ${checkName}`,
							responseTime: Date.now() - startTime
						}
				}
				
				// Cache result
				yield* Ref.update(healthChecks, checks =>
					new Map(checks).set(checkName, result)
				)
				
				return result
			})
		
		/**
		 * Get system health
		 */
		const getSystemHealth = (): Effect.Effect<SystemHealth, never> =>
			Effect.gen(function* () {
				const checks = yield* Effect.all([
					runHealthCheck('memory'),
					runHealthCheck('connections')
				])
				
				const passCount = checks.filter(c => c.status === 'pass').length
				const warnCount = checks.filter(c => c.status === 'warn').length
				const failCount = checks.filter(c => c.status === 'fail').length
				
				// Calculate health score
				const totalChecks = checks.length
				const score = Math.round(((passCount + (warnCount * 0.5)) / totalChecks) * 100)
				
				let status: 'healthy' | 'degraded' | 'unhealthy'
				if (score >= 80) status = 'healthy'
				else if (score >= 50) status = 'degraded'
				else status = 'unhealthy'
				
				return {
					status,
					score,
					checks,
					timestamp: Date.now(),
					uptime: Date.now() - systemStartTime
				}
			})
		
		/**
		 * Check alerts
		 */
		const checkAlerts = (): Effect.Effect<readonly AlertEvent[], never> =>
			Effect.gen(function* () {
				if (!config.alerting.enabled) {
					return []
				}
				
				const perfMetrics = yield* getPerformanceMetrics()
				const activeAlerts: AlertEvent[] = []
				
				for (const rule of config.alerting.rules) {
					if (!rule.enabled) continue
					
					let currentValue = 0
					let triggered = false
					
					// Simple rule evaluation (in production, use a proper rules engine)
					switch (rule.name) {
						case 'high_error_rate':
							currentValue = Math.max(
								perfMetrics.operations.domOperations.failureRate,
								perfMetrics.operations.navigation.failureRate || 0,
								perfMetrics.operations.screenshots.failureRate
							)
							triggered = currentValue > rule.threshold
							break
							
						case 'connection_pool_exhausted':
							const poolUsage = perfMetrics.connections.activeConnections / Math.max(1, perfMetrics.connections.totalConnections)
							currentValue = poolUsage
							triggered = currentValue > rule.threshold
							break
					}
					
					if (triggered) {
						const alertId = `${rule.name}_${Date.now()}`
						const alert: AlertEvent = {
							id: alertId,
							config: rule,
							triggered: Date.now(),
							value: currentValue,
							message: `Alert triggered: ${rule.name} (${currentValue} > ${rule.threshold})`,
							metadata: { perfMetrics }
						}
						
						activeAlerts.push(alert)
						
						// Store alert
						yield* Ref.update(alerts, alertsMap =>
							new Map(alertsMap).set(alertId, alert)
						)
					}
				}
				
				return activeAlerts
			})
		
		/**
		 * Resolve alert
		 */
		const resolveAlert = (
			alertId: string
		): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* Ref.update(alerts, alertsMap => {
					const alert = alertsMap.get(alertId)
					if (!alert) return alertsMap
					
					const resolvedAlert = {
						...alert,
						resolved: Date.now()
					}
					
					return new Map(alertsMap).set(alertId, resolvedAlert)
				})
			})
		
		/**
		 * Export metrics
		 */
		const exportMetrics = (
			format: 'prometheus' | 'json' | 'csv'
		): Effect.Effect<string, BrowserSessionError> =>
			Effect.gen(function* () {
				const metricsArray = yield* getMetrics()
				
				switch (format) {
					case 'prometheus':
						let promOutput = ''
						for (const metric of metricsArray) {
							promOutput += `# HELP ${metric.name} ${metric.description}\n`
							promOutput += `# TYPE ${metric.name} ${metric.type}\n`
							
							for (const value of metric.values) {
								const labels = value.labels ? 
									'{' + Object.entries(value.labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}' :
									''
								promOutput += `${metric.name}${labels} ${value.value} ${value.timestamp}\n`
							}
						}
						return promOutput
						
					case 'json':
						return JSON.stringify(metricsArray, null, 2)
						
					case 'csv':
						let csvOutput = 'name,type,value,timestamp,labels\n'
						for (const metric of metricsArray) {
							for (const value of metric.values) {
								const labels = value.labels ? JSON.stringify(value.labels) : ''
								csvOutput += `${metric.name},${metric.type},${value.value},${value.timestamp},"${labels}"\n`
							}
						}
						return csvOutput
						
					default:
						yield* Effect.fail(new BrowserSessionError({
							message: `Unsupported export format: ${format}`
						}))
				}
			})
		
		/**
		 * Flush all pending metrics
		 */
		const flush = (): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				// Process all queued metrics
				let processed = 0
				while (yield* Queue.size(metricsQueue) > 0) {
					const batch = yield* Queue.takeAll(metricsQueue)
					processed += batch.length
				}
				
				yield* Effect.logDebug(`Flushed ${processed} metrics`)
			})
		
		// Start background tasks
		yield* Effect.fork(
			Effect.repeat(
				checkAlerts().pipe(Effect.ignore),
				Schedule.fixed(config.healthCheckInterval)
			)
		)
		
		yield* Effect.fork(
			Effect.repeat(
				flush(),
				Schedule.fixed(config.flushInterval)
			)
		)
		
		return {
			recordMetric,
			incrementCounter,
			setGauge,
			recordHistogram,
			recordTimer,
			startSpan,
			finishSpan,
			addSpanTag,
			addSpanLog,
			getMetrics,
			getPerformanceMetrics,
			getSystemHealth,
			runHealthCheck,
			checkAlerts,
			resolveAlert,
			exportMetrics,
			flush
		} satisfies ObservabilityServiceInterface
	})

/**
 * Observability service layer
 */
export const ObservabilityServiceLive = (config?: Partial<ObservabilityConfig>) =>
	Layer.effect(
		ObservabilityService,
		makeObservabilityService({ ...defaultObservabilityConfig, ...config })
	)

/**
 * Convenience function to trace an operation
 */
export const traced = <A, E extends BrowserSessionError>(
	operationName: string,
	operation: (span: TraceSpan) => Effect.Effect<A, E>
) =>
	Effect.gen(function* () {
		const observability = yield* ObservabilityService
		const span = yield* observability.startSpan(operationName)
		
		const result = yield* operation(span).pipe(
			Effect.tap(() => observability.finishSpan(span.spanId, 'success')),
			Effect.tapError((error) => 
				Effect.gen(function* () {
					yield* observability.addSpanTag(span.spanId, 'error', true)
					yield* observability.addSpanTag(span.spanId, 'error.message', error.message)
					yield* observability.finishSpan(span.spanId, 'error')
				})
			)
		)
		
		return result
	})