#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { TosInfraStack } from '../lib/tos-infra-stack'

const app = new cdk.App()

new TosInfraStack(app, 'TosInfraStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'TOS platform infrastructure — RDS, Secrets Manager, IAM, Security Groups',
})
