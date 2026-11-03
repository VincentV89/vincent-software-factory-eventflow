import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', env: { TABLE_NAME: 'test-table', AWS_REGION: 'us-east-1' } } });
