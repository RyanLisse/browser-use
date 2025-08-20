/**
 * @fileoverview Complete example showing Epic 1.1 + 1.2 + 1.3 integration
 * This demonstrates the full browser automation with real CDP
 */

import { Effect, Layer, Context } from 'effect'
import { BrowserUse, BrowserUseLive, AppConfigService } from './src/browser'
import { CDPClientLive } from './src/cdp'
import type { AppConfig, CDPConfig } from './src/config'

// Complete configuration for the enhanced browser
const appConfig: AppConfig = {
  browser: {
    headless: false,  // Set to true for headless mode
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

// Create configuration layers
const AppConfigLive = Layer.succeed(AppConfigService, appConfig)
const CDPConfigLive = Layer.succeed(
  Context.GenericTag<CDPConfig>('CDPConfig'),
  appConfig.cdp
)

// Complete application layer stack
const AppLive = Layer.provide(
  Layer.provide(BrowserUseLive, CDPClientLive),
  Layer.mergeAll(AppConfigLive, CDPConfigLive)
)

// Complete browser automation example
const browserAutomationDemo = Effect.gen(function* () {
  console.log('🚀 Starting Browser-Use Effect Demo')
  
  // Create browser session using the enhanced API
  const browserUse = yield* BrowserUse
  const session = yield* browserUse.create({
    headless: false,
    viewport: { width: 1920, height: 1080 }
  })
  
  console.log(`✅ Browser session created: ${session.sessionId}`)
  
  // Navigate to a website
  yield* session.navigate('https://example.com')
  console.log('📍 Navigated to https://example.com')
  
  // Wait for page to load
  yield* Effect.sleep('3 seconds')
  
  // Take a screenshot
  const screenshot = yield* session.takeScreenshot()
  console.log(`📸 Screenshot captured: ${screenshot.substring(0, 50)}...`)
  
  // Navigate to another page
  yield* session.navigate('https://httpbin.org/json')
  console.log('📍 Navigated to https://httpbin.org/json')
  
  // Wait and take another screenshot
  yield* Effect.sleep('2 seconds')
  const screenshot2 = yield* session.takeScreenshot()
  console.log(`📸 Second screenshot captured: ${screenshot2.substring(0, 50)}...`)
  
  // Close the session
  yield* session.close()
  console.log('🔴 Browser session closed')
  
  return {
    sessionId: session.sessionId,
    screenshotCount: 2,
    navigationCount: 2
  }
})

// Error handling demo
const errorHandlingDemo = Effect.gen(function* () {
  console.log('🔧 Testing error handling...')
  
  const browserUse = yield* BrowserUse
  const session = yield* browserUse.create()
  
  try {
    // Try to navigate to an invalid URL
    yield* session.navigate('https://this-domain-does-not-exist-12345.com')
  } catch (error) {
    console.log('❌ Navigation error handled gracefully:', error)
  }
  
  yield* session.close()
})

// Main program
const mainProgram = Effect.gen(function* () {
  console.log('🎯 Browser-Use Effect TypeScript Implementation')
  console.log('📋 Epics Completed: 1.1 (Foundation), 1.2 (CDP), 1.3 (Sessions)')
  console.log('')
  
  // Run the automation demo
  const results = yield* browserAutomationDemo
  
  console.log('')
  console.log('📊 Demo Results:')
  console.log(`   Session ID: ${results.sessionId}`)
  console.log(`   Screenshots: ${results.screenshotCount}`)
  console.log(`   Navigations: ${results.navigationCount}`)
  
  // Run error handling demo
  console.log('')
  yield* errorHandlingDemo
  
  console.log('')
  console.log('✨ All demos completed successfully!')
  
  return results
})

// To run this example:
// 1. Start Chrome with remote debugging: 
//    chrome --remote-debugging-port=9222 --disable-web-security
// 2. Uncomment the line below and run: npx tsx example-enhanced.ts

console.log('ℹ️  To run this demo:')
console.log('   1. Start Chrome: chrome --remote-debugging-port=9222 --disable-web-security')
console.log('   2. Uncomment the Effect.runPromise line below')
console.log('')

// Effect.runPromise(mainProgram.pipe(Effect.provide(AppLive)))
//   .then(results => console.log('🎉 Final results:', results))
//   .catch(error => console.error('💥 Error:', error))