import Sidebar from "@/components/Sidebar";

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[--color-bg]">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <main className="flex-1 overflow-y-auto">
          <div className="pl-14 md:pl-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
