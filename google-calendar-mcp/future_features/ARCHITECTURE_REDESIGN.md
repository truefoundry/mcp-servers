# Architecture Redesign Plan

## Status: Phase 1 Complete ✅

**Completed Phases:**
- ✅ Phase 1: Basic Migration & Structure Setup (Test reorganization, auto-registration, OAuth improvements)

**Next Phase:**
- 🔄 Phase 2: Add Context Awareness (Ready to implement)

## Goals
1. Make existing tools smarter (context-aware, duplicate detection, pattern recognition)
2. Easy cross-tool enhancement without code duplication
3. Maintain simple contribution path

## Complete Project Structure

```
src/
├── handlers/
│   ├── core/                    # Existing handlers (minimal changes)
│   ├── behaviors/               # NEW: Reusable intelligent behaviors
│   │   ├── ContextAware.ts      # Auto-inject timezone/date
│   │   ├── DuplicateDetection.ts # Smart duplicate checking
│   │   ├── PatternRecognition.ts # Identify routine patterns
│   │   └── SmartDefaults.ts     # Intelligent defaults
│   ├── intelligence/            # NEW: Analysis capabilities
│   │   ├── EventAnalyzer.ts     # Pattern analysis
│   │   ├── ScheduleInsights.ts  # Calendar insights
│   │   └── ConflictResolver.ts  # Smart scheduling
│   └── utils/                   # Existing utilities (keep as-is)
├── tools/
│   ├── registry.ts              # NEW: Auto-registration with behaviors
│   └── definitions.ts           # DEPRECATED: Remove after migration
├── config/
│   ├── tool-enhancements.ts     # NEW: Configure which tools get which behaviors
│   └── TransportConfig.ts       # Existing (keep as-is)
├── tests/                       # NEW: Centralized test location
│   ├── unit/
│   │   ├── handlers/            # Move from src/handlers/core/*.test.ts
│   │   ├── behaviors/           # NEW: Test behaviors
│   │   └── intelligence/        # NEW: Test intelligence features
│   ├── integration/             # Move from src/integration/
│   └── schemas/                 # Move from src/schemas/*.test.ts
├── auth/                        # Existing (keep as-is)
├── schemas/                     # Existing (keep as-is)
├── transports/                  # Existing (keep as-is)
├── server.ts                    # UPDATE: Use new registry
└── index.ts                     # Existing (keep as-is)

# Root level changes
├── scripts/                     # Existing (keep as-is)
├── docs/                        # UPDATE: Add behavior development guide
├── examples/                    # UPDATE: Add behavior examples
├── package.json                 # UPDATE: Add new test scripts
├── vitest.config.ts             # UPDATE: New test file locations
└── tsconfig.json                # UPDATE: Path mappings if needed
```

## Auto-Registration System

**Tool Enhancement Configuration:**
```typescript
// config/tool-enhancements.ts
export const toolEnhancements = {
  'create-event': [ContextAware, DuplicateDetection, SmartDefaults],
  'list-events': [ContextAware, PatternRecognition],
  'update-event': [ContextAware, DuplicateDetection, ConflictResolver],
  'search-events': [ContextAware, PatternRecognition]
};
```

**Auto-Discovery Registry:**
```typescript
// tools/registry.ts
export class ToolRegistry {
  static async registerAll(server: McpServer) {
    const handlers = await this.discoverHandlers();
    
    for (const [name, HandlerClass] of handlers) {
      const enhancements = toolEnhancements[name] || [];
      const enhancedHandler = this.applyEnhancements(HandlerClass, enhancements);
      
      server.tool(name, enhancedHandler.description, enhancedHandler.schema, 
        (args) => executeWithHandler(enhancedHandler, args)
      );
    }
  }
}
```

**Behavior Pattern:**
```typescript
// behaviors/ContextAware.ts
export class ContextAwareBehavior {
  async enhance(args: any): Promise<any> {
    return {
      ...args,
      _context: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currentDate: new Date().toISOString(),
        locale: process.env.LANG || 'en-US'
      }
    };
  }
}
```

**Handler Integration:**
```typescript
// Handlers remain simple - behaviors are applied automatically
export class CreateEventHandler extends BaseToolHandler {
  name = 'create-event';
  description = 'Create a new calendar event';
  
  async runTool(args: any, oauth2Client: OAuth2Client) {
    // args automatically enhanced by configured behaviors
    const context = args._context; // Added by ContextAware
    const isLikelyDuplicate = args._duplicateCheck; // Added by DuplicateDetection
    
    // Core logic remains clean
  }
}
```

## Key Benefits

- **Zero Handler Changes**: Existing handlers work unchanged
- **Configurable Enhancement**: Easy to add/remove behaviors per tool
- **Shared Intelligence**: Behaviors work across all tools
- **Type Safety**: Full TypeScript support with automatic discovery
- **Gradual Migration**: Can be implemented incrementally

## Implementation Checklist

### Phase 1: Basic Migration & Structure Setup ✅ COMPLETED
**Setup:**`
- [x] Create `src/tests/` directory structure
- [x] Update `vitest.config.ts` for new test locations
- [x] Update `package.json` with new test scripts
- [x] Create `src/tools/registry.ts` for auto-registration

**Test Migration:**
- [x] Move `src/handlers/core/*.test.ts` to `src/tests/unit/handlers/`
- [x] Move `src/integration/*.test.ts` to `src/tests/integration/`
- [x] Move `src/schemas/*.test.ts` to `src/tests/unit/schemas/`
- [x] Update all test imports to use new locations

**Auto-Registration (No Behaviors Yet):**
- [x] Build basic auto-registration system in `tools/registry.ts`
- [x] Update `server.ts` to use new registry instead of `definitions.ts`
- [x] Test that all existing tools work exactly as before

**Token Management Improvements:**
- [x] Fix OAuth client to always use real credentials (no more mock clients)
- [x] Unify token path handling across all scripts
- [x] Create shared path utilities (`src/auth/paths.js`)
- [x] Remove unnecessary `RUN_INTEGRATION_TESTS` environment variable
- [x] Add clear documentation to integration test files

**Validation Check:**
- [x] Run `npm test` - all tests pass in new locations (154 unit tests ✅)
- [x] Run `npm run build` - project builds successfully  
- [x] Test all existing tools - functionality identical to before
- [x] Run `npm run test:integration:direct` - integration tests work (14 tests ✅)
- [x] Verify MCP server starts and registers all tools correctly
- [x] Update GitHub CI workflow for new test paths

### Phase 2: Add Context Awareness
**Behavior Foundation:**
- [ ] Create `src/handlers/behaviors/` directory
- [ ] Create `src/config/` directory
- [ ] Create base behavior interface/class
- [ ] Create `src/config/tool-enhancements.ts` configuration

**Context Awareness Implementation:**
- [ ] Implement `ContextAwareBehavior` class
- [ ] Add ContextAware to tool enhancements config for 2-3 tools initially
- [ ] Update registry to apply behaviors to configured tools
- [ ] Create tests in `src/tests/unit/behaviors/`

**Integration:**
- [ ] Test context injection (timezone, current date) on selected tools
- [ ] Verify context is available in handler args
- [ ] Add comprehensive tests for context behavior

**Validation Check:**
- [ ] Run `npm test` - all tests pass
- [ ] Run `npm run build` - project builds successfully
- [ ] Test tools with context awareness - enhanced with timezone/date info
- [ ] Test tools without context awareness - unchanged behavior
- [ ] Verify no performance regression

### Phase 3: Additional Core Behaviors
**Behavior Implementation:**
- [ ] Implement `DuplicateDetectionBehavior`
- [ ] Implement `SmartDefaultsBehavior`
- [ ] Add these behaviors to tool enhancements config
- [ ] Create comprehensive tests for each behavior

**Integration:**
- [ ] Test duplicate detection across different tools
- [ ] Test smart defaults with context awareness
- [ ] Verify behaviors work together without conflicts

**Validation Check:**
- [ ] Run full test suite `npm run test:all`
- [ ] Test duplicate detection with real calendar scenarios
- [ ] Test smart defaults with various contexts
- [ ] Verify behaviors enhance tools without breaking existing functionality
- [ ] Performance test - ensure no significant slowdown

### Phase 4: Intelligence Layer (Future Enhancement)
**Intelligence Implementation:**
- [ ] Create `src/handlers/intelligence/` directory
- [ ] Implement `EventAnalyzer` for pattern recognition
- [ ] Implement `ScheduleInsights` for calendar analysis  
- [ ] Implement `ConflictResolver` for smart scheduling
- [ ] Add `PatternRecognitionBehavior` that uses `EventAnalyzer`
- [ ] Create comprehensive tests in `src/tests/unit/intelligence/`

**Integration:**
- [ ] Configure intelligence behaviors for appropriate tools
- [ ] Test cross-tool intelligence sharing
- [ ] Add integration tests for intelligent features

**Validation Check:**
- [ ] Run full test suite `npm run test:all`
- [ ] Test pattern recognition with real calendar data
- [ ] Test advanced scheduling intelligence
- [ ] Performance test - ensure no significant slowdown

### Phase 5: Documentation & Examples
**Documentation Updates:**
- [ ] Update `CLAUDE.md` with new architecture details
- [ ] Create `docs/contributing/behavior-development.md`
- [ ] Update `docs/development.md` with new test structure
- [ ] Update `docs/architecture.md` with behavior system

**Examples & Templates:**
- [ ] Add `examples/custom-behaviors/` with sample implementations
- [ ] Create behavior template in `templates/behavior-template/`
- [ ] Add intelligence feature examples
- [ ] Update existing examples to show enhanced capabilities

**Validation Check:**
- [ ] Documentation builds and renders correctly
- [ ] Follow examples manually - they work as described
- [ ] Run `npm run dev validate-schemas` - all schemas valid
- [ ] Verify all links and references are correct

### Phase 6: Cleanup & Migration Complete
**File Cleanup:**
- [ ] Remove deprecated `src/tools/definitions.ts`
- [ ] Remove old test files from original locations
- [ ] Clean up unused imports across the codebase
- [ ] Remove any temporary migration code

**Final Configuration:**
- [x] Update `.github/workflows/ci.yml` if test paths changed
- [ ] Update any build scripts that reference old paths
- [ ] Ensure all environment configurations work
- [ ] Update Docker files if they reference test paths

**Final Validation:**
- [ ] Run complete test suite `npm run test:all`
- [ ] Run `npm run lint` and `npm run typecheck`
- [ ] Test full authentication flow `npm run auth`
- [ ] Test both stdio and HTTP transports
- [ ] Performance test - no regression in response times
- [ ] Integration test with actual Claude Desktop
- [ ] Test in CI environment

**Release:**
- [ ] Update version in `package.json`
- [ ] Create comprehensive changelog
- [ ] Tag new version in git
- [ ] Update npm package if published

## File-Specific Updates

### `vitest.config.ts` ✅ IMPLEMENTED
```typescript
export default defineConfig({
  test: {
    include: [
      'src/tests/unit/**/*.test.ts',
      'src/tests/integration/**/*.test.ts'
    ],
    exclude: ['src/tests/integration/**/*.test.ts'], // if excluding by default
  }
});
```

### `package.json` Scripts ✅ IMPLEMENTED
```json
{
  "scripts": {
    "test": "vitest run src/tests/unit",
    "test:integration": "vitest run src/tests/integration", 
    "test:behaviors": "vitest run src/tests/unit/behaviors",     // Future
    "test:intelligence": "vitest run src/tests/unit/intelligence", // Future
    "test:all": "vitest run src/tests"
  }
}
```

### `tsconfig.json` (if needed)
```json
{
  "compilerOptions": {
    "paths": {
      "@/handlers/*": ["src/handlers/*"],
      "@/behaviors/*": ["src/handlers/behaviors/*"],
      "@/intelligence/*": ["src/handlers/intelligence/*"],
      "@/tests/*": ["src/tests/*"]
    }
  }
}
```

## Migration Risk: Low
- Existing handlers require no changes
- New system can run alongside old system
- Easy rollback if issues arise
- Incremental implementation possible