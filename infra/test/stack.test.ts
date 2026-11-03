import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { EventFlowStack } from '../lib/eventflow-stack.js';

let t: Template;
beforeAll(() => {
  const dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<html></html>');
  const app = new App();
  const stack = new EventFlowStack(app, 'Test', {
    env: { account: '111111111111', region: 'us-east-1' },
    frontendAssetPath: dist,
    seedMockData: true,
    seedCount: 10,
  });
  t = Template.fromStack(stack);
}, 120_000);

describe('EventFlowStack', () => {
  it('uses an on-demand DynamoDB table with PITR', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      Replicas: Match.arrayWith([Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })]),
    });
  });
  it('keeps the site bucket private behind CloudFront OAC', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });
  it('disables Cognito self sign-up', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
    t.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'organizers' });
  });
  it('protects organizer routes with the JWT authorizer and leaves public routes open', () => {
    const routes = t.findResources('AWS::ApiGatewayV2::Route');
    const byKey = Object.fromEntries(Object.values(routes).map((r) => [r.Properties.RouteKey, r.Properties.AuthorizationType ?? 'NONE']));
    expect(byKey).toEqual({
      'GET /events/{eventId}': 'NONE',
      'POST /events/{eventId}/registrations': 'NONE',
      'GET /events/{eventId}/registrations': 'JWT',
      'DELETE /events/{eventId}/registrations/{confirmationId}': 'JWT',
    });
  });
  it('restricts CORS to the CloudFront origin', () => {
    const api = Object.values(t.findResources('AWS::ApiGatewayV2::Api'))[0];
    const origins = JSON.stringify(api.Properties.CorsConfiguration.AllowOrigins);
    expect(origins).toContain('DomainName');
    expect(origins).not.toContain('"*"');
  });
  it('grants each function only scoped DynamoDB actions', () => {
    const policies = t.findResources('AWS::IAM::Policy');
    const ddbActions = Object.values(policies)
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .flatMap((s: { Action: string | string[] }) => [s.Action].flat())
      .filter((a: string) => a.startsWith('dynamodb:'));
    expect(ddbActions).not.toContain('dynamodb:*');
    expect(ddbActions).not.toContain('dynamodb:Scan');
  });
});
