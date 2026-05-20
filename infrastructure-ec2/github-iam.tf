# IAM user that GitHub Actions uses to talk to AWS.
# Permissions are intentionally minimal — extend the policy when you need more.

resource "aws_iam_user" "github_actions" {
  name = "${var.project_name}-github-actions"
  path = "/automation/"

  tags = { Name = "${var.project_name}-github-actions" }
}

data "aws_iam_policy_document" "github_actions" {
  # Lets the workflow confirm auth works.
  statement {
    sid       = "VerifyAuth"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }

  # Read EC2 state (e.g. fetch the current EIP if it ever changes).
  statement {
    sid       = "ReadEc2"
    actions   = ["ec2:Describe*"]
    resources = ["*"]
  }

  # Read CloudWatch logs (useful when debugging deploys from CI).
  statement {
    sid = "ReadCloudWatchLogs"
    actions = [
      "logs:Describe*",
      "logs:Get*",
      "logs:Filter*",
      "logs:StartQuery",
      "logs:StopQuery",
    ]
    resources = ["*"]
  }

  # S3 access scoped to casino-* buckets (reserved for future pg_dump backups).
  statement {
    sid = "BackupsBucketAccess"
    actions = [
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = [
      "arn:aws:s3:::${var.project_name}-*",
      "arn:aws:s3:::${var.project_name}-*/*",
    ]
  }
}

resource "aws_iam_user_policy" "github_actions" {
  name   = "${var.project_name}-github-actions-policy"
  user   = aws_iam_user.github_actions.name
  policy = data.aws_iam_policy_document.github_actions.json
}

# Access keys for the user. Terraform stores these in the state file, so the
# state remains gitignored. Outputs are marked sensitive — read them with:
#   terraform output -raw github_actions_access_key_id
#   terraform output -raw github_actions_secret_access_key
resource "aws_iam_access_key" "github_actions" {
  user = aws_iam_user.github_actions.name
}

output "github_actions_access_key_id" {
  description = "AWS_ACCESS_KEY_ID to paste in GitHub Secrets"
  value       = aws_iam_access_key.github_actions.id
  sensitive   = true
}

output "github_actions_secret_access_key" {
  description = "AWS_SECRET_ACCESS_KEY to paste in GitHub Secrets"
  value       = aws_iam_access_key.github_actions.secret
  sensitive   = true
}
