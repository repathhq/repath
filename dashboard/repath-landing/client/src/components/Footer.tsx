import { Github, Twitter, MessageCircle } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-[#0a0a0b] border-t border-[#27272a] py-16">
      <div className="container max-w-6xl mx-auto px-4">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663688915055/ZNUV3nN5AZGtoyPiumDGzC/repath-logo-bEWTba2xtxCyXTojwL4aRs.webp"
                alt="Repath"
                className="w-6 h-6"
              />
              <span className="font-bold text-white">Repath</span>
            </div>
            <p className="text-sm text-[#a1a1aa] mb-3">
              Progressive delivery for AI models.
            </p>
            <p className="text-xs text-[#666]">Made with Rust and Python</p>
          </div>

          {/* Product */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Product</h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://docs.repath.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Docs
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Changelog
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/tryrepath/repath"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Roadmap
                </a>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Community</h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="#"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Discord
                </a>
              </li>
              <li>
                <a
                  href="https://twitter.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Twitter / X
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/tryrepath/repath"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Contributing
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-4">Legal</h4>
            <ul className="space-y-3">
              <li>
                <a
                  href="#"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  License
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Privacy
                </a>
              </li>
              <li>
                <a
                  href="#"
                  className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
                >
                  Security
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-[#27272a] pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-[#666]">
            © 2024 Repath, Inc. · tryrepath.com · BSL 1.1
          </p>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/tryrepath/repath"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a1a1aa] hover:text-white transition-colors"
            >
              <Github className="w-5 h-5" />
            </a>
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a1a1aa] hover:text-white transition-colors"
            >
              <Twitter className="w-5 h-5" />
            </a>
            <a
              href="#"
              className="text-[#a1a1aa] hover:text-white transition-colors"
            >
              <MessageCircle className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
