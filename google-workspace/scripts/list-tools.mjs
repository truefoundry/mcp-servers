#!/usr/bin/env node
// List all tool definitions, grouped by service, showing annotations.
// Usage: node scripts/list-tools.mjs
import { SERVICES, SERVICE_KEYS } from '../dist/index.js';

let total = 0;
for (const key of SERVICE_KEYS) {
  const svc = SERVICES[key];
  console.log(`\n=== ${svc.displayName} (${key}) — ${svc.toolDefinitions.length} tools ===`);
  for (const t of svc.toolDefinitions) {
    const a = t.annotations ?? {};
    const flags = [];
    if (a.destructiveHint) flags.push('D');
    if (a.readOnlyHint) flags.push('R');
    if (a.idempotentHint) flags.push('I');
    if (a.openWorldHint) flags.push('O');
    console.log(`  [${flags.join('')}]  ${t.name}`);
  }
  total += svc.toolDefinitions.length;
}
console.log(`\nTotal tools: ${total}`);
