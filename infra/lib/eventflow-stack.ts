import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as triggers from 'aws-cdk-lib/triggers';
import type { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '../../backend');
const ORGANIZER_GROUP = 'organizers';
const EVENT_ID = 'cloudsummit-2027';

export interface EventFlowStackProps extends StackProps {
  /** Path to the built Vite app (frontend/dist). */
  frontendAssetPath: string;
  seedMockData: boolean;
  seedCount: number;
  /** Extra allowed CORS origins, e.g. http://localhost:5173 for local development. */
  extraCorsOrigins?: string[];
}

type Access = 'GetItem' | 'PutItem' | 'UpdateItem' | 'DeleteItem' | 'Query' | 'BatchWriteItem';

export class EventFlowStack extends Stack {
  constructor(scope: Construct, id: string, props: EventFlowStackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------- Data
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
      // Development preview: `cdk destroy` removes all data. Use RETAIN for production.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---------------------------------------------------------------- Auth
    const userPool = new cognito.UserPool(this, 'OrganizerUserPool', {
      selfSignUpEnabled: false, // organizers are invited by an administrator only
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true, tempPasswordValidity: Duration.days(7) },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.LITE,
      userInvitation: {
        emailSubject: 'You have been invited to the EventFlow organizer dashboard',
        emailBody: 'Hello! Your EventFlow organizer username is {username} and your temporary password is {####}. You will be asked to choose a new password on first sign-in.',
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userPoolClient = userPool.addClient('WebClient', {
      generateSecret: false, // public SPA client – no secret can be kept in a browser
      authFlows: { userPassword: true, userSrp: true },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(1),
      enableTokenRevocation: true,
    });
    new cognito.CfnUserPoolGroup(this, 'OrganizersGroup', {
      userPoolId: userPool.userPoolId,
      groupName: ORGANIZER_GROUP,
      description: 'Event organizers with access to attendee data',
    });

    // ---------------------------------------------------------------- Frontend hosting
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `eventflow-dev-site-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self' data:",
            `connect-src 'self' https://*.execute-api.${this.region}.amazonaws.com https://cognito-idp.${this.region}.amazonaws.com`,
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
          ].join('; '),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: true, preload: false },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN },
        xssProtection: { override: true, protection: true, modeBlock: true },
      },
    });

    const siteOriginS3 = origins.S3BucketOrigin.withOriginAccessControl(siteBucket);
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'EventFlow web application',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: siteOriginS3,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      additionalBehaviors: {
        '/config.json': {
          origin: siteOriginS3,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          responseHeadersPolicy: securityHeaders,
        },
      },
      // SPA deep links (/organizer, /organizer/login) are served by index.html
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) },
      ],
    });
    const siteOrigin = `https://${distribution.distributionDomainName}`;

    // ---------------------------------------------------------------- Lambda functions
    const fn = (name: string, entry: string, access: Access[], description: string, extraEnv: Record<string, string> = {}) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
      const f = new NodejsFunction(this, name, {
        description,
        entry: path.join(backendDir, 'src/handlers', entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        logGroup,
        loggingFormat: lambda.LoggingFormat.JSON,
        applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
        systemLogLevelV2: lambda.SystemLogLevel.WARN,
        environment: { TABLE_NAME: table.tableName, ORGANIZER_GROUP, ...extraEnv },
        depsLockFilePath: path.resolve(backendDir, '../package-lock.json'),
        projectRoot: path.resolve(backendDir, '..'),
        bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true, target: 'node22', externalModules: ['@aws-sdk/*'], mainFields: ['module', 'main'], banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);" },
      });
      // Least privilege: each function gets only the DynamoDB actions it needs, on this table only.
      f.addToRolePolicy(new iam.PolicyStatement({ actions: access.map((a) => `dynamodb:${a}`), resources: [table.tableArn] }));
      return f;
    };

    const getEventFn = fn('GetEventFn', 'get-event.ts', ['GetItem'], 'EventFlow: public event details + aggregate counts');
    const registerFn = fn('RegisterFn', 'register.ts', ['PutItem', 'UpdateItem'], 'EventFlow: public registration (transactional capacity + duplicate guard)');
    const listFn = fn('ListRegistrationsFn', 'list-registrations.ts', ['GetItem', 'Query'], 'EventFlow: organizer attendee list');
    const cancelFn = fn('CancelRegistrationFn', 'cancel-registration.ts', ['GetItem', 'UpdateItem', 'DeleteItem'], 'EventFlow: organizer cancellation');
    const seedFn = fn('SeedFn', 'seed.ts', ['PutItem', 'UpdateItem', 'BatchWriteItem'], 'EventFlow: one-time event + mock data seeding', {
      SEED_MOCK_DATA: String(props.seedMockData),
      SEED_COUNT: String(props.seedCount),
    });
    seedFn.node.addDependency(table);

    // ---------------------------------------------------------------- API
    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    const api = new apigw.HttpApi(this, 'HttpApi', {
      description: 'EventFlow REST API',
      corsPreflight: {
        allowOrigins: [siteOrigin, ...(props.extraCorsOrigins ?? [])],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.DELETE, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: Duration.hours(1),
      },
    });
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      // No request bodies, headers or tokens are logged – only request metadata.
      format: JSON.stringify({
        requestId: '$context.requestId',
        requestTime: '$context.requestTime',
        routeKey: '$context.routeKey',
        status: '$context.status',
        latency: '$context.responseLatency',
        integrationError: '$context.integrationErrorMessage',
        authorizerError: '$context.authorizer.error',
      }),
    };
    stage.defaultRouteSettings = { throttlingBurstLimit: 100, throttlingRateLimit: 50 };

    const authorizer = new HttpJwtAuthorizer('CognitoAuthorizer', `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    api.addRoutes({ path: '/events/{eventId}', methods: [apigw.HttpMethod.GET], integration: new HttpLambdaIntegration('GetEventInt', getEventFn) });
    api.addRoutes({ path: '/events/{eventId}/registrations', methods: [apigw.HttpMethod.POST], integration: new HttpLambdaIntegration('RegisterInt', registerFn) });
    api.addRoutes({ path: '/events/{eventId}/registrations', methods: [apigw.HttpMethod.GET], integration: new HttpLambdaIntegration('ListInt', listFn), authorizer });
    api.addRoutes({
      path: '/events/{eventId}/registrations/{confirmationId}',
      methods: [apigw.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('CancelInt', cancelFn),
      authorizer,
    });

    // ---------------------------------------------------------------- Seed (runs once after the table exists)
    new triggers.Trigger(this, 'SeedTrigger', { handler: seedFn, executeAfter: [table], executeOnHandlerChange: false });

    // ---------------------------------------------------------------- Frontend deployment + runtime config
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: siteBucket,
      sources: [
        s3deploy.Source.asset(props.frontendAssetPath),
        // Connects the SPA to this stack's backend at deploy time – contains public identifiers only.
        s3deploy.Source.jsonData('config.json', {
          apiUrl: api.apiEndpoint,
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
          eventId: EVENT_ID,
        }),
      ],
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
      prune: true,
    });

    // ---------------------------------------------------------------- Outputs
    new CfnOutput(this, 'WebsiteUrl', { value: siteOrigin });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'OrganizerGroup', { value: ORGANIZER_GROUP });
    new CfnOutput(this, 'EventId', { value: EVENT_ID });
    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
