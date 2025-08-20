/**
 * @fileoverview Basic usage example matching the implementation guide API
 * This demonstrates Epic 1.1 completion - Project Foundation
 */

import { Effect, Layer } from 'effect'
import { BrowserUse, BrowserUseLive, AppConfigService } from './src/browser'
import type { AppConfig } from './src/config'

// Example configuration
const exampleConfig: AppConfig = {
  browser: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    timeout: 30000,
    retryAttempts: 3,
  },
  cdp: {
    host: 'localhost',
    port: 9222,
    secure: false,
    connectionTimeout: 10000,
  },
  logLevel: 'info',
}

// This matches the API shown in the implementation guide
const program = Effect.gen(function* () {
  const browserUse = yield* BrowserUse
  
  const session = yield* browserUse.create({
    headless: false,
    viewport: { width: 1280, height: 720 }
  })
  
  console.log('Browser created successfully')
  console.log(`Session ID: ${session.sessionId}`)
  
  // Basic operations (placeholders for now, will be enhanced in Epic 1.2 & 1.3)
  yield* session.navigate('https://example.com')
  const screenshot = yield* session.takeScreenshot()
  console.log(`Screenshot captured: ${screenshot.length} bytes`)
  
  yield* session.close()
  console.log('Session closed')
})

// Create the configuration layer
const ConfigLive = Layer.succeed(AppConfigService, exampleConfig)

// Provide the service and run
const main = program.pipe(
  Effect.provide(
    Layer.provide(BrowserUseLive, ConfigLive)
  )
)

// Run the program
Effect.runPromise(main).catch(console.error)