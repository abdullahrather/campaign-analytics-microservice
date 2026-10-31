/**
 * src/modules/docs/openapi.ts
 *
 * The OpenAPI document behind /docs. Request bodies are generated from the same
 * Zod schemas that validate requests, so the docs can't drift from the code.
 */
import { z } from 'zod';
import { loginSchema } from '@/modules/auth/auth.schema';
import { createCampaignSchema, updateCampaignSchema } from '@/modules/campaigns/campaigns.schema';
import { eventBatchSchema } from '@/modules/delivery/delivery.schema';

const toSchema = (schema: z.ZodType): unknown => {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema: output }) => {
      if (zodSchema._zod.def.type === 'date') {
        output.type = 'string';
        output.format = 'date-time';
      }
    },
  });
  delete jsonSchema['$schema'];
  return jsonSchema;
};

const jsonBody = (schema: z.ZodType): unknown => ({
  required: true,
  content: { 'application/json': { schema: toSchema(schema) } },
});

const query = (name: string, description: string, required = false): unknown => ({
  name,
  in: 'query',
  required,
  description,
  schema: { type: 'string' },
});

const campaignId = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Campaign ID',
  schema: { type: 'string' },
};

const dateRange = [
  query('from', 'Start of the period (ISO 8601). Defaults to 7 days before "to".'),
  query('to', 'End of the period (ISO 8601). Defaults to now.'),
];

const responses = (status: string, description: string, ...errors: string[]): unknown => ({
  [status]: { description },
  ...Object.fromEntries(errors.map((code) => [code, { $ref: `#/components/responses/${code}` }])),
});

const dashboard = (tag: string): { tags: string[]; security: unknown[] } => ({
  tags: [tag],
  security: [{ bearerAuth: [] }],
});

const adServer = { tags: ['Ad server'], security: [{ ingestKey: [] }] };

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Campaign Analytics API',
    version: '1.0.0',
    description:
      'Ad campaigns, ad decisions and event tracking for a streaming service. Sign in with ' +
      '`POST /auth/login`, then press Authorize and paste the token.',
    license: { name: 'MIT', url: 'https://opensource.org/license/mit' },
  },
  tags: [
    { name: 'Service', description: 'Status and configuration' },
    { name: 'Auth', description: 'Signing in' },
    { name: 'Campaigns', description: 'Managing campaigns' },
    { name: 'Analytics', description: 'Measuring performance' },
    { name: 'Catalogue', description: 'Shows that ads can run against' },
    { name: 'Ad server', description: 'Used by the ad server or player, with an API key' },
  ],
  paths: {
    '/live': {
      get: {
        tags: ['Service'],
        summary: 'Check the service is running, without touching the database',
        responses: responses('200', 'Running'),
      },
    },
    '/health': {
      get: {
        tags: ['Service'],
        summary: 'Check the service and its database',
        responses: {
          200: { description: 'Healthy' },
          503: { description: 'Database unavailable' },
        },
      },
    },
    '/auth/options': {
      get: {
        tags: ['Auth'],
        summary: 'See whether this is the public demo',
        responses: responses('200', 'Sign-in options'),
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in and receive a token',
        requestBody: jsonBody(loginSchema),
        responses: responses('200', 'Signed in', '401', '422'),
      },
    },
    '/campaigns': {
      get: {
        ...dashboard('Campaigns'),
        summary: 'List campaigns',
        parameters: [
          query('status', 'ACTIVE, PAUSED or COMPLETED'),
          query('page', 'Page number, from 1'),
          query('limit', 'Items per page, up to 100'),
        ],
        responses: responses('200', 'A page of campaigns', '401', '422'),
      },
      post: {
        ...dashboard('Campaigns'),
        summary: 'Create a campaign',
        requestBody: jsonBody(createCampaignSchema),
        responses: responses('201', 'Created', '401', '403', '422'),
      },
    },
    '/campaigns/analytics': {
      get: {
        ...dashboard('Analytics'),
        summary: 'Totals, pacing and spend per campaign',
        parameters: dateRange,
        responses: responses('200', 'One row per campaign', '401', '422'),
      },
    },
    '/campaigns/analytics/timeseries': {
      get: {
        ...dashboard('Analytics'),
        summary: 'Performance over time across campaigns',
        description: 'Hourly for periods up to three days, otherwise daily.',
        parameters: dateRange,
        responses: responses('200', 'Points in time order', '401', '422'),
      },
    },
    '/campaigns/{id}': {
      get: {
        ...dashboard('Campaigns'),
        summary: 'Read a campaign',
        parameters: [campaignId],
        responses: responses('200', 'The campaign', '401', '404'),
      },
      patch: {
        ...dashboard('Campaigns'),
        summary: 'Change a campaign, including pausing and resuming',
        parameters: [campaignId],
        requestBody: jsonBody(updateCampaignSchema),
        responses: responses('200', 'Updated', '401', '403', '404', '409', '422'),
      },
      delete: {
        ...dashboard('Campaigns'),
        summary: 'Delete a campaign and its metrics',
        parameters: [campaignId],
        responses: responses('204', 'Deleted', '401', '403', '404'),
      },
    },
    '/campaigns/{id}/analytics': {
      get: {
        ...dashboard('Analytics'),
        summary: 'One campaign with its trend and breakdowns',
        parameters: [campaignId, ...dateRange],
        responses: responses('200', 'Campaign analytics', '401', '404', '422'),
      },
    },
    '/shows': {
      get: {
        ...dashboard('Catalogue'),
        summary: 'List shows',
        responses: responses('200', 'The catalogue', '401'),
      },
    },
    '/ad-decision': {
      get: {
        ...adServer,
        summary: 'Choose the ad for an ad break',
        description:
          'Returns the eligible campaign furthest behind schedule, or null when nothing can run.',
        parameters: [
          query('showId', 'Show ID', true),
          query('slot', 'PRE_ROLL, MID_ROLL or POST_ROLL', true),
          query('country', 'Two-letter country code', true),
          query('device', 'CTV, MOBILE, WEB or TABLET', true),
        ],
        responses: responses('200', 'The chosen campaign, or null', '401', '422'),
      },
    },
    '/events': {
      post: {
        ...adServer,
        summary: 'Record a batch of up to 1,000 ad events',
        requestBody: jsonBody(eventBatchSchema),
        responses: responses('202', 'Accepted', '401', '422'),
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      ingestKey: { type: 'apiKey', in: 'header', name: 'x-ingest-key' },
    },
    responses: {
      401: { description: 'Sign-in or API key required' },
      403: { description: 'The guest account is read-only' },
      404: { description: 'Not found, or belongs to another advertiser' },
      409: { description: 'Not allowed in the current state' },
      422: { description: 'The request failed validation' },
    },
  },
};
