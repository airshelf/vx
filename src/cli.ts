#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";
import { registerLs } from "./commands/ls.ts";
import { registerLogs } from "./commands/logs.ts";
import { registerEnv } from "./commands/env.ts";
import { registerDomains } from "./commands/domains.ts";

const program = new Command();

program
  .name("vx")
  .version(pkg.version)
  .description("Fast Vercel CLI");

registerLs(program);
registerLogs(program);
registerEnv(program);
registerDomains(program);

program.parse();
