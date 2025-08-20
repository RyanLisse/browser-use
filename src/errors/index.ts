/**
 * @fileoverview Error types and error handling for Browser-Use Effect
 */

import { Data } from 'effect'

/**
 * Base error type for all Browser-Use errors
 */
export class BrowserUseError extends Data.TaggedError('BrowserUseError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

/**
 * Configuration related errors
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
	readonly message: string
	readonly field?: string
	readonly cause?: unknown
}> {}

/**
 * Browser session errors
 */
export class BrowserSessionError extends Data.TaggedError('BrowserSessionError')<{
	readonly message: string
	readonly sessionId?: string
	readonly cause?: unknown
}> {}

/**
 * CDP connection errors
 */
export class CDPConnectionError extends Data.TaggedError('CDPConnectionError')<{
	readonly message: string
	readonly host?: string
	readonly port?: number
	readonly cause?: unknown
}> {}

/**
 * CDP command execution errors
 */
export class CDPCommandError extends Data.TaggedError('CDPCommandError')<{
	readonly message: string
	readonly command?: string
	readonly cause?: unknown
}> {}