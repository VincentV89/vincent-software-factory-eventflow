#!/usr/bin/env node
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Tags } from 'aws-cdk-lib';
import { EventFlowStack } from '../lib/eventflow-stack.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = new App();
const stackName: string = app.node.tryGetContext('eventflow:stackName') ?? 'EventFlow';
const region: string = process.env.CDK_DEFAULT_REGION ?? app.node.tryGetContext('eventflow:region') ?? 'us-east-1';

const stack = new EventFlowStack(app, 'EventFlow', {
  stackName,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  description: 'EventFlow - serverless event registration platform (S3/CloudFront, API Gateway HTTP API, Lambda, DynamoDB, Cognito)',
  frontendAssetPath: path.resolve(here, '../../frontend/dist'),
  seedMockData: String(app.node.tryGetContext('eventflow:seedMockData')) !== 'false',
  seedCount: Number(app.node.tryGetContext('eventflow:seedCount') ?? 168),
  extraCorsOrigins: app.node.tryGetContext('eventflow:extraCorsOrigins') ?? [],
});
Tags.of(stack).add('application', 'eventflow');
Tags.of(stack).add('environment', 'development');
