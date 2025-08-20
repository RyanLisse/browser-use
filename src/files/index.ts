/**
 * @fileoverview File management service for browser automation
 * Epic 3.2: Add file download and upload capabilities
 */

import { Context, Effect, Layer } from 'effect'
import { CDPClient, CDPCommands } from '../cdp'
import { BrowserSessionError } from '../errors'
import * as fs from 'fs'
import * as path from 'path'

/**
 * File download information
 */
export interface FileDownload {
	readonly downloadId: string
	readonly url: string
	readonly fileName: string
	readonly filePath: string
	readonly totalBytes?: number
	readonly downloadedBytes: number
	readonly state: 'pending' | 'inProgress' | 'completed' | 'cancelled' | 'error'
	readonly startTime: number
	readonly endTime?: number
	readonly error?: string
}

/**
 * File upload information
 */
export interface FileUpload {
	readonly uploadId: string
	readonly filePath: string
	readonly targetSelector: string
	readonly uploadedBytes: number
	readonly totalBytes: number
	readonly state: 'pending' | 'inProgress' | 'completed' | 'error'
	readonly startTime: number
	readonly endTime?: number
	readonly error?: string
}

/**
 * Download options
 */
export interface DownloadOptions {
	readonly downloadPath?: string
	readonly overwrite?: boolean
	readonly timeout?: number
	readonly onProgress?: (downloadedBytes: number, totalBytes?: number) => void
}

/**
 * Upload options
 */
export interface UploadOptions {
	readonly mimeType?: string
	readonly timeout?: number
	readonly clearFirst?: boolean
	readonly onProgress?: (uploadedBytes: number, totalBytes: number) => void
}

/**
 * File management service interface
 */
export interface FileManagementServiceInterface {
	readonly downloadFile: (
		url: string,
		sessionId: string,
		options?: DownloadOptions
	) => Effect.Effect<FileDownload, BrowserSessionError>

	readonly uploadFile: (
		filePath: string,
		targetSelector: string,
		sessionId: string,
		options?: UploadOptions
	) => Effect.Effect<FileUpload, BrowserSessionError>

	readonly waitForDownload: (
		downloadId: string,
		timeout?: number
	) => Effect.Effect<FileDownload, BrowserSessionError>

	readonly cancelDownload: (
		downloadId: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly getDownloads: (
		sessionId: string
	) => Effect.Effect<readonly FileDownload[], never>

	readonly clearDownloads: (
		sessionId: string
	) => Effect.Effect<void, never>

	readonly setDownloadPath: (
		downloadPath: string,
		sessionId: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly getFileInfo: (
		filePath: string
	) => Effect.Effect<{
		readonly exists: boolean
		readonly size: number
		readonly mimeType: string
		readonly lastModified: number
	}, BrowserSessionError>

	readonly deleteFile: (
		filePath: string
	) => Effect.Effect<void, BrowserSessionError>

	readonly moveFile: (
		sourcePath: string,
		targetPath: string
	) => Effect.Effect<void, BrowserSessionError>
}

/**
 * File management service context tag
 */
export const FileManagementService = Context.GenericTag<FileManagementServiceInterface>('FileManagementService')

/**
 * Create file management service implementation
 */
const makeFileManagementService = Effect.gen(function* () {
	const cdp = yield* CDPClient

	// State management for downloads and uploads
	const downloads = new Map<string, FileDownload>()
	const uploads = new Map<string, FileUpload>()
	const sessionDownloads = new Map<string, Set<string>>()

	const downloadFile = (
		url: string,
		sessionId: string,
		options: DownloadOptions = {}
	): Effect.Effect<FileDownload, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Starting download: ${url}`)

				const downloadId = crypto.randomUUID()
				const fileName = path.basename(new URL(url).pathname) || `download_${Date.now()}`
				const downloadPath = options.downloadPath || process.cwd()
				const filePath = path.join(downloadPath, fileName)

				// Check if file exists and handle overwrite
				if (!options.overwrite && fs.existsSync(filePath)) {
					yield* Effect.fail(new BrowserSessionError({
						message: `File already exists: ${filePath}`,
						sessionId
					}))
				}

				// Create download record
				const download: FileDownload = {
					downloadId,
					url,
					fileName,
					filePath,
					downloadedBytes: 0,
					state: 'pending',
					startTime: Date.now()
				}

				downloads.set(downloadId, download)

				// Track per-session downloads
				if (!sessionDownloads.has(sessionId)) {
					sessionDownloads.set(sessionId, new Set())
				}
				sessionDownloads.get(sessionId)!.add(downloadId)

				// Set download behavior
				yield* cdp.send('Page.setDownloadBehavior', {
					behavior: 'allow',
					downloadPath: downloadPath
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to set download behavior',
							sessionId,
							cause: error
						})
					)
				)

				// Register download event listeners
				yield* cdp.register.Browser.downloadWillBegin((event) =>
					Effect.gen(function* () {
						if (event.url === url) {
							downloads.set(downloadId, {
								...download,
								state: 'inProgress',
								totalBytes: event.totalBytes
							})
							yield* Effect.logInfo(`Download started: ${fileName} (${event.totalBytes} bytes)`)
						}
					}).pipe(Effect.runSync)
				)

				yield* cdp.register.Browser.downloadProgress((event) =>
					Effect.gen(function* () {
						const currentDownload = downloads.get(downloadId)
						if (currentDownload && event.downloadId === downloadId) {
							const updatedDownload = {
								...currentDownload,
								downloadedBytes: event.receivedBytes
							}
							downloads.set(downloadId, updatedDownload)
							
							options.onProgress?.(event.receivedBytes, currentDownload.totalBytes)
							
							if (event.state === 'completed') {
								downloads.set(downloadId, {
									...updatedDownload,
									state: 'completed',
									endTime: Date.now()
								})
								yield* Effect.logInfo(`Download completed: ${fileName}`)
							} else if (event.state === 'cancelled') {
								downloads.set(downloadId, {
									...updatedDownload,
									state: 'cancelled',
									endTime: Date.now()
								})
								yield* Effect.logWarning(`Download cancelled: ${fileName}`)
							}
						}
					}).pipe(Effect.runSync)
				)

				// Navigate to URL to trigger download
				yield* cdp.send('Page.navigate', { url }, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to navigate to download URL: ${url}`,
							sessionId,
							cause: error
						})
					)
				)

				yield* Effect.logInfo(`Download initiated: ${downloadId}`)
				return download

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Download initiation failed: ${url}`,
					sessionId,
					cause: error
				}))
			}
		})

	const uploadFile = (
		filePath: string,
		targetSelector: string,
		sessionId: string,
		options: UploadOptions = {}
	): Effect.Effect<FileUpload, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				yield* Effect.logDebug(`Starting upload: ${filePath} to ${targetSelector}`)

				// Check if file exists
				if (!fs.existsSync(filePath)) {
					yield* Effect.fail(new BrowserSessionError({
						message: `File not found: ${filePath}`,
						sessionId
					}))
				}

				const fileStats = fs.statSync(filePath)
				const uploadId = crypto.randomUUID()

				const upload: FileUpload = {
					uploadId,
					filePath,
					targetSelector,
					uploadedBytes: 0,
					totalBytes: fileStats.size,
					state: 'pending',
					startTime: Date.now()
				}

				uploads.set(uploadId, upload)

				// Find the file input element
				const documentResult = yield* CDPCommands.getDocument(sessionId).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: 'Failed to get document',
							sessionId,
							cause: error
						})
					)
				)

				const queryResult = yield* CDPCommands.querySelector(
					documentResult.result.root.nodeId,
					targetSelector,
					sessionId
				).pipe(
					Effect.provide(Layer.succeed(CDPClient, cdp)),
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to find upload target: ${targetSelector}`,
							sessionId,
							cause: error
						})
					)
				)

				if (!queryResult.result.nodeId) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Upload target not found: ${targetSelector}`,
						sessionId
					}))
				}

				// Set upload state to in progress
				uploads.set(uploadId, {
					...upload,
					state: 'inProgress'
				})

				// Clear existing files if requested
				if (options.clearFirst) {
					yield* cdp.send('DOM.setFileInputFiles', {
						files: [],
						nodeId: queryResult.result.nodeId
					}, sessionId).pipe(
						Effect.mapError((error) =>
							new BrowserSessionError({
								message: 'Failed to clear file input',
								sessionId,
								cause: error
							})
						)
					)
				}

				// Set files on the input element
				yield* cdp.send('DOM.setFileInputFiles', {
					files: [filePath],
					nodeId: queryResult.result.nodeId
				}, sessionId).pipe(
					Effect.mapError((error) =>
						new BrowserSessionError({
							message: `Failed to upload file: ${filePath}`,
							sessionId,
							cause: error
						})
					)
				)

				// Update upload state to completed
				const completedUpload = {
					...upload,
					state: 'completed' as const,
					uploadedBytes: fileStats.size,
					endTime: Date.now()
				}
				uploads.set(uploadId, completedUpload)

				yield* Effect.logInfo(`Upload completed: ${filePath}`)
				return completedUpload

			} catch (error) {
				const errorUpload: FileUpload = {
					uploadId: crypto.randomUUID(),
					filePath,
					targetSelector,
					uploadedBytes: 0,
					totalBytes: 0,
					state: 'error',
					startTime: Date.now(),
					endTime: Date.now(),
					error: error instanceof Error ? error.message : String(error)
				}
				uploads.set(errorUpload.uploadId, errorUpload)

				yield* Effect.fail(new BrowserSessionError({
					message: `Upload failed: ${filePath}`,
					sessionId,
					cause: error
				}))
			}
		})

	const waitForDownload = (
		downloadId: string,
		timeout = 30000
	): Effect.Effect<FileDownload, BrowserSessionError> =>
		Effect.gen(function* () {
			const startTime = Date.now()

			while (Date.now() - startTime < timeout) {
				const download = downloads.get(downloadId)
				if (!download) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Download not found: ${downloadId}`
					}))
				}

				if (download.state === 'completed') {
					return download
				}

				if (download.state === 'cancelled' || download.state === 'error') {
					yield* Effect.fail(new BrowserSessionError({
						message: `Download failed: ${download.error || 'Download was cancelled'}`
					}))
				}

				yield* Effect.sleep('100 millis')
			}

			yield* Effect.fail(new BrowserSessionError({
				message: `Download timeout: ${downloadId}`
			}))
		})

	const cancelDownload = (
		downloadId: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			const download = downloads.get(downloadId)
			if (!download) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Download not found: ${downloadId}`,
					sessionId
				}))
			}

			if (download.state === 'inProgress') {
				downloads.set(downloadId, {
					...download,
					state: 'cancelled',
					endTime: Date.now()
				})
				yield* Effect.logInfo(`Download cancelled: ${downloadId}`)
			}
		})

	const getDownloads = (
		sessionId: string
	): Effect.Effect<readonly FileDownload[], never> =>
		Effect.succeed(
			Array.from(sessionDownloads.get(sessionId) || [])
				.map(downloadId => downloads.get(downloadId))
				.filter((download): download is FileDownload => download !== undefined)
		)

	const clearDownloads = (
		sessionId: string
	): Effect.Effect<void, never> =>
		Effect.gen(function* () {
			const sessionDownloadIds = sessionDownloads.get(sessionId)
			if (sessionDownloadIds) {
				for (const downloadId of sessionDownloadIds) {
					downloads.delete(downloadId)
				}
				sessionDownloads.delete(sessionId)
			}
			yield* Effect.logInfo(`Cleared downloads for session: ${sessionId}`)
		})

	const setDownloadPath = (
		downloadPath: string,
		sessionId: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			// Ensure download directory exists
			if (!fs.existsSync(downloadPath)) {
				fs.mkdirSync(downloadPath, { recursive: true })
			}

			yield* cdp.send('Page.setDownloadBehavior', {
				behavior: 'allow',
				downloadPath: downloadPath
			}, sessionId).pipe(
				Effect.mapError((error) =>
					new BrowserSessionError({
						message: `Failed to set download path: ${downloadPath}`,
						sessionId,
						cause: error
					})
				)
			)

			yield* Effect.logInfo(`Download path set: ${downloadPath}`)
		})

	const getFileInfo = (
		filePath: string
	): Effect.Effect<{
		readonly exists: boolean
		readonly size: number
		readonly mimeType: string
		readonly lastModified: number
	}, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				if (!fs.existsSync(filePath)) {
					return {
						exists: false,
						size: 0,
						mimeType: '',
						lastModified: 0
					}
				}

				const stats = fs.statSync(filePath)
				const extension = path.extname(filePath).toLowerCase()
				
				// Simple MIME type detection
				const mimeTypes: Record<string, string> = {
					'.pdf': 'application/pdf',
					'.txt': 'text/plain',
					'.html': 'text/html',
					'.css': 'text/css',
					'.js': 'application/javascript',
					'.json': 'application/json',
					'.png': 'image/png',
					'.jpg': 'image/jpeg',
					'.jpeg': 'image/jpeg',
					'.gif': 'image/gif',
					'.mp4': 'video/mp4',
					'.zip': 'application/zip'
				}

				return {
					exists: true,
					size: stats.size,
					mimeType: mimeTypes[extension] || 'application/octet-stream',
					lastModified: stats.mtime.getTime()
				}

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Failed to get file info: ${filePath}`,
					cause: error
				}))
			}
		})

	const deleteFile = (
		filePath: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				if (fs.existsSync(filePath)) {
					fs.unlinkSync(filePath)
					yield* Effect.logInfo(`File deleted: ${filePath}`)
				}
			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Failed to delete file: ${filePath}`,
					cause: error
				}))
			}
		})

	const moveFile = (
		sourcePath: string,
		targetPath: string
	): Effect.Effect<void, BrowserSessionError> =>
		Effect.gen(function* () {
			try {
				if (!fs.existsSync(sourcePath)) {
					yield* Effect.fail(new BrowserSessionError({
						message: `Source file not found: ${sourcePath}`
					}))
				}

				// Ensure target directory exists
				const targetDir = path.dirname(targetPath)
				if (!fs.existsSync(targetDir)) {
					fs.mkdirSync(targetDir, { recursive: true })
				}

				fs.renameSync(sourcePath, targetPath)
				yield* Effect.logInfo(`File moved: ${sourcePath} -> ${targetPath}`)

			} catch (error) {
				yield* Effect.fail(new BrowserSessionError({
					message: `Failed to move file: ${sourcePath} -> ${targetPath}`,
					cause: error
				}))
			}
		})

	return {
		downloadFile,
		uploadFile,
		waitForDownload,
		cancelDownload,
		getDownloads,
		clearDownloads,
		setDownloadPath,
		getFileInfo,
		deleteFile,
		moveFile
	} satisfies FileManagementServiceInterface
})

/**
 * File management service layer
 */
export const FileManagementServiceLive = Layer.effect(FileManagementService, makeFileManagementService)