# Transactional email.
#
# Repath needs to send exactly one class of mail today — password resets —
# and will need rollback alerts next. Both go through SES rather than a third
# party because the compute already runs in this account, so authentication is
# an IAM role rather than another long-lived API key to leak.
#
# ── What still needs a human ────────────────────────────────────────────────
# 1. The DNS records in the `ses_dns_records` output must be added wherever
#    tryrepath.com is actually served from. It is not Route 53 in this
#    account, so Terraform cannot write them. Until they exist, SES will not
#    accept mail from this domain at all.
# 2. The account is in the SES sandbox (200 msgs/day, and delivery only to
#    *verified* addresses). Password resets to real customers need production
#    access, which is a support request in the SES console. Everything below
#    works the moment that is granted; nothing needs redeploying.

resource "aws_ses_domain_identity" "repath" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "repath" {
  domain = aws_ses_domain_identity.repath.domain
}

# Envelope-sender alignment for DMARC. Without this, mail passes DKIM but the
# Return-Path stays on amazonses.com, which some receivers treat as a
# forwarding signal and score down.
resource "aws_ses_domain_mail_from" "repath" {
  domain           = aws_ses_domain_identity.repath.domain
  mail_from_domain = "mail.${var.domain_name}"
}

# Bounces and complaints are the two events that get a sender blocklisted if
# ignored. Routing them to SNS means they are at least recorded and can be
# subscribed to later, rather than silently accumulating against the account's
# reputation.
resource "aws_sns_topic" "ses_events" {
  name = "${var.project_name}-ses-events"
}

resource "aws_ses_identity_notification_topic" "bounce" {
  identity                 = aws_ses_domain_identity.repath.domain
  notification_type        = "Bounce"
  topic_arn                = aws_sns_topic.ses_events.arn
  include_original_headers = false
}

resource "aws_ses_identity_notification_topic" "complaint" {
  identity                 = aws_ses_domain_identity.repath.domain
  notification_type        = "Complaint"
  topic_arn                = aws_sns_topic.ses_events.arn
  include_original_headers = false
}

# The gateway container sends the mail, so the EC2 instance role needs to be
# allowed to. Scoped to this one identity rather than "*" so a compromise of
# the host cannot send mail as any other domain in the account.
data "aws_iam_policy_document" "ec2_ses" {
  statement {
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [aws_ses_domain_identity.repath.arn]
  }
}

resource "aws_iam_role_policy" "ec2_ses" {
  name   = "${var.project_name}-ec2-ses"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_ses.json
}

output "ses_dns_records" {
  description = "Add these at the DNS host for tryrepath.com, then SES can send."
  value = {
    domain_verification = {
      type  = "TXT"
      name  = "_amazonses.${var.domain_name}"
      value = aws_ses_domain_identity.repath.verification_token
    }
    dkim = [
      for t in aws_ses_domain_dkim.repath.dkim_tokens : {
        type  = "CNAME"
        name  = "${t}._domainkey.${var.domain_name}"
        value = "${t}.dkim.amazonses.com"
      }
    ]
    mail_from_mx = {
      type  = "MX"
      name  = aws_ses_domain_mail_from.repath.mail_from_domain
      value = "10 feedback-smtp.${var.aws_region}.amazonses.com"
    }
    mail_from_spf = {
      type  = "TXT"
      name  = aws_ses_domain_mail_from.repath.mail_from_domain
      value = "v=spf1 include:amazonses.com ~all"
    }
  }
}
