import type { Command } from "commander";

export function removeCommandByName(program: Command, name: string): boolean {
  const command = program.commands.find(
    (candidate) => candidate.name() === name || candidate.aliases().includes(name),
  );
  if (!command) {
    return false;
  }
  const index = program.commands.indexOf(command);
  if (index < 0) {
    return false;
  }
  Array.prototype.splice.call(program.commands, index, 1);
  return true;
}
