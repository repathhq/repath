data "aws_ssm_parameter" "al2023" {
  # Standard (non-minimal) AL2023 — the minimal variant excludes the SSM
  # Agent, which silently breaks SSM Session Manager / send-command access
  # with no error, since port 22 is intentionally closed on this host.
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    dnf update -y
    dnf install -y docker
    systemctl enable --now docker

    # Docker Compose v2 plugin (official upstream release binary)
    mkdir -p /usr/libexec/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
      -o /usr/libexec/docker/cli-plugins/docker-compose
    chmod +x /usr/libexec/docker/cli-plugins/docker-compose

    # Caddy (official upstream release binary) — automatic HTTPS via Let's Encrypt
    curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v2.9.1/caddy_2.9.1_linux_amd64.tar.gz" \
      -o /tmp/caddy.tar.gz
    tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy
    chmod +x /usr/local/bin/caddy

    mkdir -p /etc/caddy /opt/repath
    cat > /etc/caddy/Caddyfile <<'CADDYFILE'
    api.${var.domain_name} {
      reverse_proxy localhost:8080
    }
    CADDYFILE

    cat > /etc/systemd/system/caddy.service <<'UNIT'
    [Unit]
    Description=Caddy
    After=network.target

    [Service]
    ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
    ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
    Restart=on-failure
    User=root

    [Install]
    WantedBy=multi-user.target
    UNIT

    systemctl daemon-reload
    systemctl enable --now caddy

    usermod -aG docker ec2-user
  EOF
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  user_data              = local.user_data

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
  }

  tags = { Name = "${var.project_name}-app" }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = { Name = "${var.project_name}-app" }
}
