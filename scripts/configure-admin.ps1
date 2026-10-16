param(
  [Parameter(Mandatory = $true)]
  [string]$SecretArn,

  [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
  throw "AWS CLI is required. Install it and configure an authorized AWS profile first."
}

$email = Read-Host "EventBook admin email"
$securePassword = Read-Host "Admin password (minimum 12 characters)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$secretFile = Join-Path $env:TEMP ("eventbook-admin-" + [guid]::NewGuid().ToString("N") + ".json")

try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ($password.Length -lt 12) {
    throw "Admin password must be at least 12 characters."
  }
  if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    throw "Enter a valid admin email address."
  }

  $current = & aws secretsmanager get-secret-value `
    --secret-id $SecretArn --region $Region --query SecretString --output text
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read the application secret."
  }
  $values = $current | ConvertFrom-Json
  $values.adminEmail = $email.ToLowerInvariant()
  $values.adminPassword = $password
  $json = $values | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($secretFile, $json, [Text.UTF8Encoding]::new($false))

  & aws secretsmanager put-secret-value `
    --secret-id $SecretArn --region $Region --secret-string "file://$secretFile" `
    --query VersionId --output text
  if ($LASTEXITCODE -ne 0) {
    throw "Could not update the application secret."
  }
  Write-Host "Admin credentials stored in AWS Secrets Manager. No password was printed."
}
finally {
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if (Test-Path -LiteralPath $secretFile) {
    Remove-Item -LiteralPath $secretFile -Force
  }
  $password = $null
  $json = $null
}
