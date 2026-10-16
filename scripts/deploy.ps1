param(
  [string]$Region = "ap-south-1",
  [string]$StackName = "eventbook-production"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$awsCli = Get-Command aws -ErrorAction SilentlyContinue
if (-not $awsCli) {
  throw "AWS CLI is not installed. Install AWS CLI v2, configure an authorized profile, then rerun this script."
}

$identityJson = & aws sts get-caller-identity --region $Region --output json
if ($LASTEXITCODE -ne 0) {
  throw "AWS credentials are not usable. Configure a profile (prefer aws configure sso) and retry."
}
$accountId = ($identityJson | ConvertFrom-Json).Account
Write-Host "Target AWS account: $accountId"
Write-Host "Region: $Region"
Write-Host "This stack creates billable resources (EC2, DocumentDB, Network Load Balancer, CloudFront, and API Gateway)."
if ((Read-Host "Type DEPLOY to continue") -cne "DEPLOY") {
  throw "Deployment cancelled. No AWS resources were created."
}

$emailFrom = Read-Host "Verified Amazon SES sender email in $Region"
if ($emailFrom -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  throw "A valid, SES-verified sender email is required."
}

$javascriptFiles = @(
  Get-ChildItem -LiteralPath (Join-Path $projectRoot "frontend\js") -Filter "*.js" -Recurse
  Get-ChildItem -LiteralPath (Join-Path $projectRoot "backend") -Filter "*.js" -Recurse |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' }
)
foreach ($file in $javascriptFiles) {
  & node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($file.FullName)" }
}

$templatePath = Join-Path $projectRoot "infra\aws.yaml"
& aws cloudformation validate-template --template-body "file://$templatePath" --region $Region --output json | Out-Null
if ($LASTEXITCODE -ne 0) { throw "CloudFormation template validation failed." }

$artifactBucket = "eventbook-artifacts-$accountId-$Region"
$workDirectory = Join-Path $env:TEMP ("eventbook-deploy-" + [guid]::NewGuid().ToString("N"))
$backendStage = Join-Path $workDirectory "backend"
$workerStage = Join-Path $workDirectory "email-worker"
$frontendStage = Join-Path $workDirectory "frontend"
New-Item -ItemType Directory -Path $backendStage, $workerStage, $frontendStage -Force | Out-Null

try {
  $backendRoot = Join-Path $projectRoot "backend"
  Get-ChildItem -LiteralPath $backendRoot -Force -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($backendRoot.Length).TrimStart('\')
    $segments = $relative -split '\\'
    if ($segments -contains "node_modules" -or $segments -contains ".git" -or
        $_.Name -eq ".env" -or $_.Name -like ".env.*") {
      return
    }
    $destination = Join-Path $backendStage $relative
    if ($_.PSIsContainer) {
      New-Item -ItemType Directory -Path $destination -Force | Out-Null
    } else {
      New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $destination
    }
  }

  $workerRoot = Join-Path $projectRoot "backend\lambda\email-worker"
  Copy-Item -LiteralPath (Join-Path $workerRoot "index.js") -Destination $workerStage
  Copy-Item -LiteralPath (Join-Path $workerRoot "package.json") -Destination $workerStage
  Copy-Item -LiteralPath (Join-Path $workerRoot "package-lock.json") -Destination $workerStage
  Push-Location $workerStage
  try {
    & npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "Could not install the email-worker dependencies." }
  } finally {
    Pop-Location
  }

  $frontendRoot = Join-Path $projectRoot "frontend"
  Copy-Item -Path (Join-Path $frontendRoot "*") -Destination $frontendStage -Recurse -Force
  $backendArchive = Join-Path $workDirectory "backend.zip"
  $workerArchive = Join-Path $workDirectory "email-worker.zip"
  Compress-Archive -Path (Join-Path $backendStage "*") -DestinationPath $backendArchive
  Compress-Archive -Path (Join-Path $workerStage "*") -DestinationPath $workerArchive

  & aws s3api head-bucket --bucket $artifactBucket --region $Region 2>$null
  if ($LASTEXITCODE -ne 0) {
    if ($Region -eq "us-east-1") {
      & aws s3api create-bucket --bucket $artifactBucket --region $Region
    } else {
      & aws s3api create-bucket --bucket $artifactBucket --region $Region `
        --create-bucket-configuration "LocationConstraint=$Region"
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not create the private deployment artifact bucket." }
  }
  & aws s3api put-public-access-block --bucket $artifactBucket --region $Region `
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
  if ($LASTEXITCODE -ne 0) { throw "Could not block public access on the artifact bucket." }
  & aws s3api put-bucket-encryption --bucket $artifactBucket --region $Region `
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  if ($LASTEXITCODE -ne 0) { throw "Could not enable artifact bucket encryption." }

  & aws s3 cp $backendArchive "s3://$artifactBucket/backend.zip" --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Could not upload the backend archive." }
  & aws s3 cp $workerArchive "s3://$artifactBucket/email-worker.zip" --region $Region
  if ($LASTEXITCODE -ne 0) { throw "Could not upload the email worker archive." }

  & aws cloudformation deploy `
    --template-file $templatePath `
    --stack-name $StackName `
    --region $Region `
    --capabilities CAPABILITY_IAM `
    --parameter-overrides `
      "ArtifactBucket=$artifactBucket" `
      "BackendCodeKey=backend.zip" `
      "WorkerCodeKey=email-worker.zip" `
      "EmailFromAddress=$emailFrom"
  if ($LASTEXITCODE -ne 0) {
    throw "CloudFormation deployment failed. Inspect stack events with aws cloudformation describe-stack-events."
  }

  $stackJson = & aws cloudformation describe-stacks --stack-name $StackName --region $Region --output json
  if ($LASTEXITCODE -ne 0) { throw "Could not read the deployed stack outputs." }
  $outputs = @{}
  foreach ($output in ($stackJson | ConvertFrom-Json).Stacks[0].Outputs) {
    $outputs[$output.OutputKey] = $output.OutputValue
  }

  $config = "window.EVENTBOOK_CONFIG = Object.freeze({ apiBase: '$($outputs.ApiBaseUrl)' });"
  Set-Content -LiteralPath (Join-Path $frontendStage "js\config.js") -Value $config -Encoding UTF8
  & aws s3 sync $frontendStage "s3://$($outputs.AssetsBucketName)" --region $Region `
    --cache-control "public,max-age=300"
  if ($LASTEXITCODE -ne 0) { throw "Could not upload the website to its private S3 origin." }

  $distributionId = ($stackJson | ConvertFrom-Json).Stacks[0].Outputs |
    Where-Object { $_.OutputKey -eq "CloudFrontDistributionId" } |
    Select-Object -ExpandProperty OutputValue
  & aws cloudfront create-invalidation --distribution-id $distributionId --paths "/*" --output text
  if ($LASTEXITCODE -ne 0) { throw "Website uploaded, but CloudFront cache invalidation failed." }

  $secretArn = $outputs.ApplicationSecretArn
  & (Join-Path $PSScriptRoot "configure-admin.ps1") -SecretArn $secretArn -Region $Region
  if ($LASTEXITCODE -ne 0) { throw "Admin setup failed; rerun scripts/configure-admin.ps1." }

  Write-Host ""
  Write-Host "EventBook deployment completed."
  Write-Host "Website: $($outputs.WebsiteUrl)"
  Write-Host "API:     $($outputs.ApiBaseUrl)/api"
  Write-Host "Email DLQ: $($outputs.EmailDeadLetterQueueUrl)"
  Write-Host "Subscribe notification recipients to SNS topic: $($outputs.NotificationsTopicArn)"
  Write-Host "Note: SES must be out of sandbox for unverified customer addresses."
}
finally {
  if (Test-Path -LiteralPath $workDirectory) {
    Remove-Item -LiteralPath $workDirectory -Recurse -Force
  }
}
