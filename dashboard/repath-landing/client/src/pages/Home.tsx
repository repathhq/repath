import Navigation from "@/components/Navigation";
import Hero from "@/components/Hero";
import ProblemSection from "@/components/ProblemSection";
import HowItWorks from "@/components/HowItWorks";
import FeaturesSection from "@/components/FeaturesSection";
import ComparisonTable from "@/components/ComparisonTable";
import QuickStart from "@/components/QuickStart";
import OpenSourceBanner from "@/components/OpenSourceBanner";
import Footer from "@/components/Footer";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  // If user is authenticated, redirect to dashboard
  if (isAuthenticated && user) {
    window.location.href = "/dashboard";
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0b]">
      <Navigation />
      <main>
        <Hero />
        <ProblemSection />
        <HowItWorks />
        <FeaturesSection />
        <ComparisonTable />
        <QuickStart />
        <OpenSourceBanner />
      </main>
      <Footer />
    </div>
  );
}
