import { Button } from "@/components/ui/button";
import { Github, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-[#0a0a0b]/80 backdrop-blur-md border-b border-[#27272a]"
          : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between py-3 sm:py-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/310519663688915055/ZNUV3nN5AZGtoyPiumDGzC/repath-logo-bEWTba2xtxCyXTojwL4aRs.webp"
            alt="Repath"
            className="w-7 sm:w-8 h-7 sm:h-8"
          />
          <span className="font-bold text-base sm:text-lg text-white">Repath</span>
        </div>

        {/* Center Links */}
        <div className="hidden md:flex items-center gap-8">
          <a
            href="#features"
            className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
          >
            How it works
          </a>
          <a
            href="#comparison"
            className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
          >
            Compare
          </a>
          <a
            href="https://github.com/tryrepath/repath"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>

        {/* Right CTAs */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="hidden sm:flex items-center gap-2 border-[#27272a] text-[#a1a1aa] hover:text-white"
            asChild
          >
            <a
              href="https://github.com/tryrepath/repath"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="w-4 h-4" />
              <span className="hidden sm:inline">Star</span>
            </a>
          </Button>
          <Button
            size="sm"
            className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white flex items-center gap-2 transition-smooth"
          >
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
