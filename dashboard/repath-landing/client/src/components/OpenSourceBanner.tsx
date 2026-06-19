import { Button } from "@/components/ui/button";
import { Github, BookOpen } from "lucide-react";

export default function OpenSourceBanner() {
  return (
    <section className="py-20 relative overflow-hidden">
      {/* Gradient background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, rgba(124, 58, 237, 0.05) 0%, rgba(124, 58, 237, 0.02) 100%)",
        }}
      />
      <div className="absolute inset-0 bg-[#0a0a0b] -z-10" />

      <div className="container max-w-4xl mx-auto px-4 flex flex-col items-center text-center">
        {/* Stars Counter */}
        <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#27272a] bg-[#111113]">
          <Github className="w-4 h-4 text-[#7c3aed]" />
          <span className="text-sm font-semibold text-white">847 Stars</span>
        </div>

        {/* Title */}
        <h2 className="text-4xl font-semibold text-white mb-4">
          Built in the open
        </h2>

        {/* Body */}
        <p className="text-lg text-[#a1a1aa] mb-8 max-w-2xl leading-relaxed">
          BSL 1.1 license. Converts to Apache 2.0 after 4 years. Self-host
          forever. Commercial license available for SaaS providers.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Button
            variant="outline"
            size="lg"
            className="border-[#27272a] text-[#e4e4e7] hover:bg-[#111113] flex items-center gap-2"
            asChild
          >
            <a
              href="https://github.com/tryrepath/repath"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="w-5 h-5" />
              Star on GitHub
            </a>
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="border-[#27272a] text-[#e4e4e7] hover:bg-[#111113] flex items-center gap-2"
            asChild
          >
            <a href="https://docs.repath.io" target="_blank" rel="noopener noreferrer">
              <BookOpen className="w-5 h-5" />
              Read the docs
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
