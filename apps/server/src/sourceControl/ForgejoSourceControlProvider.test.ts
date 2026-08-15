import { assert, describe, it } from "@effect/vitest";
import { ChildProcessSpawner } from "effect/unstable/process";

import { discovery, parseForgejoAuthHosts } from "./ForgejoSourceControlProvider.ts";

const authOutput = ["pat-s@codeberg.org", "pat-s@git.example.org"].join("\n");
// fj 0.6 drops the `account@` prefix and prints the bare instance host.
const bareAuthOutput = ["git-ssh.example.org:2222", "git.example.org"].join("\n");

describe("Forgejo discovery", () => {
  it("parses `fj auth list` user@host lines", () => {
    assert.deepStrictEqual(parseForgejoAuthHosts(authOutput), [
      { account: "pat-s", host: "codeberg.org" },
      { account: "pat-s", host: "git.example.org" },
    ]);
  });

  it("parses bare `fj auth list` host lines", () => {
    assert.deepStrictEqual(parseForgejoAuthHosts(bareAuthOutput), [
      { host: "git-ssh.example.org:2222" },
      { host: "git.example.org" },
    ]);
  });

  it("ignores output that does not name a host", () => {
    assert.deepStrictEqual(parseForgejoAuthHosts("You are not logged into any instances"), []);
    assert.deepStrictEqual(parseForgejoAuthHosts("none"), []);
  });

  it("reports authenticated status from bare host output", () => {
    const auth = discovery.parseAuth({
      stdout: bareAuthOutput,
      stderr: "",
      exitCode: ChildProcessSpawner.ExitCode(0),
    });
    assert.strictEqual(auth.status, "authenticated");
  });

  it("refines an unknown remote from bare host output", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.example.org", baseUrl: "https://git.example.org" },
        remoteName: "origin",
        remoteUrl: "git@git.example.org:owner/repo.git",
      },
      auth: { stdout: bareAuthOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.org",
    });
  });

  it("refines an unknown remote whose host is logged in", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.example.org", baseUrl: "https://git.example.org" },
        remoteName: "origin",
        remoteUrl: "git@git.example.org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.org",
    });
  });

  it("refines an unknown remote whose host differs only in case", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "Git.Example.Org", baseUrl: "https://Git.Example.Org" },
        remoteName: "origin",
        remoteUrl: "git@Git.Example.Org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://Git.Example.Org",
    });
  });

  it("refines a remote whose host carries a port not present in the login store", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: {
          kind: "unknown",
          name: "git.example.org:3000",
          baseUrl: "https://git.example.org:3000",
        },
        remoteName: "origin",
        remoteUrl: "https://git.example.org:3000/owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.org:3000",
    });
  });

  it("does not refine a host that is not logged in", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.other.org", baseUrl: "https://git.other.org" },
        remoteName: "origin",
        remoteUrl: "git@git.other.org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.strictEqual(refined, null);
  });

  it("reports authenticated status from auth output", () => {
    const auth = discovery.parseAuth({
      stdout: authOutput,
      stderr: "",
      exitCode: ChildProcessSpawner.ExitCode(0),
    });
    assert.strictEqual(auth.status, "authenticated");
  });
});
