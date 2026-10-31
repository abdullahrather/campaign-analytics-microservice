/**
 * src/modules/docs/docs.routes.ts
 *
 * Interactive API docs at /docs. Swagger UI is served from this app, and its
 * settings live in a script file so the content security policy can stay strict.
 */
import express, { Router } from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { openApiDocument } from './openapi';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>API docs · Campaign Analytics</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/docs/init.js"></script>
  </body>
</html>`;

const INIT = `window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  persistAuthorization: true,
});`;

const docsRouter = Router();

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

docsRouter.use('/docs/assets', express.static(getAbsoluteFSPath(), { index: false }));

docsRouter.get('/docs/init.js', (_req, res) => {
  res.type('text/javascript').send(INIT);
});

docsRouter.get('/docs', (_req, res) => {
  res.type('html').send(PAGE);
});

export { docsRouter };
