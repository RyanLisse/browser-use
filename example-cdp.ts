/**
 * @fileoverview CDP integration example showing Epic 1.2 completion
 */

import { Effect, Layer, Context } from 'effect'
import { CDPClient, CDPCommands, CDPClientLive } from './src/cdp'
import type { CDPConfig } from './src/config'

// Example CDP configuration
const exampleCDPConfig: CDPConfig = {
  host: 'localhost',
  port: 9222,
  secure: false,
  connectionTimeout: 10000,
}

// Create the CDP configuration layer
const CDPConfigLive = Layer.succeed(
  Context.GenericTag<CDPConfig>('CDPConfig'),
  exampleCDPConfig
)

// This matches the API shown in the implementation guide
const program = Effect.gen(function* () {
  const cdp = yield* CDPClient
  
  // Connect to CDP
  yield* cdp.connect()
  console.log('Connected to Chrome DevTools Protocol')
  
  // Get browser version using CDP helper
  const version = yield* CDPCommands.getBrowserVersion()
  console.log(`Browser: ${version.product}`)
  console.log(`Revision: ${version.revision}`)
  
  // Enable domains
  yield* CDPCommands.enableRuntime()
  yield* CDPCommands.enablePage()
  console.log('Runtime and Page domains enabled')
  
  // Navigate to a page
  const navigation = yield* CDPCommands.navigateToUrl('https://example.com')
  console.log(`Navigation started, frameId: ${navigation.frameId}`)
  
  // Wait a bit for page to load
  yield* Effect.sleep('2 seconds')
  
  // Take a screenshot
  const screenshot = yield* CDPCommands.captureScreenshot()
  console.log(`Screenshot captured: ${screenshot.data.length} characters`)
  
  // Check connection status
  const isConnected = yield* cdp.isConnected()
  console.log(`Still connected: ${isConnected}`)
  
  // Clean up
  yield* cdp.disconnect()
  console.log('Disconnected from CDP')
})

// Provide the CDP services and run
const main = program.pipe(
  Effect.provide(
    Layer.provide(CDPClientLive, CDPConfigLive)
  )
)

// Note: This example requires Chrome to be running with remote debugging
// Start Chrome with: chrome --remote-debugging-port=9222 --disable-web-security
console.log('Make sure Chrome is running with: chrome --remote-debugging-port=9222')

// Uncomment to run with real Chrome:
// Effect.runPromise(main).catch(console.error)