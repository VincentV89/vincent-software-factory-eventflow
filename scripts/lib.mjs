import { readFileSync } from 'node:fs';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

const cdkJson = JSON.parse(readFileSync(new URL('../infra/cdk.json', import.meta.url), 'utf8'));
export const STACK_NAME = process.env.EVENTFLOW_STACK_NAME ?? cdkJson.context['eventflow:stackName'];
export const REGION = process.env.EVENTFLOW_REGION ?? cdkJson.context['eventflow:region'] ?? 'us-east-1';

export async function stackOutputs() {
  const cfn = new CloudFormationClient({ region: REGION });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  return Object.fromEntries((res.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
}
