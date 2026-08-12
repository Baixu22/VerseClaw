import { describe, expect, it } from "vitest";
import {
  isLinuxDockerDaemonFromWindows,
  resolveDockerBindSourcePath,
  windowsPathToWslMountPath,
} from "./wsl-path.js";

describe("windowsPathToWslMountPath", () => {
  it("converts a Windows drive path to the WSL2 /mnt mount namespace", () => {
    expect(windowsPathToWslMountPath("C:\\Users\\27933\\.openclaw\\workspace")).toBe(
      "/mnt/c/Users/27933/.openclaw/workspace",
    );
    expect(windowsPathToWslMountPath("C:/repo")).toBe("/mnt/c/repo");
  });

  it("lowercases the drive letter and preserves the remaining casing", () => {
    expect(windowsPathToWslMountPath("D:\\Projects\\JForum\\src")).toBe(
      "/mnt/d/Projects/JForum/src",
    );
  });

  it("maps a drive root to a trailing-slash-free /mnt root", () => {
    expect(windowsPathToWslMountPath("C:\\")).toBe("/mnt/c");
    expect(windowsPathToWslMountPath("C:/")).toBe("/mnt/c");
  });

  it("strips the \\\\wsl$\\<distro>\\ prefix from WSL share paths", () => {
    expect(
      windowsPathToWslMountPath("\\\\wsl$\\Ubuntu-22.04\\home\\sandbox\\workspace"),
    ).toBe("/home/sandbox/workspace");
    expect(windowsPathToWslMountPath("\\\\wsl$\\Ubuntu-22.04\\home\\sandbox")).toBe(
      "/home/sandbox",
    );
  });

  it("leaves POSIX paths unchanged", () => {
    expect(windowsPathToWslMountPath("/home/user/project")).toBe("/home/user/project");
  });
});

describe("isLinuxDockerDaemonFromWindows", () => {
  it("is false on non-Windows platforms", () => {
    expect(
      isLinuxDockerDaemonFromWindows({
        platform: "linux",
        env: { DOCKER_HOST: "tcp://127.0.0.1:2375" },
      }),
    ).toBe(false);
  });

  it("is false when no DOCKER_HOST override exists (local Windows daemon)", () => {
    expect(
      isLinuxDockerDaemonFromWindows({ platform: "win32", env: {} }),
    ).toBe(false);
  });

  it("is false for the local named-pipe DOCKER_HOST", () => {
    expect(
      isLinuxDockerDaemonFromWindows({
        platform: "win32",
        env: { DOCKER_HOST: "npipe:////./pipe/docker_engine" },
      }),
    ).toBe(false);
  });

  it("is true for a TCP DOCKER_HOST (WSL2/remote Linux daemon)", () => {
    expect(
      isLinuxDockerDaemonFromWindows({
        platform: "win32",
        env: { DOCKER_HOST: "tcp://127.0.0.1:2375" },
      }),
    ).toBe(true);
  });
});

describe("resolveDockerBindSourcePath", () => {
  it("translates Windows paths only when the client is Windows and the daemon is Linux", () => {
    const win32LinuxDaemon = {
      platform: "win32" as const,
      env: { DOCKER_HOST: "tcp://127.0.0.1:2375" },
    };
    expect(
      resolveDockerBindSourcePath("C:\\Users\\27933\\.openclaw\\workspace", win32LinuxDaemon),
    ).toBe("/mnt/c/Users/27933/.openclaw/workspace");
  });

  it("passes Windows paths through for the local Windows daemon", () => {
    expect(
      resolveDockerBindSourcePath("C:\\Users\\27933\\.openclaw\\workspace", {
        platform: "win32",
        env: { DOCKER_HOST: "npipe:////./pipe/docker_engine" },
      }),
    ).toBe("C:\\Users\\27933\\.openclaw\\workspace");
  });

  it("passes POSIX paths through untouched on Linux", () => {
    expect(
      resolveDockerBindSourcePath("/home/user/project", {
        platform: "linux",
        env: {},
      }),
    ).toBe("/home/user/project");
  });
});
