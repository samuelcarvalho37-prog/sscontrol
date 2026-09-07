import packageMetadata from '../package.json'

export const APP_RELEASE_VERSION = String(packageMetadata.version)

export function isCompatibleRelease(receivedVersion?: string): boolean {
  return Boolean(receivedVersion && receivedVersion === APP_RELEASE_VERSION)
}
