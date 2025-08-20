/**
 * @fileoverview Connection pooling and resource management service
 * Epic 4.1: Implement connection pooling and resource management
 */

import { Context, Effect, Layer, Queue, Ref, Schedule } from 'effect'
import { CDPClient } from '../cdp'
import { BrowserSessionError } from '../errors'
import type { BrowserConfig } from '../config'

/**
 * Pool connection state
 */
interface PoolConnection {
	readonly id: string
	readonly cdpClient: CDPClient
	readonly created: number
	readonly lastUsed: number
	readonly inUse: boolean
	readonly healthy: boolean
	readonly sessionCount: number
}

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
	readonly minConnections: number
	readonly maxConnections: number
	readonly maxIdleTime: number // milliseconds
	readonly healthCheckInterval: number // milliseconds
	readonly connectionTimeout: number // milliseconds
	readonly retryAttempts: number
	readonly maxSessionsPerConnection: number
}

/**
 * Pool statistics
 */
export interface PoolStats {
	readonly totalConnections: number
	readonly activeConnections: number
	readonly idleConnections: number
	readonly unhealthyConnections: number
	readonly totalSessions: number
	readonly queuedRequests: number
	readonly totalAcquired: number
	readonly totalReleased: number
	readonly averageWaitTime: number
}

/**
 * Resource management metrics
 */
export interface ResourceMetrics {
	readonly memoryUsage: {
		readonly used: number
		readonly total: number
		readonly percentage: number
	}
	readonly connectionMetrics: {
		readonly openConnections: number
		readonly failedConnections: number
		readonly connectionLatency: number
	}
	readonly sessionMetrics: {
		readonly activeSessions: number
		readonly totalCreated: number
		readonly averageLifetime: number
	}
}

/**
 * Connection pool service interface
 */
export interface ConnectionPoolServiceInterface {
	readonly acquireConnection: () => Effect.Effect<PoolConnection, BrowserSessionError>
	
	readonly releaseConnection: (
		connectionId: string
	) => Effect.Effect<void, BrowserSessionError>
	
	readonly getStats: () => Effect.Effect<PoolStats, never>
	
	readonly getMetrics: () => Effect.Effect<ResourceMetrics, never>
	
	readonly healthCheck: () => Effect.Effect<void, never>
	
	readonly cleanup: () => Effect.Effect<void, never>
	
	readonly resize: (
		minConnections: number,
		maxConnections: number
	) => Effect.Effect<void, BrowserSessionError>
}

/**
 * Connection pool service context tag
 */
export const ConnectionPoolService = Context.GenericTag<ConnectionPoolServiceInterface>('ConnectionPoolService')

/**
 * Default connection pool configuration
 */
export const defaultPoolConfig: ConnectionPoolConfig = {
	minConnections: 2,
	maxConnections: 10,
	maxIdleTime: 300000, // 5 minutes
	healthCheckInterval: 60000, // 1 minute
	connectionTimeout: 10000, // 10 seconds
	retryAttempts: 3,
	maxSessionsPerConnection: 50
}

/**
 * Create connection pool service implementation
 */
const makeConnectionPoolService = (config: ConnectionPoolConfig = defaultPoolConfig) =>
	Effect.gen(function* () {
		// Pool state
		const connections = yield* Ref.make(new Map<string, PoolConnection>())
		const queue = yield* Queue.unbounded<{
			id: string
			resolve: (connection: PoolConnection) => void
			reject: (error: BrowserSessionError) => void
			timestamp: number
		}>()
		
		// Statistics tracking
		const stats = yield* Ref.make({
			totalAcquired: 0,
			totalReleased: 0,
			totalWaitTime: 0,
			requestCount: 0
		})
		
		/**
		 * Create a new pool connection
		 */
		const createConnection = (): Effect.Effect<PoolConnection, BrowserSessionError> =>
			Effect.gen(function* () {
				const connectionId = crypto.randomUUID()
				const startTime = Date.now()
				
				yield* Effect.logDebug(`Creating new pool connection: ${connectionId}`)
				
				// Create CDP client with timeout
				const cdpClient = yield* Effect.timeout(
					CDPClient.create(),
					config.connectionTimeout
				).pipe(
					Effect.mapError(() =>
						new BrowserSessionError({
							message: 'Connection creation timeout',
							context: { connectionId }
						})
					)
				)
				
				// Test connection health
				const isConnected = yield* cdpClient.isConnected()
				if (!isConnected) {
					yield* cdpClient.connect()
				}
				
				const connection: PoolConnection = {
					id: connectionId,
					cdpClient,
					created: startTime,
					lastUsed: startTime,
					inUse: false,
					healthy: true,
					sessionCount: 0
				}
				
				yield* Effect.logInfo(`Created pool connection ${connectionId} in ${Date.now() - startTime}ms`)
				
				return connection
			})
		
		/**
		 * Check if connection is healthy
		 */
		const isConnectionHealthy = (connection: PoolConnection): Effect.Effect<boolean, never> =>
			Effect.gen(function* () {
				try {
					// Simple health check - ping the connection
					const isConnected = yield* connection.cdpClient.isConnected()
					const isWithinIdleTime = Date.now() - connection.lastUsed < config.maxIdleTime
					const isUnderSessionLimit = connection.sessionCount < config.maxSessionsPerConnection
					
					return isConnected && isWithinIdleTime && isUnderSessionLimit
				} catch {
					return false
				}
			})
		
		/**
		 * Remove unhealthy connections
		 */
		const removeConnection = (connectionId: string): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				const connectionMap = yield* Ref.get(connections)
				const connection = connectionMap.get(connectionId)
				
				if (connection) {
					yield* Effect.logDebug(`Removing connection: ${connectionId}`)
					
					// Close CDP client
					yield* Effect.attempt(() => connection.cdpClient.disconnect()).pipe(
						Effect.ignore
					)
					
					// Update connections map
					yield* Ref.update(connections, map => {
						const newMap = new Map(map)
						newMap.delete(connectionId)
						return newMap
					})
					
					yield* Effect.logInfo(`Removed connection: ${connectionId}`)
				}
			})
		
		/**
		 * Ensure minimum connections are available
		 */
		const ensureMinConnections = (): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				const connectionMap = yield* Ref.get(connections)
				const currentCount = connectionMap.size
				
				if (currentCount < config.minConnections) {
					const needed = config.minConnections - currentCount
					yield* Effect.logDebug(`Creating ${needed} connections to meet minimum`)
					
					yield* Effect.forEach(
						Array.from({ length: needed }),
						() => Effect.gen(function* () {
							const connection = yield* createConnection().pipe(
								Effect.catchAll((error) =>
									Effect.gen(function* () {
										yield* Effect.logError(`Failed to create minimum connection: ${error.message}`)
										return null
									})
								)
							)
							
							if (connection) {
								yield* Ref.update(connections, map => 
									new Map(map).set(connection.id, connection)
								)
							}
						}),
						{ concurrency: 'inherit' }
					)
				}
			})
		
		/**
		 * Acquire a connection from the pool
		 */
		const acquireConnection = (): Effect.Effect<PoolConnection, BrowserSessionError> =>
			Effect.gen(function* () {
				const startTime = Date.now()
				const requestId = crypto.randomUUID()
				
				yield* Effect.logDebug(`Acquiring connection: ${requestId}`)
				
				// Try to find available connection
				const connectionMap = yield* Ref.get(connections)
				const availableConnection = Array.from(connectionMap.values()).find(
					conn => !conn.inUse && conn.healthy
				)
				
				if (availableConnection) {
					// Mark as in use
					const updatedConnection = {
						...availableConnection,
						inUse: true,
						lastUsed: Date.now()
					}
					
					yield* Ref.update(connections, map =>
						new Map(map).set(availableConnection.id, updatedConnection)
					)
					
					// Update stats
					yield* Ref.update(stats, s => ({
						...s,
						totalAcquired: s.totalAcquired + 1,
						totalWaitTime: s.totalWaitTime + (Date.now() - startTime),
						requestCount: s.requestCount + 1
					}))
					
					yield* Effect.logDebug(`Acquired existing connection: ${availableConnection.id}`)
					return updatedConnection
				}
				
				// Create new connection if under limit
				if (connectionMap.size < config.maxConnections) {
					const newConnection = yield* createConnection()
					const inUseConnection = {
						...newConnection,
						inUse: true
					}
					
					yield* Ref.update(connections, map =>
						new Map(map).set(newConnection.id, inUseConnection)
					)
					
					// Update stats
					yield* Ref.update(stats, s => ({
						...s,
						totalAcquired: s.totalAcquired + 1,
						totalWaitTime: s.totalWaitTime + (Date.now() - startTime),
						requestCount: s.requestCount + 1
					}))
					
					yield* Effect.logDebug(`Created and acquired new connection: ${newConnection.id}`)
					return inUseConnection
				}
				
				// Wait in queue for available connection
				yield* Effect.logDebug(`Pool full, queuing request: ${requestId}`)
				
				const result = yield* Effect.async<PoolConnection, BrowserSessionError>((resume) => {
					Queue.offer(queue, {
						id: requestId,
						resolve: (connection) => resume(Effect.succeed(connection)),
						reject: (error) => resume(Effect.fail(error)),
						timestamp: Date.now()
					})
				})
				
				// Update stats
				yield* Ref.update(stats, s => ({
					...s,
					totalAcquired: s.totalAcquired + 1,
					totalWaitTime: s.totalWaitTime + (Date.now() - startTime),
					requestCount: s.requestCount + 1
				}))
				
				return result
			}).pipe(
				Effect.retry(Schedule.exponential(100).pipe(
					Schedule.whileInput(() => true),
					Schedule.recurs(config.retryAttempts)
				))
			)
		
		/**
		 * Release a connection back to the pool
		 */
		const releaseConnection = (connectionId: string): Effect.Effect<void, BrowserSessionError> =>
			Effect.gen(function* () {
				yield* Effect.logDebug(`Releasing connection: ${connectionId}`)
				
				const connectionMap = yield* Ref.get(connections)
				const connection = connectionMap.get(connectionId)
				
				if (!connection) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Connection not found: ${connectionId}`
					}))
				}
				
				// Check if connection is still healthy
				const healthy = yield* isConnectionHealthy(connection)
				
				if (!healthy) {
					yield* removeConnection(connectionId)
					yield* ensureMinConnections()
					return
				}
				
				// Mark as available
				const releasedConnection = {
					...connection,
					inUse: false,
					lastUsed: Date.now()
				}
				
				yield* Ref.update(connections, map =>
					new Map(map).set(connectionId, releasedConnection)
				)
				
				// Process queue if there are waiting requests
				const queueSize = yield* Queue.size(queue)
				if (queueSize > 0) {
					const request = yield* Queue.take(queue)
					const inUseConnection = {
						...releasedConnection,
						inUse: true
					}
					
					yield* Ref.update(connections, map =>
						new Map(map).set(connectionId, inUseConnection)
					)
					
					request.resolve(inUseConnection)
				}
				
				// Update stats
				yield* Ref.update(stats, s => ({
					...s,
					totalReleased: s.totalReleased + 1
				}))
				
				yield* Effect.logDebug(`Released connection: ${connectionId}`)
			})
		
		/**
		 * Get pool statistics
		 */
		const getStats = (): Effect.Effect<PoolStats, never> =>
			Effect.gen(function* () {
				const connectionMap = yield* Ref.get(connections)
				const currentStats = yield* Ref.get(stats)
				const queueSize = yield* Queue.size(queue)
				
				const connections_array = Array.from(connectionMap.values())
				const activeConnections = connections_array.filter(c => c.inUse).length
				const idleConnections = connections_array.filter(c => !c.inUse && c.healthy).length
				const unhealthyConnections = connections_array.filter(c => !c.healthy).length
				const totalSessions = connections_array.reduce((sum, c) => sum + c.sessionCount, 0)
				
				return {
					totalConnections: connectionMap.size,
					activeConnections,
					idleConnections,
					unhealthyConnections,
					totalSessions,
					queuedRequests: queueSize,
					totalAcquired: currentStats.totalAcquired,
					totalReleased: currentStats.totalReleased,
					averageWaitTime: currentStats.requestCount > 0 
						? currentStats.totalWaitTime / currentStats.requestCount 
						: 0
				}
			})
		
		/**
		 * Get resource metrics
		 */
		const getMetrics = (): Effect.Effect<ResourceMetrics, never> =>
			Effect.gen(function* () {
				const connectionMap = yield* Ref.get(connections)
				const currentStats = yield* Ref.get(stats)
				
				// Memory metrics (approximation)
				const memoryInfo = process.memoryUsage()
				
				const connections_array = Array.from(connectionMap.values())
				const openConnections = connections_array.filter(c => c.healthy).length
				const failedConnections = connections_array.filter(c => !c.healthy).length
				
				// Calculate average connection latency (approximation)
				const connectionLatency = connections_array.length > 0
					? connections_array.reduce((sum, c) => sum + (Date.now() - c.created), 0) / connections_array.length
					: 0
				
				const activeSessions = connections_array.reduce((sum, c) => sum + c.sessionCount, 0)
				const averageLifetime = connections_array.length > 0
					? connections_array.reduce((sum, c) => sum + (Date.now() - c.created), 0) / connections_array.length
					: 0
				
				return {
					memoryUsage: {
						used: memoryInfo.heapUsed,
						total: memoryInfo.heapTotal,
						percentage: (memoryInfo.heapUsed / memoryInfo.heapTotal) * 100
					},
					connectionMetrics: {
						openConnections,
						failedConnections,
						connectionLatency
					},
					sessionMetrics: {
						activeSessions,
						totalCreated: currentStats.totalAcquired,
						averageLifetime
					}
				}
			})
		
		/**
		 * Health check for all connections
		 */
		const healthCheck = (): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* Effect.logDebug('Running connection pool health check')
				
				const connectionMap = yield* Ref.get(connections)
				const connections_array = Array.from(connectionMap.values())
				
				// Check each connection health
				yield* Effect.forEach(
					connections_array,
					(connection) => Effect.gen(function* () {
						const healthy = yield* isConnectionHealthy(connection)
						
						if (!healthy && !connection.inUse) {
							yield* removeConnection(connection.id)
						} else if (!healthy) {
							// Mark as unhealthy but keep if in use
							yield* Ref.update(connections, map => 
								new Map(map).set(connection.id, { ...connection, healthy: false })
							)
						}
					}),
					{ concurrency: 'inherit' }
				)
				
				// Ensure minimum connections
				yield* ensureMinConnections()
				
				yield* Effect.logDebug('Connection pool health check completed')
			})
		
		/**
		 * Cleanup all connections
		 */
		const cleanup = (): Effect.Effect<void, never> =>
			Effect.gen(function* () {
				yield* Effect.logInfo('Cleaning up connection pool')
				
				const connectionMap = yield* Ref.get(connections)
				
				// Close all connections
				yield* Effect.forEach(
					Array.from(connectionMap.values()),
					(connection) => Effect.gen(function* () {
						yield* Effect.attempt(() => connection.cdpClient.disconnect()).pipe(
							Effect.ignore
						)
					}),
					{ concurrency: 'inherit' }
				)
				
				// Clear the connections map
				yield* Ref.set(connections, new Map())
				
				// Clear the queue
				yield* Queue.takeAll(queue).pipe(Effect.ignore)
				
				yield* Effect.logInfo('Connection pool cleanup completed')
			})
		
		/**
		 * Resize pool
		 */
		const resize = (
			minConnections: number,
			maxConnections: number
		): Effect.Effect<void, BrowserSessionError> =>
			Effect.gen(function* () {
				if (minConnections > maxConnections) {
					yield* Effect.fail(new BrowserSessionError({
						message: 'Minimum connections cannot exceed maximum connections'
					}))
				}
				
				yield* Effect.logInfo(`Resizing pool: min=${minConnections}, max=${maxConnections}`)
				
				const connectionMap = yield* Ref.get(connections)
				const currentCount = connectionMap.size
				
				// If we need to shrink
				if (currentCount > maxConnections) {
					const toRemove = currentCount - maxConnections
					const idleConnections = Array.from(connectionMap.values())
						.filter(c => !c.inUse)
						.slice(0, toRemove)
					
					yield* Effect.forEach(
						idleConnections,
						(connection) => removeConnection(connection.id),
						{ concurrency: 'inherit' }
					)
				}
				
				// Ensure minimum connections
				yield* ensureMinConnections()
			})
		
		// Initialize pool with minimum connections
		yield* ensureMinConnections()
		
		// Start background health check
		yield* Effect.fork(
			Effect.repeat(
				healthCheck(),
				Schedule.fixed(config.healthCheckInterval)
			)
		)
		
		return {
			acquireConnection,
			releaseConnection,
			getStats,
			getMetrics,
			healthCheck,
			cleanup,
			resize
		} satisfies ConnectionPoolServiceInterface
	})

/**
 * Connection pool service layer
 */
export const ConnectionPoolServiceLive = (config?: Partial<ConnectionPoolConfig>) =>
	Layer.effect(
		ConnectionPoolService,
		makeConnectionPoolService({ ...defaultPoolConfig, ...config })
	)