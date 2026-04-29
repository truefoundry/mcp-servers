/**
 * MCP server factory.
 *
 * v0.2 exposes 10 tools, all generic primitives that work against any Salesforce
 * SObject (standard or custom) without per-object boilerplate:
 *
 *   Read:   run_soql_query, run_sosl_search, get_record, list_sobjects, describe_object
 *   Write:  create_record, update_record, upsert_by_external_id, delete_record
 *   Power:  run_apex_anonymous
 *
 * Auth flows through AsyncLocalStorage (see `auth-ctx.ts`) - tools call
 * `getConnection()` which reads the per-request `{accessToken, instanceUrl}`
 * pair, so handler signatures stay clean.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';

import { getConnection } from './auth/get-connection.js';
import { log } from './auth-ctx.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
export const VERSION = packageJson.version;

// ---------------------------------------------------------------------------
// Zod input schemas
// ---------------------------------------------------------------------------

const runSoqlQuerySchema = z.object({
  query: z.string(),
  useToolingApi: z.boolean().optional(),
});

const runSoslSearchSchema = z.object({
  search: z.string(),
});

const getRecordSchema = z.object({
  sobject_name: z.string(),
  id: z.string(),
  fields: z.array(z.string()).optional(),
});

const listSobjectsSchema = z.object({
  customOnly: z.boolean().optional(),
});

const describeObjectSchema = z.object({
  sobject_name: z.string(),
});

const createRecordSchema = z.object({
  sobject_name: z.string(),
  fields: z.record(z.unknown()),
});

const updateRecordSchema = z.object({
  sobject_name: z.string(),
  id: z.string(),
  fields: z.record(z.unknown()),
});

const upsertByExternalIdSchema = z.object({
  sobject_name: z.string(),
  external_id_field: z.string(),
  record: z.record(z.unknown()),
});

const deleteRecordSchema = z.object({
  sobject_name: z.string(),
  id: z.string(),
});

const runApexAnonymousSchema = z.object({
  apex: z.string(),
});

// ---------------------------------------------------------------------------
// Tool definitions (advertised via tools/list)
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'run_soql_query',
    description:
      "Run a SOQL query against the caller's Salesforce org. " +
      'The org and identity are taken from the OAuth bearer token automatically; ' +
      'do not ask the user for a username. Use the Tooling API only for metadata ' +
      'objects (ApexClass, CustomField, Flow, etc.). Results are paginated up to ' +
      '~2000 rows; check `done` and `nextRecordsUrl`. ALIAS SYNTAX: SOQL does NOT ' +
      "support 'AS'. Use implicit aliases: 'SUM(Amount) TotalSales' not 'SUM(Amount) AS TotalSales'.",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SOQL query, e.g. "SELECT Id, Name FROM Account LIMIT 5".',
        },
        useToolingApi: {
          type: 'boolean',
          description:
            'Run against the Tooling API instead of the standard REST API. Default false. ' +
            'Required for ApexClass, ApexTrigger, CustomField, Flow, etc.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { title: 'Run SOQL Query', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'run_sosl_search',
    description:
      'Run a SOSL search across multiple SObjects. Useful for full-text "find anything ' +
      'matching X" queries that span objects. For single-object filtered queries prefer SOQL.',
    inputSchema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description:
            'SOSL search expression. Example: ' +
            '"FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Email, AccountId), Lead(Id, Name)". ' +
            'The {} braces around the search term are required.',
        },
      },
      required: ['search'],
      additionalProperties: false,
    },
    annotations: { title: 'Run SOSL Search', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_record',
    description:
      'Retrieve a single Salesforce record by Id. Cleaner than SOQL when you already ' +
      'know the Id and want all (or a subset of) fields. Returns the full record object.',
    inputSchema: {
      type: 'object',
      properties: {
        sobject_name: {
          type: 'string',
          description: 'API name of the SObject (e.g. "Account", "Opportunity", "MyCustom__c").',
        },
        id: {
          type: 'string',
          description: '15- or 18-character Salesforce record Id.',
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific fields to retrieve (API names). Omit to retrieve every field on the record.',
        },
      },
      required: ['sobject_name', 'id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get Record', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_sobjects',
    description:
      'List all SObjects (standard + custom) available in the org. Use to discover what ' +
      'objects exist before calling describe_object or building a SOQL query. Returns ' +
      'API name, label, and capability flags (queryable, createable, etc.) per object.',
    inputSchema: {
      type: 'object',
      properties: {
        customOnly: {
          type: 'boolean',
          description:
            'If true, return only custom objects (API names ending in "__c"). Default false.',
        },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List SObjects', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'describe_object',
    description:
      'Describe a single SObject: returns the full list of fields with their types, ' +
      'picklist values, reference targets, and whether each is filterable / sortable / ' +
      'createable / updateable. Use this BEFORE writing a SOQL query against an unfamiliar ' +
      'object so you know the exact API field names.',
    inputSchema: {
      type: 'object',
      properties: {
        sobject_name: {
          type: 'string',
          description: 'API name of the SObject to describe.',
        },
      },
      required: ['sobject_name'],
      additionalProperties: false,
    },
    annotations: { title: 'Describe SObject', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'create_record',
    description:
      'Create a new Salesforce record. Works for any SObject (standard or custom). ' +
      'Field keys must be exact Salesforce API names (case-sensitive, custom fields end in "__c"). ' +
      'Reference fields require Salesforce Ids, not names. Returns the new record Id and ' +
      'success status. Org-level validation rules / required-field constraints can reject ' +
      'syntactically valid requests; inspect the error to find the failing field.',
    inputSchema: {
      type: 'object',
      properties: {
        sobject_name: {
          type: 'string',
          description: 'API name of the SObject to create (e.g. "Account", "Opportunity").',
        },
        fields: {
          type: 'object',
          description:
            'Field values for the new record. Use Salesforce API field names. ' +
            'Example for Account: {"Name": "Acme Inc", "Industry": "Technology"}.',
          additionalProperties: true,
        },
      },
      required: ['sobject_name', 'fields'],
      additionalProperties: false,
    },
    annotations: { title: 'Create Record', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'update_record',
    description:
      'Update an existing Salesforce record by Id. Only the fields you provide are changed; ' +
      'all other fields are left as-is. Returns success status. Use describe_object first if ' +
      'you are unsure which fields are updateable.',
    inputSchema: {
      type: 'object',
      properties: {
        sobject_name: { type: 'string', description: 'API name of the SObject.' },
        id: { type: 'string', description: '15- or 18-character Salesforce record Id.' },
        fields: {
          type: 'object',
          description: 'Fields to update with their new values, keyed by API field name.',
          additionalProperties: true,
        },
      },
      required: ['sobject_name', 'id', 'fields'],
      additionalProperties: false,
    },
    annotations: { title: 'Update Record', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'upsert_by_external_id',
    description:
      'Insert or update a record by matching on a custom External Id field rather than ' +
      "the Salesforce Id. Useful for syncing from external systems where you don't track " +
      'Salesforce Ids. The external_id_field must be configured as "External Id" in the ' +
      'object\'s field metadata. Returns whether the record was created or updated.',
    inputSchema: {
      type: 'object',
      properties: {
        sobject_name: { type: 'string', description: 'API name of the SObject.' },
        external_id_field: {
          type: 'string',
          description:
            'API name of the External Id field (e.g. "Stripe_Customer_Id__c"). The field must ' +
            'have External Id checked in its metadata or upsert will fail.',
        },
        record: {
          type: 'object',
          description:
            'Record fields including the external id field value. Example: ' +
            '{"Stripe_Customer_Id__c": "cus_abc123", "Name": "Acme", "Industry": "Tech"}.',
          additionalProperties: true,
        },
      },
      required: ['sobject_name', 'external_id_field', 'record'],
      additionalProperties: false,
    },
    annotations: { title: 'Upsert by External Id', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'delete_record',
    description:
      'Delete a Salesforce record by Id (moves it to the Recycle Bin per org retention ' +
      'policy). Permanent erasure requires a separate operation. Master-detail children ' +
      'cascade-delete; lookup references may prevent deletion.',
    inputSchema: {
      type: 'object',
      properties: {
        sobject_name: { type: 'string', description: 'API name of the SObject.' },
        id: { type: 'string', description: '15- or 18-character Salesforce record Id.' },
      },
      required: ['sobject_name', 'id'],
      additionalProperties: false,
    },
    annotations: { title: 'Delete Record', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'run_apex_anonymous',
    description:
      'Execute anonymous Apex code in the org via the Tooling API. The escape hatch when ' +
      'SOQL/CRUD aren\'t enough - lets the agent write small Apex snippets for ad-hoc ops. ' +
      'Returns compile and execution status; use System.debug() for output (captured in ' +
      'the response when execution succeeds). Runs synchronously and is bound by the same ' +
      'Apex governor limits as a regular transaction.',
    inputSchema: {
      type: 'object',
      properties: {
        apex: {
          type: 'string',
          description:
            'Apex code to execute. Has full access to the org\'s data model and SOQL. ' +
            'Example: "List<Account> accs = [SELECT Id, Name FROM Account LIMIT 5]; System.debug(accs);"',
        },
      },
      required: ['apex'],
      additionalProperties: false,
    },
    annotations: { title: 'Run Anonymous Apex', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
];

// ---------------------------------------------------------------------------
// Handler helpers
// ---------------------------------------------------------------------------

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

/**
 * Wrap a typed handler with: arg validation, error formatting, and consistent
 * JSON serialization. Each per-tool handler stays a one-liner over jsforce.
 */
function makeHandler<Schema extends z.ZodTypeAny>(
  schema: Schema,
  fn: (args: z.infer<Schema>) => Promise<unknown>,
): (args: unknown) => Promise<CallToolResult> {
  return async (args) => {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
      return textResult(`Invalid arguments: ${parsed.error.message}`, true);
    }
    try {
      const result = await fn(parsed.data);
      return jsonResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return textResult(`Failed: ${message}`, true);
    }
  };
}

// ---------------------------------------------------------------------------
// Per-tool handlers
// ---------------------------------------------------------------------------

const handleRunSoqlQuery = makeHandler(runSoqlQuerySchema, async ({ query, useToolingApi }) => {
  const conn = getConnection();
  return useToolingApi ? conn.tooling.query(query) : conn.query(query);
});

const handleRunSoslSearch = makeHandler(runSoslSearchSchema, async ({ search }) => {
  return getConnection().search(search);
});

const handleGetRecord = makeHandler(getRecordSchema, async ({ sobject_name, id, fields }) => {
  const conn = getConnection();
  return fields && fields.length > 0
    ? conn.sobject(sobject_name).retrieve(id, { fields })
    : conn.sobject(sobject_name).retrieve(id);
});

const handleListSobjects = makeHandler(listSobjectsSchema, async ({ customOnly }) => {
  const result = await getConnection().describeGlobal();
  const filtered = customOnly ? result.sobjects.filter((s) => s.custom) : result.sobjects;
  return filtered.map((s) => ({
    name: s.name,
    label: s.label,
    custom: s.custom,
    queryable: s.queryable,
    createable: s.createable,
    updateable: s.updateable,
    deletable: s.deletable,
  }));
});

const handleDescribeObject = makeHandler(describeObjectSchema, async ({ sobject_name }) => {
  const meta = await getConnection().sobject(sobject_name).describe();
  return {
    name: meta.name,
    label: meta.label,
    custom: meta.custom,
    keyPrefix: meta.keyPrefix,
    fields: meta.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      length: f.length,
      nillable: f.nillable,
      createable: f.createable,
      updateable: f.updateable,
      filterable: f.filterable,
      sortable: f.sortable,
      custom: f.custom,
      defaultValue: f.defaultValue,
      referenceTo: f.referenceTo,
      picklistValues: f.picklistValues?.map((p) => ({
        value: p.value,
        label: p.label,
        active: p.active,
        defaultValue: p.defaultValue,
      })),
    })),
  };
});

const handleCreateRecord = makeHandler(createRecordSchema, async ({ sobject_name, fields }) => {
  return getConnection().sobject(sobject_name).create(fields);
});

const handleUpdateRecord = makeHandler(updateRecordSchema, async ({ sobject_name, id, fields }) => {
  return getConnection().sobject(sobject_name).update({ Id: id, ...fields });
});

const handleUpsertByExternalId = makeHandler(
  upsertByExternalIdSchema,
  async ({ sobject_name, external_id_field, record }) => {
    return getConnection().sobject(sobject_name).upsert(record, external_id_field);
  },
);

const handleDeleteRecord = makeHandler(deleteRecordSchema, async ({ sobject_name, id }) => {
  return getConnection().sobject(sobject_name).destroy(id);
});

const handleRunApexAnonymous = makeHandler(runApexAnonymousSchema, async ({ apex }) => {
  return getConnection().tooling.executeAnonymous(apex);
});

const HANDLERS: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  run_soql_query: handleRunSoqlQuery,
  run_sosl_search: handleRunSoslSearch,
  get_record: handleGetRecord,
  list_sobjects: handleListSobjects,
  describe_object: handleDescribeObject,
  create_record: handleCreateRecord,
  update_record: handleUpdateRecord,
  upsert_by_external_id: handleUpsertByExternalId,
  delete_record: handleDeleteRecord,
  run_apex_anonymous: handleRunApexAnonymous,
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'salesforce-mcp',
      version: VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    log('Handling tool request', { tool: name });

    const handler = HANDLERS[name];
    if (!handler) return textResult(`Unknown tool: ${name}`, true);
    return handler(request.params.arguments ?? {});
  });

  return server;
}
