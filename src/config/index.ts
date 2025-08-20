/**
 * @fileoverview Configuration management using TypeScript types and Effect Config
 */

import { Config } from 'effect'

/**
 * Browser configuration interface
 */
export interface BrowserConfig {
	readonly headless: boolean
	readonly viewport: {
		readonly width: number
		readonly height: number
	}
	readonly timeout: number
	readonly retryAttempts: number
}

/**
 * CDP (Chrome DevTools Protocol) configuration
 */
export interface CDPConfig {
	readonly host: string
	readonly port: number
	readonly secure: boolean
	readonly connectionTimeout: number
}

/**
 * Main application configuration
 */
export interface AppConfig {
	readonly browser: BrowserConfig
	readonly cdp: CDPConfig
	readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * Effect Config instances
 */
export const browserConfig = Config.all({
	headless: Config.boolean('BROWSER_HEADLESS').pipe(Config.withDefault(false)),
	viewport: Config.all({
		width: Config.integer('BROWSER_VIEWPORT_WIDTH').pipe(Config.withDefault(1280)),
		height: Config.integer('BROWSER_VIEWPORT_HEIGHT').pipe(Config.withDefault(720)),
	}),
	timeout: Config.integer('BROWSER_TIMEOUT').pipe(Config.withDefault(30000)),
	retryAttempts: Config.integer('BROWSER_RETRY_ATTEMPTS').pipe(Config.withDefault(3)),
})

export const cdpConfig = Config.all({
	host: Config.string('CDP_HOST').pipe(Config.withDefault('localhost')),
	port: Config.integer('CDP_PORT').pipe(Config.withDefault(9222)),
	secure: Config.boolean('CDP_SECURE').pipe(Config.withDefault(false)),
	connectionTimeout: Config.integer('CDP_CONNECTION_TIMEOUT').pipe(Config.withDefault(10000)),
})

export const appConfig = Config.all({
	browser: browserConfig,
	cdp: cdpConfig,
	logLevel: Config.literal('debug', 'info', 'warn', 'error')('LOG_LEVEL').pipe(
		Config.withDefault('info' as const)
	),
})