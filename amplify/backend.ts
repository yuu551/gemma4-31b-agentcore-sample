import { defineBackend } from "@aws-amplify/backend";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as s3vectors from "aws-cdk-lib/aws-s3vectors";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cr from "aws-cdk-lib/custom-resources";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import { auth } from "./auth/resource";
import { parameters } from "./parameters";

const __dirname = dirname(fileURLToPath(import.meta.url));

const backend = defineBackend({ auth });

const ragStack = backend.createStack("AgenticRagStack");

// --- S3 Vectors ---
const docsBucket = new s3.Bucket(ragStack, "DocsBucket", {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

const vectorBucket = new s3vectors.CfnVectorBucket(ragStack, "VectorBucket", {});
vectorBucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

const vectorIndexName = "company-docs";
const vectorIndex = new s3vectors.CfnIndex(ragStack, "VectorIndex", {
  vectorBucketArn: vectorBucket.attrVectorBucketArn,
  indexName: vectorIndexName,
  dataType: "float32",
  dimension: 1024,
  distanceMetric: "cosine",
  metadataConfiguration: {
    nonFilterableMetadataKeys: [
      "AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA",
      "x-amz-bedrock-kb-source-uri", "x-amz-bedrock-kb-chunk-id",
      "x-amz-bedrock-kb-data-source-id",
    ],
  },
});
vectorIndex.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

// --- Knowledge Base (S3 Vectors バックエンド) ---
const kbRole = new iam.Role(ragStack, "KnowledgeBaseRole", {
  assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
  inlinePolicies: {
    KBPolicy: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: [
            "s3vectors:CreateIndex", "s3vectors:DeleteIndex", "s3vectors:GetIndex",
            "s3vectors:ListIndexes", "s3vectors:PutVectors", "s3vectors:GetVectors",
            "s3vectors:DeleteVectors", "s3vectors:QueryVectors", "s3vectors:ListVectors",
          ],
          resources: [vectorBucket.attrVectorBucketArn, `${vectorBucket.attrVectorBucketArn}/*`],
        }),
        new iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: [docsBucket.bucketArn, `${docsBucket.bucketArn}/*`],
        }),
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel"],
          resources: [`arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.titan-embed-text-v2:0`],
        }),
      ],
    }),
  },
});

const kb = new bedrock.CfnKnowledgeBase(ragStack, "KnowledgeBase", {
  name: "agentic-rag-kb",
  roleArn: kbRole.roleArn,
  knowledgeBaseConfiguration: {
    type: "VECTOR",
    vectorKnowledgeBaseConfiguration: {
      embeddingModelArn: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.titan-embed-text-v2:0`,
    },
  },
  storageConfiguration: {
    type: "S3_VECTORS",
    s3VectorsConfiguration: {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: vectorIndexName,
    },
  },
});
kb.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
kb.addDependency(vectorIndex);

const dataSource = new bedrock.CfnDataSource(ragStack, "KBDataSource", {
  knowledgeBaseId: kb.attrKnowledgeBaseId,
  name: "company-docs",
  dataSourceConfiguration: {
    type: "S3",
    s3Configuration: { bucketArn: docsBucket.bucketArn },
  },
});
dataSource.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

// --- Seed: upload docs to S3 + sync KB ---
const docsDeployment = new s3deploy.BucketDeployment(ragStack, "SeedDocs", {
  sources: [s3deploy.Source.asset(join(__dirname, "../seed/docs"))],
  destinationBucket: docsBucket,
});

const syncFn = new lambda.Function(ragStack, "KbSyncFunction", {
  runtime: lambda.Runtime.PYTHON_3_13,
  handler: "index.handler",
  code: lambda.Code.fromInline(`
import boto3
import time
import cfnresponse

def handler(event, context):
    if event["RequestType"] == "Delete":
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
        return

    kb_id = event["ResourceProperties"]["KnowledgeBaseId"]
    ds_id = event["ResourceProperties"]["DataSourceId"]
    client = boto3.client("bedrock-agent")

    try:
        resp = client.start_ingestion_job(knowledgeBaseId=kb_id, dataSourceId=ds_id)
        job_id = resp["ingestionJob"]["ingestionJobId"]

        while True:
            status = client.get_ingestion_job(
                knowledgeBaseId=kb_id, dataSourceId=ds_id, ingestionJobId=job_id
            )
            state = status["ingestionJob"]["status"]
            if state in ("COMPLETE", "FAILED", "STOPPED"):
                break
            time.sleep(5)

        if state == "COMPLETE":
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {"JobId": job_id})
        else:
            cfnresponse.send(event, context, cfnresponse.FAILED, {"Reason": f"Ingestion {state}"})
    except Exception as e:
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Reason": str(e)})
`),
  timeout: cdk.Duration.minutes(10),
});

syncFn.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      "bedrock:StartIngestionJob",
      "bedrock:GetIngestionJob",
    ],
    resources: ["*"],
  }),
);

const syncResource = new cdk.CustomResource(ragStack, "KbSyncTrigger", {
  serviceToken: syncFn.functionArn,
  properties: {
    KnowledgeBaseId: kb.attrKnowledgeBaseId,
    DataSourceId: dataSource.attrDataSourceId,
    Timestamp: Date.now().toString(),
  },
});
syncResource.node.addDependency(docsDeployment);

// --- AgentCore Memory ---
const memory = new agentcore.Memory(ragStack, "AgentMemory", {
  memoryName: "agentic_rag_memory",
});

// --- AgentCore Runtime ---
const agentArtifact = agentcore.AgentRuntimeArtifact.fromAsset(
  join(__dirname, "../agent"),
);

const runtime = new agentcore.Runtime(ragStack, "AgenticRagRuntime", {
  runtimeName: "agentic_rag_gemma4",
  agentRuntimeArtifact: agentArtifact,
  description: "Agentic RAG with Gemma 4 31B + Knowledge Base + Memory",
  authorizerConfiguration: agentcore.RuntimeAuthorizerConfiguration.usingCognito(
    backend.auth.resources.userPool,
    [backend.auth.resources.userPoolClient],
  ),
});

// Bedrock model invocation (Gemma 4 31B via bedrock-mantle)
runtime.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ["bedrock:*", "bedrock-mantle:*"],
    resources: ["*"],
  }),
);

// Knowledge Base retrieve
runtime.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ["bedrock:Retrieve"],
    resources: [`arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/${kb.attrKnowledgeBaseId}`],
  }),
);

// AgentCore Memory
runtime.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ["bedrock-agentcore:*"],
    resources: [memory.memoryArn],
  }),
);

// Environment variables
const cfnRuntime = runtime.node.defaultChild as cdk.CfnResource;
cfnRuntime.addPropertyOverride("EnvironmentVariables", {
  KNOWLEDGE_BASE_ID: kb.attrKnowledgeBaseId,
  AGENTCORE_MEMORY_ID: memory.memoryId,
  AWS_REGION: ragStack.region,
});

// --- Cognito authenticated role: allow direct S3 document access ---
const authenticatedRole = backend.auth.resources.authenticatedUserIamRole;
const cfnUserPoolClient = backend.auth.resources.userPoolClient.node.defaultChild as cdk.CfnResource;
cfnUserPoolClient.addPropertyOverride("ExplicitAuthFlows", [
  "ALLOW_USER_SRP_AUTH",
  "ALLOW_USER_PASSWORD_AUTH",
  "ALLOW_REFRESH_TOKEN_AUTH",
]);

// --- Feedback collection: REST API + Cognito User Pool Authorizer + DynamoDB ---
const feedbackTable = new dynamodb.Table(ragStack, "FeedbackTable", {
  partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "ttl",
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

feedbackTable.addGlobalSecondaryIndex({
  indexName: "ByCreatedAt",
  partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
});

const feedbackFn = new lambda.Function(ragStack, "FeedbackFunction", {
  runtime: lambda.Runtime.PYTHON_3_13,
  handler: "index.handler",
  code: lambda.Code.fromAsset(join(__dirname, "functions/feedback")),
  environment: {
    TABLE_NAME: feedbackTable.tableName,
  },
  timeout: cdk.Duration.seconds(10),
});

feedbackTable.grantWriteData(feedbackFn);

const feedbackApi = new apigateway.RestApi(ragStack, "FeedbackApi", {
  restApiName: "agentic-rag-feedback",
  deployOptions: {
    stageName: "prod",
  },
});

const feedbackAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(ragStack, "FeedbackAuthorizer", {
  cognitoUserPools: [backend.auth.resources.userPool],
  resultsCacheTtl: cdk.Duration.minutes(5),
});

feedbackApi.addGatewayResponse("Default4xx", {
  type: apigateway.ResponseType.DEFAULT_4XX,
  responseHeaders: {
    "Access-Control-Allow-Origin": "'*'",
    "Access-Control-Allow-Headers": "'Authorization,Content-Type'",
  },
});
feedbackApi.addGatewayResponse("Default5xx", {
  type: apigateway.ResponseType.DEFAULT_5XX,
  responseHeaders: {
    "Access-Control-Allow-Origin": "'*'",
  },
});

const feedbackResource = feedbackApi.root.addResource("feedback");
feedbackResource.addCorsPreflight({
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type"],
  maxAge: cdk.Duration.hours(1),
});
feedbackResource.addMethod("POST", new apigateway.LambdaIntegration(feedbackFn), {
  authorizer: feedbackAuthorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});

const authenticatedPolicy = new iam.Policy(ragStack, "AuthenticatedRolePolicy", {
  statements: [
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:GetObject"],
      resources: [`${docsBucket.bucketArn}/*`],
    }),
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock-agentcore:GetMemory",
        "bedrock-agentcore:ListMemoryRecords",
        "bedrock-agentcore:GetMemoryRecord",
        "bedrock-agentcore:ListMemorySessions",
        "bedrock-agentcore:ListMemoryEvents",
      ],
      resources: [
        memory.memoryArn,
        `${memory.memoryArn}/*`,
      ],
    }),
  ],
});
authenticatedPolicy.attachToRole(authenticatedRole as iam.Role);

// --- (Optional) AgentCore Gateway — AWS Knowledge MCP Server ---
if (parameters.enableGateway) {
  const gateway = new agentcore.Gateway(ragStack, "KnowledgeGateway", {
    gatewayName: "agentic-rag-gateway",
    description: "Agentic RAG Gateway: AWS Knowledge MCP",
    authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
  });

  new agentcore.CfnGatewayTarget(ragStack, "AWSKnowledgeTarget", {
    gatewayIdentifier: gateway.gatewayId,
    name: "aws-knowledge",
    description: "AWS official documentation search (hosted MCP server)",
    targetConfiguration: {
      mcp: {
        mcpServer: {
          endpoint: "https://knowledge-mcp.global.api.aws",
        },
      },
    },
  });

  // Runtime にも Gateway へのアクセスを付与
  runtime.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock-agentcore:InvokeGateway"],
      resources: [
        gateway.gatewayArn,
        `${gateway.gatewayArn}/*`,
      ],
    }),
  );

  cfnRuntime.addPropertyOverride("EnvironmentVariables.GATEWAY_URL", gateway.gatewayUrl ?? "");

  backend.addOutput({
    custom: {
      runtime_arn: runtime.agentRuntimeArn,
      memory_id: memory.memoryId,
      knowledge_base_id: kb.attrKnowledgeBaseId,
      aws_region: ragStack.region,
      docs_bucket_name: docsBucket.bucketName,
      feedback_url: feedbackApi.urlForPath("/feedback"),
      feedback_table_name: feedbackTable.tableName,
      gateway_id: gateway.gatewayId,
      gateway_url: gateway.gatewayUrl ?? "",
    },
  });
} else {
  backend.addOutput({
    custom: {
      runtime_arn: runtime.agentRuntimeArn,
      memory_id: memory.memoryId,
      knowledge_base_id: kb.attrKnowledgeBaseId,
      aws_region: ragStack.region,
      docs_bucket_name: docsBucket.bucketName,
      feedback_url: feedbackApi.urlForPath("/feedback"),
      feedback_table_name: feedbackTable.tableName,
    },
  });
}
