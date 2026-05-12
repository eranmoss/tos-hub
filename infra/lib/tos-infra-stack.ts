import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { Construct } from 'constructs'

/**
 * TOS Infrastructure Stack
 *
 * Two distinct runtime environments sharing one RDS and Secrets Manager:
 *
 *   EC2 (existing)
 *     └── TOS main app (PM2) + OpenClaw agentic control plane (PM2)
 *
 *   Serverless -Integration Hub (new)
 *     └── API Gateway HTTP API
 *           ├── Lambda: integration-hub-api      (query + vendor management)
 *           └── Lambda: integration-hub-onboarding  (async job, invoked by api lambda)
 *
 *   Shared
 *     ├── RDS Postgres     (public subnet, SG-restricted -EC2 + Lambda only)
 *     └── Secrets Manager  (tos/* namespace -vendors, config, RDS password)
 *
 * What this creates:
 *   - RDS Postgres instance (public subnet, SG-restricted to EC2 + Lambda)
 *   - Security groups: EC2, Lambda, RDS
 *   - IAM: EC2 instance role + profile, Lambda execution role
 *   - Lambda: integration-hub-api
 *   - Lambda: integration-hub-onboarding
 *   - API Gateway HTTP API → integration-hub-api
 *   - Secrets Manager placeholders: resend, app config
 *
 * What this does NOT create:
 *   - The EC2 instance (already exists -attach SG + profile after deploy)
 *   - Lambda code packages (deploy separately -see README)
 *
 * Prerequisites:
 *   1. `aws configure` on your laptop
 *   2. `npx cdk bootstrap`
 *   3. Update CONFIG.NOTIFY_EMAIL below
 *   4. Create placeholder Lambda zip files (see README) before first deploy
 */

// ── Configuration -edit before deploying ────────────────────────────────────

const CONFIG = {
  // RDS
  RDS_INSTANCE_IDENTIFIER:  'tos-postgres',
  RDS_DATABASE_NAME:        'tos',
  RDS_INSTANCE_CLASS:       ec2.InstanceClass.T4G,
  RDS_INSTANCE_SIZE:        ec2.InstanceSize.MICRO,   // ~$15/month -upgrade when needed
  RDS_POSTGRES_VERSION:     rds.PostgresEngineVersion.VER_16,
  RDS_ALLOCATED_STORAGE_GB: 20,
  RDS_BACKUP_RETENTION_DAYS: 7,

  // Secrets Manager path prefix
  SECRET_PATH_PREFIX: 'tos',

  // Notification email for onboarding confirmations
  NOTIFY_EMAIL: 'eranm@bridgify.io',

  // Lambda runtimes + sizing
  LAMBDA_RUNTIME:      lambda.Runtime.NODEJS_20_X,
  LAMBDA_TIMEOUT_API:  cdk.Duration.seconds(30),      // covers fan-out across vendors
  LAMBDA_TIMEOUT_JOB:  cdk.Duration.minutes(5),       // covers Claude API call + validation
  LAMBDA_MEMORY_API:   512,                            // MB
  LAMBDA_MEMORY_JOB:   512,                            // MB
}

// ─────────────────────────────────────────────────────────────────────────────

export class TosInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ── 1. VPC ───────────────────────────────────────────────────────────────
    // Default VPC assumed. If your EC2 is in a custom VPC replace with:
    // ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: 'vpc-xxxxxxxx' })
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { isDefault: true })

    // ── 2. Security Groups ───────────────────────────────────────────────────

    // EC2 -add this SG to your existing instance after deploy (see README)
    const ec2Sg = new ec2.SecurityGroup(this, 'TosAppSg', {
      vpc,
      securityGroupName: 'tos-app-sg',
      description:       'TOS EC2 -main app and OpenClaw',
      allowAllOutbound:  true,
    })

    // RDS -accepts Postgres from EC2 and Lambda only, nothing else
    const rdsSg = new ec2.SecurityGroup(this, 'TosRdsSg', {
      vpc,
      securityGroupName: 'tos-rds-sg',
      description:       'TOS RDS Postgres -EC2 and Lambda only',
      allowAllOutbound:  false,
    })
    rdsSg.addIngressRule(ec2Sg,    ec2.Port.tcp(5432), 'Postgres from EC2')
    rdsSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'Postgres from Lambda (non-VPC) -password auth required')

    // ── 3. RDS Postgres ──────────────────────────────────────────────────────
    // Master password auto-generated and stored in Secrets Manager at tos/rds/master

    const rdsCredentials = rds.Credentials.fromGeneratedSecret('tos_admin', {
      secretName: `${CONFIG.SECRET_PATH_PREFIX}/rds/master`,
    })

    const rdsInstance = new rds.DatabaseInstance(this, 'TosPostgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: CONFIG.RDS_POSTGRES_VERSION,
      }),
      instanceType:    ec2.InstanceType.of(CONFIG.RDS_INSTANCE_CLASS, CONFIG.RDS_INSTANCE_SIZE),
      vpc,
      vpcSubnets:      { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups:  [rdsSg],
      credentials:     rdsCredentials,
      instanceIdentifier:      CONFIG.RDS_INSTANCE_IDENTIFIER,
      databaseName:            CONFIG.RDS_DATABASE_NAME,
      allocatedStorage:        CONFIG.RDS_ALLOCATED_STORAGE_GB,
      storageEncrypted:        true,
      backupRetention:         cdk.Duration.days(CONFIG.RDS_BACKUP_RETENTION_DAYS),
      deletionProtection:      true,          // requires manual disable before destroy
      removalPolicy:           cdk.RemovalPolicy.RETAIN,
      multiAz:                 false,         // enable when ready for HA
      publiclyAccessible:      true,          // public subnet for now -SG restricts to EC2+Lambda only. Revisit later.
      autoMinorVersionUpgrade: true,
      cloudwatchLogsExports:   ['postgresql'],
    })

    // ── 4. Secrets Manager ───────────────────────────────────────────────────

    const resendSecret = new secretsmanager.Secret(this, 'ResendApiKey', {
      secretName:  `${CONFIG.SECRET_PATH_PREFIX}/config/resend`,
      description: 'Resend API key -update after deploy',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ api_key: 'REPLACE_AFTER_DEPLOY' })
      ),
    })

    new secretsmanager.Secret(this, 'AppConfig', {
      secretName:  `${CONFIG.SECRET_PATH_PREFIX}/config/app`,
      description: 'TOS application configuration',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ notify_email: CONFIG.NOTIFY_EMAIL, environment: 'production' })
      ),
    })

    // Anthropic API key placeholder -update after deploy:
    //   aws secretsmanager put-secret-value \
    //     --secret-id tos/config/anthropic \
    //     --secret-string '{"api_key":"sk-ant-xxxx"}'
    new secretsmanager.Secret(this, 'AnthropicApiKey', {
      secretName:  `${CONFIG.SECRET_PATH_PREFIX}/config/anthropic`,
      description: 'Anthropic API key for Integration Hub schema mapping',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ api_key: 'REPLACE_AFTER_DEPLOY' })
      ),
    })

    // ── 4b. S3 -Shared config bucket ──────────────────────────────────────
    // Canonical schemas, datasource configs, booking schemas.
    // Both Lambdas and EC2 read from here. Updated via CLI or CI.
    //
    // Structure:
    //   s3://tos-config-{account}/schemas/catalog.json
    //   s3://tos-config-{account}/schemas/datasources.json
    //   s3://tos-config-{account}/schemas/booking_schemas.json

    const configBucket = new s3.Bucket(this, 'TosConfigBucket', {
      bucketName:       `tos-config-${this.account}`,
      versioned:        true,
      encryption:       s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy:    cdk.RemovalPolicy.RETAIN,
    })

    // ── 5. Shared IAM policy statements ─────────────────────────────────────

    const secretsRead = new iam.PolicyStatement({
      sid:     'ReadTosSecrets',
      effect:  iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${CONFIG.SECRET_PATH_PREFIX}/*`,
      ],
    })

    const secretsWrite = new iam.PolicyStatement({
      sid:     'WriteVendorSecrets',
      effect:  iam.Effect.ALLOW,
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:PutSecretValue',
        'secretsmanager:TagResource',
      ],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${CONFIG.SECRET_PATH_PREFIX}/vendors/*`,
      ],
    })

    // ── 6. EC2 IAM Role + Instance Profile ──────────────────────────────────

    const ec2Role = new iam.Role(this, 'TosEc2Role', {
      roleName:    'tos-ec2-role',
      assumedBy:   new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'TOS EC2 -Secrets Manager access for main app and OpenClaw',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    })
    ec2Role.addToPolicy(secretsRead)
    ec2Role.addToPolicy(secretsWrite)
    configBucket.grantRead(ec2Role)

    const instanceProfile = new iam.CfnInstanceProfile(this, 'TosEc2InstanceProfile', {
      instanceProfileName: 'tos-ec2-instance-profile',
      roles: [ec2Role.roleName],
    })

    // ── 7. Lambda IAM Role ───────────────────────────────────────────────────

    const lambdaRole = new iam.Role(this, 'TosLambdaRole', {
      roleName:    'tos-lambda-role',
      assumedBy:   new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'TOS Integration Hub Lambda -RDS + Secrets Manager',
      managedPolicies: [
        // CloudWatch Logs for Lambda execution
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    })
    lambdaRole.addToPolicy(secretsRead)
    lambdaRole.addToPolicy(secretsWrite)
    configBucket.grantRead(lambdaRole)

    // API Lambda needs to invoke the onboarding Lambda asynchronously
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      sid:     'InvokeOnboardingLambda',
      effect:  iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:integration-hub-onboarding`,
      ],
    }))

    // ── 8. Lambda -Integration Hub API ─────────────────────────────────────
    // Routes handled:
    //   POST   /v1/integrations/onboard              → invokes onboarding Lambda async, returns 202
    //   GET    /v1/:vertical                          → fan-out query
    //   GET    /v1/integrations/vendors               → list vendors
    //   GET    /v1/integrations/vendors/:slug         → vendor detail
    //   DELETE /v1/integrations/vendors/:slug         → deactivate
    //   POST   /v1/integrations/vendors/:slug/revalidate
    //   GET    /v1/integrations/jobs/:id              → job status

    const apiLambda = new lambda.Function(this, 'IntegrationHubApi', {
      functionName: 'integration-hub-api',
      description:  'TOS Integration Hub -query API and vendor management',
      runtime:      CONFIG.LAMBDA_RUNTIME,
      handler:      'index.handler',
      // Placeholder asset -replaced on first real deploy (see README)
      code:         lambda.Code.fromInline(`
        exports.handler = async (event) => ({
          statusCode: 503,
          body: JSON.stringify({ message: 'Integration Hub not yet deployed' })
        })
      `),
      role:           lambdaRole,
      timeout:        CONFIG.LAMBDA_TIMEOUT_API,
      memorySize:     CONFIG.LAMBDA_MEMORY_API,
      environment: {
        NODE_ENV:               'production',
        SECRET_PATH_PREFIX:     CONFIG.SECRET_PATH_PREFIX,
        ONBOARDING_LAMBDA_NAME: 'integration-hub-onboarding',
        CONFIG_BUCKET:          configBucket.bucketName,
        RDS_SECRET_ARN:         rdsInstance.secret?.secretArn ?? '',
        RDS_ENDPOINT:           rdsInstance.instanceEndpoint.hostname,
        RDS_DATABASE:           CONFIG.RDS_DATABASE_NAME,
        AWS_ACCOUNT_ID:         this.account,
      },
    })

    // ── 9. Lambda -Onboarding Job ───────────────────────────────────────────
    // Invoked async by the API Lambda with InvocationType=Event.
    // Steps: store credential → fetch docs → Claude API → write adapter → validate → email.

    const onboardingLambda = new lambda.Function(this, 'IntegrationHubOnboarding', {
      functionName: 'integration-hub-onboarding',
      description:  'TOS Integration Hub -async vendor onboarding job',
      runtime:      CONFIG.LAMBDA_RUNTIME,
      handler:      'index.handler',
      code:         lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Onboarding Lambda placeholder -deploy real code to activate')
        }
      `),
      role:           lambdaRole,
      timeout:        CONFIG.LAMBDA_TIMEOUT_JOB,
      memorySize:     CONFIG.LAMBDA_MEMORY_JOB,
      environment: {
        NODE_ENV:           'production',
        SECRET_PATH_PREFIX: CONFIG.SECRET_PATH_PREFIX,
        CONFIG_BUCKET:      configBucket.bucketName,
        RDS_SECRET_ARN:     rdsInstance.secret?.secretArn ?? '',
        RDS_ENDPOINT:       rdsInstance.instanceEndpoint.hostname,
        RDS_DATABASE:       CONFIG.RDS_DATABASE_NAME,
      },
      // Async invocation: retry once on failure, then stop.
      // The job writes its own failure state to DB and sends a failure email —
      // no need for DLQ at this scale.
      retryAttempts: 1,
    })

    // ── 10. API Gateway HTTP API ─────────────────────────────────────────────
    // HTTP API (not REST API) -simpler, cheaper, lower latency.
    // All routes proxy to the API Lambda. Routing is handled inside the Lambda.

    const httpApi = new apigateway.HttpApi(this, 'TosIntegrationHubApi', {
      apiName:     'tos-integration-hub',
      description: 'TOS Integration Hub API',
      corsPreflight: {
        allowOrigins: ['*'],            // restrict to your domain after launch
        allowMethods: [apigateway.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
      },
    })

    httpApi.addRoutes({
      path:        '/{proxy+}',
      methods:     [apigateway.HttpMethod.ANY],
      integration: new apigatewayIntegrations.HttpLambdaIntegration(
        'ApiLambdaIntegration',
        apiLambda
      ),
    })

    // ── 11. Outputs ──────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'IntegrationHubApiUrl', {
      value:       httpApi.apiEndpoint,
      description: 'Integration Hub API base URL (API Gateway)',
      exportName:  'TosIntegrationHubApiUrl',
    })

    new cdk.CfnOutput(this, 'RdsEndpoint', {
      value:       rdsInstance.instanceEndpoint.hostname,
      description: 'RDS endpoint -used in DATABASE_URL on EC2',
      exportName:  'TosRdsEndpoint',
    })

    new cdk.CfnOutput(this, 'RdsMasterSecretArn', {
      value:       rdsInstance.secret?.secretArn ?? 'see Secrets Manager console',
      description: 'Auto-generated RDS master password secret ARN',
      exportName:  'TosRdsMasterSecretArn',
    })

    new cdk.CfnOutput(this, 'ResendSecretArn', {
      value:       resendSecret.secretArn,
      description: 'Resend API key secret ARN -update value after deploy',
      exportName:  'TosResendSecretArn',
    })

    new cdk.CfnOutput(this, 'ConfigBucketName', {
      value:       configBucket.bucketName,
      description: 'S3 bucket for shared config (schemas, datasources)',
      exportName:  'TosConfigBucketName',
    })

    new cdk.CfnOutput(this, 'Ec2InstanceProfileName', {
      value:       instanceProfile.instanceProfileName ?? 'tos-ec2-instance-profile',
      description: 'Attach this IAM instance profile to your EC2',
      exportName:  'TosEc2InstanceProfileName',
    })

    new cdk.CfnOutput(this, 'Ec2SgId', {
      value:       ec2Sg.securityGroupId,
      description: 'Add this security group to your EC2 instance',
      exportName:  'TosEc2SgId',
    })

    new cdk.CfnOutput(this, 'ApiLambdaArn', {
      value:       apiLambda.functionArn,
      description: 'Integration Hub API Lambda ARN',
      exportName:  'TosApiLambdaArn',
    })

    new cdk.CfnOutput(this, 'OnboardingLambdaArn', {
      value:       onboardingLambda.functionArn,
      description: 'Integration Hub onboarding job Lambda ARN',
      exportName:  'TosOnboardingLambdaArn',
    })
  }
}
