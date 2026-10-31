// Validates an OpenAPI document read from stdin. Runs outside Jest, which can't load this ES module.
import fs from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';

await SwaggerParser.validate(JSON.parse(fs.readFileSync(0, 'utf8')));
