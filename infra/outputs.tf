output "ec2_public_ip" {
  value = aws_eip.app.public_ip
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "ecr_repository_urls" {
  value = {
    gateway    = aws_ecr_repository.gateway.repository_url
    controller = aws_ecr_repository.controller.repository_url
    evaluator  = aws_ecr_repository.evaluator.repository_url
  }
}

output "amplify_app_id" {
  value = aws_amplify_app.dashboard.id
}

output "amplify_default_domain" {
  value = aws_amplify_app.dashboard.default_domain
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}

output "amplify_domain_association_certificate_verification_dns_record" {
  value = aws_amplify_domain_association.dashboard.certificate_verification_dns_record
}
