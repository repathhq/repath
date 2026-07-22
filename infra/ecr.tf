locals {
  ecr_services = ["gateway", "controller", "evaluator"]
}

resource "aws_ecr_repository" "gateway" {
  name                 = "${var.project_name}/gateway"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_repository" "controller" {
  name                 = "${var.project_name}/controller"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_repository" "evaluator" {
  name                 = "${var.project_name}/evaluator"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}

# Keep only the 5 most recent tagged images per repo — bounds storage cost.
resource "aws_ecr_lifecycle_policy" "expire" {
  for_each   = { gateway = aws_ecr_repository.gateway.name, controller = aws_ecr_repository.controller.name, evaluator = aws_ecr_repository.evaluator.name }
  repository = each.value

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}
