export interface ShellInvocation {
  readonly shell: "powershell" | "bash";
  readonly argv: readonly string[];
}

export function createShellInvocation(command: string, platform: NodeJS.Platform = process.platform): ShellInvocation {
  if (platform === "win32") {
    return { shell: "powershell", argv: ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] };
  }
  return { shell: "bash", argv: ["bash", "-c", command] };
}
