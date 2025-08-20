/**
 * @fileoverview Tests for Epic 4.1: Connection pooling and resource management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, Layer, Ref } from 'effect'
import { ConnectionPoolService, ConnectionPoolServiceLive, defaultPoolConfig, type ConnectionPoolConfig } from '../../src/pool'
import { CDPClient, CDPClientLive } from '../../src/cdp'
import { createMockCDPClientLive } from '../cdp-mock'
import { BrowserSessionError } from '../../src/errors'

// Test configuration for connection pool
const testPoolConfig: ConnectionPoolConfig = {
	minConnections: 2,
	maxConnections: 5,
	maxIdleTime: 30000, // 30 seconds for testing
	healthCheckInterval: 5000, // 5 seconds for testing
	connectionTimeout: 5000,
	retryAttempts: 2,
	maxSessionsPerConnection: 10
}

describe('ConnectionPool Service', () => {
	const TestConnectionPoolLive = ConnectionPoolServiceLive(testPoolConfig).pipe(
		Layer.provide(createMockCDPClientLive())
	)

	describe('Basic Pool Operations', () => {
		it('should create minimum connections on initialization', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				const stats = yield* pool.getStats()
				
				expect(stats.totalConnections).toBeGreaterThanOrEqual(testPoolConfig.minConnections)
				expect(stats.activeConnections).toBe(0)
				expect(stats.idleConnections).toBeGreaterThanOrEqual(testPoolConfig.minConnections)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})

		it('should acquire and release connections', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				// Acquire connection
				const connection = yield* pool.acquireConnection()
				expect(connection.id).toBeDefined()
				expect(connection.inUse).toBe(true)
				
				const statsAfterAcquire = yield* pool.getStats()
				expect(statsAfterAcquire.activeConnections).toBe(1)
				
				// Release connection
				yield* pool.releaseConnection(connection.id)
				
				const statsAfterRelease = yield* pool.getStats()
				expect(statsAfterRelease.activeConnections).toBe(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})

		it('should handle connection pool exhaustion', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				const connections: any[] = []
				
				// Acquire all available connections
				for (let i = 0; i < testPoolConfig.maxConnections; i++) {
					const connection = yield* pool.acquireConnection()
					connections.push(connection)
				}
				
				const stats = yield* pool.getStats()
				expect(stats.activeConnections).toBe(testPoolConfig.maxConnections)
				
				// Trying to acquire one more should queue the request
				// This is a simplified test - in reality it would wait for an available connection
				
				// Release all connections
				yield* Effect.all(
					connections.map(conn => pool.releaseConnection(conn.id))
				)
				
				const finalStats = yield* pool.getStats()
				expect(finalStats.activeConnections).toBe(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})
	})

	describe('Pool Health Management', () => {
		it('should run health checks', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				// Run health check
				yield* pool.healthCheck()
				
				const stats = yield* pool.getStats()
				expect(stats.unhealthyConnections).toBe(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})

		it('should provide resource metrics', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				const metrics = yield* pool.getMetrics()
				
				expect(metrics.memoryUsage).toBeDefined()
				expect(metrics.memoryUsage.used).toBeGreaterThan(0)
				expect(metrics.memoryUsage.percentage).toBeGreaterThanOrEqual(0)
				
				expect(metrics.connectionMetrics).toBeDefined()
				expect(metrics.connectionMetrics.openConnections).toBeGreaterThanOrEqual(0)
				
				expect(metrics.sessionMetrics).toBeDefined()
				expect(metrics.sessionMetrics.activeSessions).toBeGreaterThanOrEqual(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})
	})

	describe('Pool Resizing', () => {
		it('should resize pool correctly', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				const initialStats = yield* pool.getStats()
				expect(initialStats.totalConnections).toBe(testPoolConfig.minConnections)
				
				// Resize pool
				yield* pool.resize(3, 8)
				
				// Allow some time for connections to be created
				yield* Effect.sleep('100 millis')
				
				const finalStats = yield* pool.getStats()
				expect(finalStats.totalConnections).toBeGreaterThanOrEqual(3)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})

		it('should reject invalid resize parameters', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				// Try to set minConnections > maxConnections
				const result = yield* pool.resize(10, 5).pipe(Effect.either)
				
				expect(result._tag).toBe('Left')
				if (result._tag === 'Left') {
					expect(result.left).toBeInstanceOf(BrowserSessionError)
				}
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})
	})

	describe('Pool Cleanup', () => {
		it('should cleanup all connections', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				// Acquire some connections first
				const connection1 = yield* pool.acquireConnection()
				const connection2 = yield* pool.acquireConnection()
				
				const statsBeforeCleanup = yield* pool.getStats()
				expect(statsBeforeCleanup.totalConnections).toBeGreaterThan(0)
				
				// Cleanup
				yield* pool.cleanup()
				
				const statsAfterCleanup = yield* pool.getStats()
				expect(statsAfterCleanup.totalConnections).toBe(0)
				expect(statsAfterCleanup.activeConnections).toBe(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})
	})

	describe('Pool Statistics', () => {
		it('should track acquisition and release statistics', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				const initialStats = yield* pool.getStats()
				const initialAcquired = initialStats.totalAcquired
				const initialReleased = initialStats.totalReleased
				
				// Acquire and release a connection
				const connection = yield* pool.acquireConnection()
				yield* pool.releaseConnection(connection.id)
				
				const finalStats = yield* pool.getStats()
				expect(finalStats.totalAcquired).toBe(initialAcquired + 1)
				expect(finalStats.totalReleased).toBe(initialReleased + 1)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})

		it('should calculate average wait time', async () => {
			const program = Effect.gen(function* () {
				const pool = yield* ConnectionPoolService
				
				// Acquire and release several connections to generate metrics
				for (let i = 0; i < 3; i++) {
					const connection = yield* pool.acquireConnection()
					yield* Effect.sleep('10 millis') // Add some processing time
					yield* pool.releaseConnection(connection.id)
				}
				
				const stats = yield* pool.getStats()
				expect(stats.averageWaitTime).toBeGreaterThanOrEqual(0)
			})

			const result = await Effect.runPromise(program.pipe(
				Effect.provide(TestConnectionPoolLive)
			))
		})
	})
})