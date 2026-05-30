import {
  getNodebox,
  getActiveNodebox,
  teardownNodebox,
  getNodeVersion,
  runNodeboxShellCommand,
  spawnProcess as spawnNodeboxProcess,
  type NodeboxProcess,
} from "@/runtimes/webcontainer/boot";
import type {
  SandboxFs,
  SandboxFsStat,
  SandboxProcess,
  SandboxRuntime,
  SpawnPtySize,
} from "@/runtimes/types";

function wrapNodeboxProcess(process: NodeboxProcess): SandboxProcess {
  return {
    exit: process.exit,
    onData: (cb) => process.onData(cb),
    write: (data) => process.write(data),
    kill: () => process.kill(),
    resize: (dims: SpawnPtySize) => process.resize(dims),
  };
}

async function createNodeboxFs(): Promise<SandboxFs> {
  const emulator = await getNodebox();
  return {
    async mkdir(path, options) {
      await emulator.fs.mkdir(path, options);
    },
    async writeFile(path, contents) {
      await emulator.fs.writeFile(path, contents);
    },
    async readFile(path) {
      return emulator.fs.readFile(path);
    },
    async readdir(path) {
      return emulator.fs.readdir(path);
    },
    async rm(path, options) {
      await emulator.fs.rm(path, options);
    },
    async stat(path): Promise<SandboxFsStat> {
      const stat = await emulator.fs.stat(path);
      return { type: stat.type === "dir" ? "dir" : "file" };
    },
  };
}

export const nodeboxRuntime: SandboxRuntime = {
  kind: "nodebox",
  async boot() {
    await getNodebox();
  },
  async teardown() {
    await teardownNodebox();
  },
  getActive() {
    return getActiveNodebox();
  },
  getFs: createNodeboxFs,
  getNodeVersion,
  runShellCommand(command, args, options) {
    return runNodeboxShellCommand(command, args, options);
  },
  async spawnProcess(command, args, options) {
    const process = await spawnNodeboxProcess(command, args, options);
    return wrapNodeboxProcess(process);
  },
};
