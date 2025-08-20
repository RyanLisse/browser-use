/**
 * @fileoverview Logging implementation using Effect Logger
 */

import { Effect, Logger, LogLevel } from 'effect'
import type { AppConfig } from '../config'

/**
 * Create a logger with the specified log level
 */
export const createLogger = (config: AppConfig): Logger.Logger<unknown, void> => {
	const level = getLogLevel(config.logLevel)
	
	return Logger.make<unknown, void>(({ logLevel, message }) => {
		if (LogLevel.lessThanEqual(level, logLevel)) {
			const timestamp = new Date().toISOString()
			const levelStr = logLevel._tag.toUpperCase()
			
			console.log(`[${timestamp}] ${levelStr}: ${message}`)
		}
		return Effect.void
	})
}

/**
 * Convert string log level to Effect LogLevel
 */
const getLogLevel = (level: AppConfig['logLevel']): LogLevel.LogLevel => {
	switch (level) {
		case 'debug':
			return LogLevel.Debug
		case 'info':
			return LogLevel.Info
		case 'warn':
			return LogLevel.Warning
		case 'error':
			return LogLevel.Error
		default:
			return LogLevel.Info
	}
}

/**
 * Logging utilities using Effect.log
 */
export const logInfo = (message: string): Effect.Effect<void> =>
	Effect.logInfo(message)

export const logDebug = (message: string): Effect.Effect<void> =>
	Effect.logDebug(message)

export const logWarn = (message: string): Effect.Effect<void> =>
	Effect.logWarning(message)

export const logError = (message: string, cause?: unknown): Effect.Effect<void> =>
	cause 
		? Effect.logError(message, cause)
		: Effect.logError(message)