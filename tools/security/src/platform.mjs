// Which platform key (tools.json) this machine is, or why it is unsupported.
// Supported: glibc Linux and macOS, x64 and arm64 (docs/security.md).

export const SUPPORTED_PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
];

/** Exit code meaning "checks were NOT run" (never "passed"). */
export const EXIT_NOT_RUN = 2;

function glibcVersion() {
  // Present on glibc Linux, absent on musl (Alpine).
  return process.report?.getReport?.().header?.glibcVersionRuntime;
}

/**
 * @returns {{ key: string } | { unsupported: string }}
 */
export function detectPlatform(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  // An explicit `glibc: undefined` means "no glibc" (musl); only detect when omitted.
  const glibc =
    'glibc' in options
      ? options.glibc
      : platform === 'linux'
        ? glibcVersion()
        : undefined;
  const key = `${platform}-${arch}`;
  if (platform === 'win32') {
    return {
      unsupported: `${key}: native Windows is not supported; use WSL2.`,
    };
  }
  if (platform === 'linux' && !glibc) {
    return {
      unsupported: `${key}-musl: only glibc Linux is supported (Alpine/musl is not).`,
    };
  }
  if (!SUPPORTED_PLATFORMS.includes(key)) {
    return { unsupported: `${key}.` };
  }
  return { key };
}

export function unsupportedMessage(reason) {
  return `UNSUPPORTED PLATFORM ${reason} Security checks were NOT run. CI is authoritative. Supported: ${SUPPORTED_PLATFORMS.join(', ')}.`;
}
