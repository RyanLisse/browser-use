# Production Deployment Guide

This guide covers deploying Browser-Use in production environments with all the advanced features for reliability, monitoring, and performance.

## Production Architecture

Browser-Use provides a comprehensive suite of production-ready services:

- **Connection Pool Service**: Manages CDP connections efficiently with health monitoring
- **Resilience Service**: Provides retry logic, circuit breakers, and error recovery
- **Observability Service**: Collects metrics, traces, and provides monitoring capabilities
- **Configuration Service**: Handles environment-based configuration with encryption support

## Quick Start

```typescript
import { Effect, Layer } from 'effect'
import {
  BrowserUseLive,
  ConnectionPoolServiceLive,
  ResilienceServiceLive,
  ObservabilityServiceLive,
  ConfigurationServiceLive
} from '@browser-use/effect'

// Create production-ready layer stack
const ProductionBrowserLayer = BrowserUseLive.pipe(
  Layer.provide(ConnectionPoolServiceLive({
    minConnections: 5,
    maxConnections: 20,
    healthCheckInterval: 30000
  })),
  Layer.provide(ResilienceServiceLive({
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeout: 60000
    },
    retryPolicy: {
      maxAttempts: 3,
      initialDelay: 1000
    }
  })),
  Layer.provide(ObservabilityServiceLive({
    tracingEnabled: true,
    samplingRate: 0.1,
    alerting: { enabled: true }
  })),
  Layer.provide(ConfigurationServiceLive('production'))
)

// Use in your application
const program = Effect.gen(function* () {
  const browser = yield* BrowserUse
  const session = yield* browser.create({ headless: true })
  
  yield* session.navigate('https://example.com')
  const screenshot = yield* session.takeScreenshot()
  
  return screenshot
})

// Run with production layer
Effect.runPromise(program.pipe(
  Effect.provide(ProductionBrowserLayer)
))
```

## Connection Pool Service

Manages CDP connections for optimal resource usage:

### Configuration

```typescript
import { ConnectionPoolServiceLive } from '@browser-use/effect'

const poolConfig = {
  minConnections: 2,           // Minimum connections to maintain
  maxConnections: 10,          // Maximum connections allowed
  maxIdleTime: 300000,         // 5 minutes idle timeout
  healthCheckInterval: 60000,  // Health check every minute
  connectionTimeout: 10000,    // 10 second connection timeout
  retryAttempts: 3,           // Retry failed connections
  maxSessionsPerConnection: 50 // Sessions per connection limit
}

const PoolLive = ConnectionPoolServiceLive(poolConfig)
```

### Monitoring Pool Health

```typescript
const program = Effect.gen(function* () {
  const pool = yield* ConnectionPoolService
  
  // Get pool statistics
  const stats = yield* pool.getStats()
  console.log(`Active: ${stats.activeConnections}/${stats.totalConnections}`)
  
  // Get resource metrics
  const metrics = yield* pool.getMetrics()
  console.log(`Memory usage: ${metrics.memoryUsage.percentage}%`)
  
  // Manual health check
  yield* pool.healthCheck()
})
```

## Resilience Service

Provides comprehensive error handling and recovery:

### Retry Logic

```typescript
import { ResilienceService, withFullResilience } from '@browser-use/effect'

const program = Effect.gen(function* () {
  const resilience = yield* ResilienceService
  
  // Automatic retry on failures
  const result = yield* resilience.withRetry(
    () => session.navigate('https://unreliable-site.com'),
    'navigation'
  )
})

// Or use the convenience function with all patterns
const robustOperation = withFullResilience(
  () => session.querySelector('#dynamic-element'),
  'dom-query',
  'dom-circuit-breaker',
  5000 // 5 second timeout
)
```

### Circuit Breakers

```typescript
const program = Effect.gen(function* () {
  const resilience = yield* ResilienceService
  
  // Wrap operations with circuit breaker
  const result = yield* resilience.withCircuitBreaker(
    () => externalAPICall(),
    'external-api'
  )
  
  // Check circuit breaker status
  const metrics = yield* resilience.getCircuitBreakerMetrics('external-api')
  console.log(`Circuit state: ${metrics?.state}`)
})
```

### Error Recovery

```typescript
const program = Effect.gen(function* () {
  const resilience = yield* ResilienceService
  
  const recovery = yield* resilience.recoverFromError(
    error,
    {
      operationId: 'nav-123',
      attempt: 2,
      lastError: error,
      startTime: Date.now(),
      operationType: 'navigation'
    },
    // Recovery function
    () => session.reload()
  )
  
  if (recovery.success) {
    console.log(`Recovered with actions: ${recovery.recoveryActions}`)
  }
})
```

## Observability Service

Comprehensive monitoring and metrics collection:

### Metrics Collection

```typescript
import { ObservabilityService, traced } from '@browser-use/effect'

const program = Effect.gen(function* () {
  const observability = yield* ObservabilityService
  
  // Record metrics manually
  yield* observability.incrementCounter('page_loads', { site: 'example.com' })
  yield* observability.setGauge('active_sessions', 15)
  yield* observability.recordHistogram('response_time', 250)
  
  // Time operations automatically
  const result = yield* observability.recordTimer(
    'dom_query_duration',
    () => session.querySelector('button'),
    { selector_type: 'tag' }
  )
})
```

### Distributed Tracing

```typescript
// Manual tracing
const program = Effect.gen(function* () {
  const observability = yield* ObservabilityService
  
  const span = yield* observability.startSpan('user_workflow')
  yield* observability.addSpanTag(span.spanId, 'user_id', userId)
  
  // ... perform operations ...
  
  yield* observability.finishSpan(span.spanId, 'success')
})

// Automatic tracing with convenience function
const tracedOperation = traced('user_login', (span) => 
  Effect.gen(function* () {
    yield* session.navigate('/login')
    yield* session.typeBySelector('#username', username)
    yield* session.typeBySelector('#password', password)
    yield* session.clickBySelector('#login-btn')
  })
)
```

### Health Monitoring

```typescript
const program = Effect.gen(function* () {
  const observability = yield* ObservabilityService
  
  // Get system health
  const health = yield* observability.getSystemHealth()
  console.log(`System status: ${health.status} (${health.score}/100)`)
  
  // Get performance metrics
  const perfMetrics = yield* observability.getPerformanceMetrics()
  console.log(`DOM error rate: ${perfMetrics.operations.domOperations.failureRate}`)
  
  // Check for active alerts
  const alerts = yield* observability.checkAlerts()
  alerts.forEach(alert => console.log(`Alert: ${alert.message}`))
})
```

### Metrics Export

```typescript
const program = Effect.gen(function* () {
  const observability = yield* ObservabilityService
  
  // Export to Prometheus format
  const prometheusMetrics = yield* observability.exportMetrics('prometheus')
  
  // Export to JSON
  const jsonMetrics = yield* observability.exportMetrics('json')
  
  // Set up periodic export
  const exportJob = Effect.repeat(
    observability.exportMetrics('prometheus').pipe(
      Effect.tap(metrics => Effect.sync(() => sendToMonitoring(metrics)))
    ),
    Schedule.fixed(60000) // Every minute
  )
  
  yield* Effect.fork(exportJob)
})
```

## Configuration Service

Environment-based configuration with encryption:

### Environment Configuration

```typescript
import { ConfigurationServiceLive, getValidatedConfig } from '@browser-use/effect'

// Environment variables
process.env.NODE_ENV = 'production'
process.env.BROWSER_HEADLESS = 'true'
process.env.CDP_PORT = '9222'
process.env.MAX_INSTANCES = '20'
process.env.MONITORING_ENABLED = 'true'

// Initialize configuration service
const ConfigLive = ConfigurationServiceLive('production', [
  '/etc/browser-use/config.json',
  './config/production.json'
])

const program = Effect.gen(function* () {
  // Get validated configuration
  const config = yield* getValidatedConfig()
  
  console.log(`Environment: ${config.environment}`)
  console.log(`Max instances: ${config.scaling.maxInstances}`)
})
```

### Dynamic Configuration

```typescript
const program = Effect.gen(function* () {
  const configService = yield* ConfigurationService
  
  // Watch for configuration changes
  const unwatch = yield* configService.watch('scaling.maxInstances', (change) => {
    console.log(`Max instances changed from ${change.oldValue} to ${change.newValue}`)
  })
  
  // Update configuration at runtime
  yield* configService.set('feature.flags.newUI', true, 'runtime')
  
  // Get configuration history
  const history = yield* configService.getHistory('scaling.maxInstances')
  console.log(`Configuration changed ${history.length} times`)
})
```

### Secrets Management

```typescript
const program = Effect.gen(function* () {
  const configService = yield* ConfigurationService
  
  // Encrypt sensitive values
  const encrypted = yield* configService.encrypt('secret-api-key')
  yield* configService.set('api.key', encrypted)
  
  // Values are automatically decrypted when retrieved
  const apiKey = yield* configService.get<string>('api.key')
})
```

## Production Deployment Checklist

### 1. Environment Configuration

- [ ] Set `NODE_ENV=production`
- [ ] Configure connection pool limits
- [ ] Set appropriate timeouts
- [ ] Enable monitoring
- [ ] Configure log levels

### 2. Monitoring Setup

- [ ] Export metrics to monitoring system (Prometheus/DataDog)
- [ ] Set up alerts for high error rates
- [ ] Monitor connection pool health
- [ ] Track circuit breaker states
- [ ] Monitor memory usage

### 3. Security

- [ ] Encrypt sensitive configuration values
- [ ] Use HTTPS for CDP connections
- [ ] Set CORS policies
- [ ] Configure rate limiting
- [ ] Review allowed origins

### 4. Scaling

- [ ] Set connection pool limits based on load
- [ ] Configure circuit breaker thresholds
- [ ] Set memory and CPU limits
- [ ] Test failover scenarios
- [ ] Plan for horizontal scaling

### 5. Reliability

- [ ] Test error recovery scenarios
- [ ] Verify retry logic
- [ ] Validate circuit breaker behavior
- [ ] Test connection pool exhaustion
- [ ] Plan disaster recovery

## Environment Variables Reference

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `NODE_ENV` | Environment | `development` | `production` |
| `BROWSER_HEADLESS` | Headless mode | `false` | `true` |
| `BROWSER_TIMEOUT` | Browser timeout | `30000` | `60000` |
| `CDP_HOST` | CDP host | `localhost` | `cdp-server` |
| `CDP_PORT` | CDP port | `9222` | `9222` |
| `MAX_INSTANCES` | Max browser instances | `10` | `20` |
| `MAX_MEMORY` | Max memory (MB) | `2048` | `4096` |
| `MONITORING_ENABLED` | Enable monitoring | `false` | `true` |
| `MONITORING_ENDPOINT` | Metrics endpoint | - | `https://metrics.company.com` |
| `ENCRYPTION_KEY` | Config encryption key | - | `your-secret-key` |
| `FEATURE_FLAGS` | Feature flags JSON | `{}` | `{"newUI":true}` |

## Performance Tuning

### Connection Pool Tuning

```typescript
const highThroughputConfig = {
  minConnections: 10,
  maxConnections: 50,
  maxIdleTime: 180000,    // 3 minutes
  healthCheckInterval: 30000,  // 30 seconds
  maxSessionsPerConnection: 100
}
```

### Resilience Tuning

```typescript
const productionResilienceConfig = {
  circuitBreaker: {
    failureThreshold: 10,
    resetTimeout: 120000,  // 2 minutes
    halfOpenMaxCalls: 5
  },
  retryPolicy: {
    maxAttempts: 5,
    initialDelay: 500,
    maxDelay: 10000,
    backoffFactor: 1.5
  },
  timeout: {
    operationTimeout: 60000,  // 1 minute
    connectionTimeout: 15000, // 15 seconds
    commandTimeout: 10000     // 10 seconds
  }
}
```

### Observability Tuning

```typescript
const productionObservabilityConfig = {
  tracingEnabled: true,
  samplingRate: 0.01,  // 1% sampling for high traffic
  batchSize: 1000,
  flushInterval: 30000,  // 30 seconds
  alerting: {
    enabled: true,
    rules: [
      {
        name: 'high_error_rate',
        threshold: 0.05,  // 5% error rate
        window: 300000,   // 5 minute window
        severity: 'critical'
      }
    ]
  }
}
```

## Troubleshooting

### Common Issues

**Connection Pool Exhaustion**
```typescript
// Monitor pool stats
const stats = yield* pool.getStats()
if (stats.queuedRequests > 10) {
  console.warn('Pool overloaded, consider scaling')
}
```

**Circuit Breaker Stuck Open**
```typescript
// Reset circuit breaker manually
yield* resilience.resetCircuitBreaker('problematic-service')
```

**High Memory Usage**
```typescript
// Monitor memory metrics
const metrics = yield* pool.getMetrics()
if (metrics.memoryUsage.percentage > 90) {
  console.error('High memory usage detected')
  yield* pool.cleanup()
}
```

### Debugging

Enable debug logging:
```typescript
process.env.LOG_LEVEL = 'debug'
```

Export detailed metrics:
```typescript
const debugMetrics = yield* observability.exportMetrics('json')
console.log(JSON.stringify(JSON.parse(debugMetrics), null, 2))
```

## Migration from Basic Setup

1. **Add production services to your layer stack**
2. **Move configuration to environment variables**
3. **Add monitoring endpoints**
4. **Update error handling to use resilience patterns**
5. **Add health checks to your deployment**

This production setup provides enterprise-grade reliability, monitoring, and performance for Browser-Use deployments.