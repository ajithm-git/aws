# EventBook

EventBook is a light-themed event discovery and reservation website with user verification, event administration, bookings, cancellations, and booking history.

## Booking flow

1. A visitor browses, searches, sorts, and filters upcoming events.
2. Registration and password reset codes are delivered asynchronously through SQS and the email Lambda worker.
3. A signed-in user selects an event and seat count. The API rechecks availability and reserves seats in a DocumentDB transaction, so concurrent requests cannot oversell capacity.
4. Booking confirmation and cancellation messages are queued; user/admin notifications are published to SNS.
5. Users can review or cancel eligible bookings from their dashboard. Cancellation releases the reserved seats.
6. Admins publish events and can upload images directly to a private S3 bucket using short-lived, size-limited upload policies.

Checkout is intentionally a **demo reservation flow**. It does not charge a card, initiate a UPI payment, or issue a real refund. New bookings have payment status `NotRequired`; collected-revenue reports include only records marked `Paid`.

## AWS deployment architecture

`infra/aws.yaml` deploys a single-region architecture in the selected region (default `ap-south-1`):

- **Amazon S3 + CloudFront** host the frontend and event images. The bucket blocks public access; CloudFront uses Origin Access Control.
- **Amazon API Gateway REST API** exposes the `/api/*` routes over HTTPS and uses a VPC Link to an internal Network Load Balancer.
- **Amazon EC2** runs the existing Express REST API. The instance has no SSH ingress; use AWS Systems Manager Session Manager. Its security group only accepts API traffic from the load balancer.
- **Amazon DocumentDB** stores users, events, and bookings in private subnets. The API connects over TLS, and the database security group only permits the API instance.
- **Amazon SQS** buffers mail jobs and sends repeatedly failing messages to a dead-letter queue.
- **AWS Lambda** consumes SQS messages and sends OTP and booking emails through **Amazon SES**.
- **Amazon SNS** receives operational booking/registration notifications. Subscribe the desired notification recipients to the topic after deployment.
- **AWS Secrets Manager** holds the generated database password and JWT secret, plus the admin credentials configured by the deployment script. EC2 uses an IAM role; no AWS access keys are stored in the app.

EC2 and DocumentDB are provisioned resources and can incur continuous charges. CloudFront, API Gateway, the load balancer, storage, data transfer, SES, and other requests may also be billed. Review AWS pricing and your account quotas before deployment. The default database configuration is a single DocumentDB instance (not a multi-instance high-availability cluster); adjust the template and capacity for production availability requirements.

## Deploy to AWS

Deployment is not automatic. You need PowerShell, Node.js/npm, AWS CLI v2, and an AWS profile with permissions to create the stack's IAM, network, compute, database, messaging, email, and storage resources. Prefer configuring access with IAM Identity Center (`aws configure sso`); **never put AWS access keys in this project or send them in chat**.

Amazon SES must have a verified sender identity in the chosen region. SES sandbox accounts can only send to verified recipients until production sending access is approved.

From the project root:

```powershell
aws sts get-caller-identity --region ap-south-1
.\scripts\deploy.ps1 -Region ap-south-1
```

The script displays the target account and requires you to type `DEPLOY`. It then packages the backend and Lambda worker (excluding `backend/.env` and dependency folders), creates a private deployment-artifact bucket, deploys the CloudFormation stack, uploads the frontend, invalidates CloudFront, and securely prompts for the first admin credentials. It prints the website/API URLs only after successful deployment. If the stack fails, inspect CloudFormation stack events before retrying; already-created billable resources may remain.

The API is served at the API Gateway stage URL followed by `/api` (for example, `https://.../prod/api`). The deployed frontend gets that API origin through a generated `js/config.js`; the checked-in config continues to use `http://localhost:5000` for local development.

To set or rotate the admin credentials later (the admin login applies the managed values on the next successful sign-in):

```powershell
.\scripts\configure-admin.ps1 -SecretArn <ApplicationSecretArn> -Region ap-south-1
```

Subscribe notification recipients to the stack's `NotificationsTopicArn` using the SNS console or AWS CLI. Monitor the email DLQ and CloudWatch logs for delivery failures. Email jobs require a verified SES sender and permitted SES sending; an unconfigured or rejected sender will be retried and ultimately sent to the DLQ.

## Local development

1. Install backend dependencies with `npm ci` from `backend`.
2. Create a local `backend/.env` with `MONGO_URI`, a random `JWT_SECRET` of at least 32 characters, `CORS_ORIGINS` (usually `http://localhost:5500`), and any local email/admin settings needed.
3. Start the API with `npm run dev` from `backend`.
4. Serve the `frontend` directory with a local HTTP server. Opening HTML files directly with `file://` is not supported because browser origin/CORS behavior differs.

For local development, SQS is disabled unless `USE_SQS_QUEUE=true`; the existing SMTP fallback is used for email. Use a MongoDB replica set if exercising transactions locally. The AWS deployment uses DocumentDB and the AWS SDK's default credential chain/IAM role.

## Project layout

```text
backend/        Express API, Mongoose models, routes, AWS helpers
frontend/       Static pages, shared styles, and browser-side workflows
infra/aws.yaml  AWS CloudFormation infrastructure
scripts/        PowerShell deployment and admin-secret setup
```
