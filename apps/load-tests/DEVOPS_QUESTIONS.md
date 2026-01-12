# DevOps Open Questions: Load Testing Infrastructure

This document outlines open questions and required changes for setting up AWS-based load testing infrastructure.

## Current State

The load testing system is fully functional locally and ready for AWS integration. All code includes abstraction layers that allow swapping AWS implementations without changing core logic.

**What works now:**

- ✅ Environment configuration (env vars + config file)
- ✅ Result uploader abstraction (local file system)
- ✅ Metadata collection (runner type, git SHA, container ID)
- ✅ Docker containerization
- ✅ GitHub Actions workflow (runs directly, not via AWS yet)

## Open Questions

### 1. Container Registry

**Question:** Which container registry should we use?

**Current:** GitHub Container Registry (GHCR) - `ghcr.io/${{ github.repository }}/load-test`

**Options:**

- **GHCR** (current): Already configured, works with GitHub Actions
  - Pros: No additional setup, integrated with GitHub
  - Cons: External to AWS, potential egress costs
- **AWS ECR**: Native AWS container registry
  - Pros: AWS-native, better integration with ECS/EC2, potentially cheaper
  - Cons: Requires AWS setup, GitHub Actions needs AWS credentials
- **Hybrid**: Build in GitHub Actions, push to ECR
  - Pros: CI validation in GitHub, storage in AWS
  - Cons: More complex setup

**Recommendation:** ECR for AWS-native integration, but GHCR is fine if simpler.

**Required Changes:**

- If ECR: Update `.github/workflows/build-load-test-image.yml` to push to ECR instead of GHCR
- Add AWS credentials to GitHub Actions secrets
- Update image pull location in AWS infrastructure

---

### 2. Infrastructure Choice

**Question:** Where should load generators run?

**Options:**

- **ECS Fargate** (recommended): Serverless containers, auto-scaling, pay-per-use
  - Pros: No instance management, scales automatically, cost-effective
  - Cons: Cold start latency, 15-minute timeout limit
- **EC2 Spot Instances**: Cost-effective, requires instance management
  - Pros: Very cheap, full control
  - Cons: Can be interrupted, requires instance management
- **EC2 On-Demand**: Standard instances
  - Pros: Reliable, full control
  - Cons: More expensive, requires instance management
- **Lambda**: Serverless functions
  - Pros: Fully serverless, very cheap
  - Cons: 15-minute timeout limit, may not suit long-running tests

**Recommendation:** ECS Fargate for simplicity and cost-effectiveness.

**Required Changes:**

- Create ECS cluster: `load-test-cluster`
- Create task definition template
- Configure Fargate launch type (CPU/memory requirements TBD)
- Set up CloudWatch log group: `/ecs/load-test`

---

### 3. AWS Account Structure

**Question:** Which AWS account should host this infrastructure?

**Options:**

- Same account as production relay servers
- Separate account for load testing
- Separate account per environment (dev/UAT/prod)

**Recommendation:** Separate account for load testing to isolate costs and permissions.

**Required Changes:**

- Determine account structure
- Set up cross-account access if needed
- Configure IAM roles and permissions

---

### 4. Network Configuration

**Question:** What network configuration is needed?

**Open Questions:**

- Do ECS tasks need VPC configuration?
- Public vs private subnets?
- Security groups and network ACLs?
- How do tasks access the relay servers (public internet vs VPC peering)?

**Required Changes:**

- Configure VPC (if needed)
- Set up security groups
- Configure network access to relay servers

---

### 5. Secrets Management

**Question:** How should environment URLs be stored?

**Current:** GitHub Secrets (`RELAY_URL_DEV`, `RELAY_URL_UAT`, `RELAY_URL_PROD`)

**Proposed:** AWS Secrets Manager

**Required Setup:**

- Create secrets:
  - `load-test/dev/relay-url`
  - `load-test/uat/relay-url`
  - `load-test/prod/relay-url`
- IAM role for ECS tasks with Secrets Manager read permissions
- Update code to read from Secrets Manager (abstraction layer ready)

**Code Changes Needed:**

- Implement `AwsSecretsManagerConfigProvider` in `apps/load-tests/src/config/environments.ts`
- Add AWS SDK dependency: `@aws-sdk/client-secrets-manager`

---

### 6. Result Storage

**Question:** Where should test results be stored?

**Current:** Local filesystem, GitHub Actions artifacts

**Proposed:** S3 bucket

**Required Setup:**

- Create S3 bucket: `mobile-wallet-protocol-load-test-results` (or similar)
- Structure: `{environment}/{scenario}/{timestamp}/{task-id}/results.json`
- Enable versioning and lifecycle policies
- Set up bucket policies for ECS task access

**Code Changes Needed:**

- Implement `S3Uploader` in `apps/load-tests/src/output/uploader.ts`
- Add AWS SDK dependency: `@aws-sdk/client-s3`
- Update uploader selection logic

**IAM Permissions Required:**

- `s3:PutObject` on results bucket
- `s3:PutObjectAcl` (if needed)

---

### 7. Monitoring and Logging

**Question:** What monitoring and alerting is needed?

**Required Setup:**

- CloudWatch log group: `/ecs/load-test`
- CloudWatch alarms for:
  - Failed test runs
  - Unusual test durations
  - Production test runs (for audit)
- SNS notifications for critical failures

**Code Changes Needed:**

- Ensure logs are sent to CloudWatch (automatic with ECS)
- Add CloudWatch metrics (optional, for advanced monitoring)

---

### 8. Cost Management

**Question:** How should costs be managed?

**Required Setup:**

- Budget alerts
- Cost allocation tags:
  - `Environment: dev/uat/prod`
  - `Project: load-testing`
  - `Team: <team-name>`
- Cost monitoring dashboard

---

### 9. Production Safety

**Question:** How do we prevent accidental production runs?

**Current:** Manual approval in GitHub Actions workflow

**Additional Safeguards Needed:**

- IAM policy preventing production runs without approval
- Separate AWS account for production (if using separate accounts)
- CloudWatch alarm for all production runs
- Audit logging

**Required Changes:**

- Update IAM policies
- Configure CloudWatch alarms
- Set up audit trail

---

### 10. GitHub Actions Integration

**Question:** How should GitHub Actions trigger AWS infrastructure?

**Current:** Runs directly in GitHub Actions runner

**Options:**

- **Option A**: GitHub Actions triggers AWS CodePipeline/CodeBuild
  - Pros: AWS-native, better integration
  - Cons: More complex setup
- **Option B**: GitHub Actions uses AWS SDK to trigger ECS tasks
  - Pros: Direct control, simpler
  - Cons: Requires AWS credentials in GitHub
- **Option C**: Keep current approach, build image in AWS instead
  - Pros: Minimal changes
  - Cons: Still runs in GitHub Actions, not AWS

**Recommendation:** Option B - GitHub Actions triggers ECS tasks directly.

**Required Changes:**

- Update `.github/workflows/load-test.yml` to:
  - Use AWS SDK or `aws-actions/amazon-ecs-run-task`
  - Pass environment variables to ECS task
  - Wait for task completion
  - Download results from S3
- Add AWS credentials to GitHub Actions secrets
- Configure OIDC provider (if using OIDC instead of access keys)

---

### 11. IAM Roles and Permissions

**Required IAM Roles:**

1. **ECS Task Role** (for load test tasks):
   - Read from Secrets Manager
   - Write to S3 bucket
   - Write to CloudWatch Logs
   - Minimum permissions principle

2. **GitHub Actions Role** (if using AWS SDK):
   - Run ECS tasks
   - Read task status
   - Read from S3 (for results)
   - OIDC trust relationship (if using OIDC)

**Required Setup:**

- Create IAM roles with appropriate policies
- Configure trust relationships
- Set up OIDC provider (if using OIDC)

---

### 12. Container Image Build Location

**Question:** Where should Docker images be built?

**Current:** GitHub Actions builds and pushes to GHCR

**Options:**

- **Keep in GitHub Actions**: Build in CI, push to registry
  - Pros: CI validation, versioned images
  - Cons: External to AWS
- **Build in AWS**: Use CodeBuild or ECR build service
  - Pros: AWS-native, simpler permissions
  - Cons: Less visibility in GitHub

**Recommendation:** Build in GitHub Actions for CI validation, but this is optional. Can build on-demand in AWS if preferred.

**Note:** Image versioning is not strictly necessary for load tests (git SHA in results provides versioning).

---

## Required Code Changes (Post-DevOps Setup)

### 1. AWS Secrets Manager Integration

**File:** `apps/load-tests/src/config/environments.ts`

Add `AwsSecretsManagerConfigProvider`:

```typescript
async function getConfigFromAwsSecrets(
  envName: EnvironmentName
): Promise<EnvironmentConfig | null> {
  // Implementation using @aws-sdk/client-secrets-manager
}
```

### 2. S3 Uploader Implementation

**File:** `apps/load-tests/src/output/uploader.ts`

Add `S3Uploader` class:

```typescript
export class S3Uploader implements ResultUploader {
  async upload(results: TestResults, options?: UploadOptions): Promise<string> {
    // Implementation using @aws-sdk/client-s3
  }
}
```

### 3. Update Uploader Selection

**File:** `apps/load-tests/src/output/uploader.ts`

Update `getUploader()` to detect AWS environment and return `S3Uploader`.

### 4. GitHub Actions Workflow Updates

**File:** `.github/workflows/load-test.yml`

Replace direct execution with ECS task execution:

- Use `aws-actions/amazon-ecs-run-task` or AWS SDK
- Pass environment variables to task
- Wait for completion
- Download results from S3

---

## Dependencies to Add (Post-DevOps)

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x.x",
    "@aws-sdk/client-secrets-manager": "^3.x.x",
    "@aws-sdk/client-ecs": "^3.x.x" // Optional, for advanced features
  }
}
```

---

## Testing Strategy

1. **Local Testing**: ✅ Complete (all functionality tested)
2. **Docker Testing**: ✅ Complete (container builds and runs)
3. **AWS Integration Testing**:
   - Test Secrets Manager integration
   - Test S3 upload
   - Test ECS task execution
   - Test CloudWatch logging
   - Test production safety mechanisms

---

## Next Steps

1. **DevOps Setup:**
   - Answer open questions above
   - Set up AWS infrastructure
   - Configure IAM roles and permissions
   - Set up Secrets Manager secrets
   - Create S3 bucket

2. **Code Integration:**
   - Implement AWS Secrets Manager integration
   - Implement S3 uploader
   - Update GitHub Actions workflow
   - Add AWS SDK dependencies

3. **Testing:**
   - Test end-to-end AWS flow
   - Verify production safety
   - Test cost monitoring

4. **Documentation:**
   - Update README with AWS setup instructions
   - Document AWS-specific configuration
   - Document troubleshooting for AWS issues

---

## Questions for DevOps Team

1. Which AWS account should host this infrastructure?
2. ECS Fargate, EC2, or Lambda for load generators?
3. ECR or GHCR for container registry?
4. What VPC/network configuration is needed?
5. What are the cost expectations/budgets?
6. What monitoring/alerting requirements?
7. Should we use OIDC or access keys for GitHub Actions?
8. What are the production safety requirements beyond manual approval?
