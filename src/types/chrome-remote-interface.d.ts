/**
 * @fileoverview Type declarations for chrome-remote-interface
 */

declare module 'chrome-remote-interface' {
  interface CDPOptions {
    host?: string
    port?: number
    secure?: boolean
    useHostName?: boolean
    alterPath?: (path: string) => string
    protocol?: string
    target?: string | ((targets: any[]) => any)
  }

  interface CDPClient {
    send(method: string, params?: Record<string, unknown>): Promise<any>
    close(): Promise<void>
    on(event: string, callback: (...args: any[]) => void): void
    off(event: string, callback: (...args: any[]) => void): void
  }

  function CDP(options?: CDPOptions): Promise<CDPClient>

  export = CDP
}