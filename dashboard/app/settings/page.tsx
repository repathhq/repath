"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  User, Key, Bell, Shield, Trash2, Copy, Check,
  ChevronRight, AlertTriangle, ExternalLink, RefreshCw,
  CreditCard, Globe, Webhook, Eye, EyeOff
} from "lucide-react";

const FONT = { fontFamily: "'Inter', system-ui, sans-serif" };

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <div className="mb-5 pb-4 border-b border-gray-100">
        <h2 className="text-[16px] font-semibold text-gray-900">{title}</h2>
        {desc && <p className="text-[13px] text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-8 py-4 border-b border-gray-50 last:border-0">
      <div className="w-44 shrink-0 pt-1">
        <p className="text-[13px] font-medium text-gray-700">{label}</p>
        {hint && <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Input({ defaultValue, placeholder, type = "text" }: { defaultValue?: string; placeholder?: string; type?: string }) {
  return (
    <input
      defaultValue={defaultValue}
      placeholder={placeholder}
      type={type}
      className="w-full max-w-sm px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all bg-white"
    />
  );
}

function Toggle({ defaultChecked = false, label }: { defaultChecked?: boolean; label?: string }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => setOn(!on)}
        className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${on ? "bg-violet-600" : "bg-gray-200"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${on ? "translate-x-4" : "translate-x-0"}`} />
      </button>
      {label && <span className="text-[13px] text-gray-600">{label}</span>}
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 max-w-sm">
      <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
        <code className="text-[13px] font-mono text-gray-700 truncate flex-1">{value}</code>
      </div>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-gray-400" />}
      </button>
    </div>
  );
}

const navItems = [
  { id: "profile",      label: "Profile",          icon: User },
  { id: "api",          label: "API Keys",          icon: Key },
  { id: "gateway",      label: "Gateway",           icon: Globe },
  { id: "notifications",label: "Notifications",     icon: Bell },
  { id: "webhooks",     label: "Webhooks",          icon: Webhook },
  { id: "security",     label: "Security",          icon: Shield },
  { id: "billing",      label: "Billing",           icon: CreditCard },
  { id: "danger",       label: "Danger Zone",       icon: Trash2 },
];

export default function SettingsPage() {
  const [active, setActive] = useState("profile");
  const [showSecret, setShowSecret] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  return (
    <div className="min-h-screen bg-white" style={FONT}>
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-3.5 flex items-center justify-between sticky top-0 bg-white z-40">
        <div className="flex items-center gap-4">
          <Link href="/rollouts" className="flex items-center gap-2.5">
            <Image src="/logo-icon.png" alt="Repath" width={28} height={28} className="rounded-lg" />
            <span className="font-bold text-[17px] text-gray-900">Repath</span>
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-[14px] text-gray-600 font-medium">Settings</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/rollouts" className="text-[13px] text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1.5">
            <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Dashboard
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10 flex gap-10">
        {/* Sidebar */}
        <aside className="w-52 shrink-0">
          <nav className="space-y-0.5">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
                  active === item.id
                    ? item.id === "danger"
                      ? "bg-red-50 text-red-600"
                      : "bg-violet-50 text-violet-700"
                    : item.id === "danger"
                    ? "text-red-500 hover:bg-red-50"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">

          {/* ── PROFILE ── */}
          {active === "profile" && (
            <div>
              <Section title="Profile" desc="Your personal information and display settings.">
                <Field label="Full name">
                  <Input defaultValue="Avinash" placeholder="Your name" />
                </Field>
                <Field label="Email address" hint="Used for billing and alerts.">
                  <Input defaultValue="tejassriavinasha@gmail.com" type="email" />
                </Field>
                <Field label="Company" hint="Optional.">
                  <Input placeholder="Your company name" />
                </Field>
                <Field label="Time zone">
                  <select className="px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white max-w-sm w-full">
                    <option>Asia/Kolkata (IST, UTC+5:30)</option>
                    <option>America/New_York (EST, UTC-5)</option>
                    <option>Europe/London (GMT, UTC+0)</option>
                    <option>Asia/Singapore (SGT, UTC+8)</option>
                  </select>
                </Field>
              </Section>
              <button className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                Save changes
              </button>
            </div>
          )}

          {/* ── API KEYS ── */}
          {active === "api" && (
            <div>
              <Section title="API Keys" desc="Use these to authenticate with the Repath management API.">
                <Field label="API Token" hint="Keep this secret. Rotate if compromised.">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 max-w-sm">
                      <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
                        <code className="text-[13px] font-mono text-gray-700 truncate flex-1">
                          {showSecret ? "3f6fb762c63146ad52cb80a..." : "repath_••••••••••••••••••••"}
                        </code>
                        <button onClick={() => setShowSecret(!showSecret)} className="text-gray-400 hover:text-gray-700">
                          {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText("3f6fb762c63146ad52cb80a09b262dbbf52b88ddb33633ada05426b16128365b")}
                        className="p-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                      >
                        <Copy className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                    <button className="flex items-center gap-1.5 text-[13px] text-amber-600 hover:text-amber-700 font-medium">
                      <RefreshCw className="w-3.5 h-3.5" /> Rotate token
                    </button>
                  </div>
                </Field>
                <Field label="Tenant ID" hint="Pass as X-Repath-Tenant-Id header.">
                  <CopyField value="ten_9be07433" />
                </Field>
              </Section>

              <Section title="Provider API Keys" desc="Keys used by Repath to call LLM providers on your behalf.">
                <Field label="OpenAI API Key">
                  <div className="flex items-center gap-2 max-w-sm">
                    <input type="password" placeholder="sk-proj-..." defaultValue="sk-proj-x_mtfJxWL..."
                      className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
                  </div>
                </Field>
                <Field label="Anthropic API Key">
                  <input type="password" placeholder="sk-ant-..."
                    className="px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white max-w-sm w-full" />
                </Field>
                <Field label="OpenRouter API Key" hint="Used as last-resort fallback if primary providers are down.">
                  <input type="password" placeholder="sk-or-v1-..."
                    className="px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white max-w-sm w-full" />
                </Field>
              </Section>
              <button className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                Save keys
              </button>
            </div>
          )}

          {/* ── GATEWAY ── */}
          {active === "gateway" && (
            <div>
              <Section title="Gateway" desc="Your unique Repath gateway URL. Point your app here.">
                <Field label="Gateway URL" hint="Use this as base_url in your OpenAI client.">
                  <CopyField value="https://repath-gateway.fly.dev/v1" />
                </Field>
                <Field label="Health check">
                  <div className="flex items-center gap-3">
                    <a href="https://repath-gateway.fly.dev/health" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[13px] text-violet-600 hover:underline font-medium">
                      https://repath-gateway.fly.dev/health <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <span className="flex items-center gap-1.5 text-[12px] text-emerald-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Operational
                    </span>
                  </div>
                </Field>
                <Field label="Region">
                  <span className="text-[14px] text-gray-700 font-medium">Singapore (sin) — ap-southeast-1</span>
                </Field>
                <Field label="Request timeout" hint="Max seconds to wait for provider response.">
                  <div className="flex items-center gap-2">
                    <input type="number" defaultValue={60} className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
                    <span className="text-[13px] text-gray-500">seconds</span>
                  </div>
                </Field>
                <Field label="Controller interval" hint="How often the controller checks metrics.">
                  <div className="flex items-center gap-2">
                    <input type="number" defaultValue={30} className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
                    <span className="text-[13px] text-gray-500">seconds</span>
                  </div>
                </Field>
              </Section>
              <button className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                Save gateway settings
              </button>
            </div>
          )}

          {/* ── NOTIFICATIONS ── */}
          {active === "notifications" && (
            <div>
              <Section title="Email Notifications" desc="Choose which events trigger email alerts.">
                {[
                  { label: "Rollback triggered",    hint: "When auto-rollback fires due to quality drop.", default: true },
                  { label: "Rollout promoted",       hint: "When a rollout reaches 100% successfully.",    default: true },
                  { label: "Rollout advanced",       hint: "When traffic advances to the next step.",      default: false },
                  { label: "Provider outage",        hint: "When a provider returns errors > 20%.",        default: true },
                  { label: "Trial expiring",         hint: "3 days before your trial ends.",               default: true },
                  { label: "Weekly summary",         hint: "Weekly digest of rollout activity.",           default: false },
                ].map(item => (
                  <Field key={item.label} label={item.label} hint={item.hint}>
                    <Toggle defaultChecked={item.default} />
                  </Field>
                ))}
              </Section>

              <Section title="Slack Notifications" desc="Send alerts to a Slack channel.">
                <Field label="Webhook URL">
                  <input type="url" placeholder="https://hooks.slack.com/services/..."
                    className="px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white max-w-sm w-full" />
                </Field>
                <Field label="Alert channel">
                  <Input placeholder="#ai-deployments" />
                </Field>
              </Section>
              <button className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                Save notifications
              </button>
            </div>
          )}

          {/* ── WEBHOOKS ── */}
          {active === "webhooks" && (
            <div>
              <Section title="Webhooks" desc="Repath will POST to your endpoint on rollout events.">
                <Field label="Endpoint URL">
                  <Input placeholder="https://your-app.com/webhooks/repath" />
                </Field>
                <Field label="Signing secret" hint="Used to verify webhook signatures.">
                  <CopyField value="whsec_••••••••••••••••" />
                </Field>
                <Field label="Events to send">
                  <div className="space-y-2">
                    {["rollback", "advance", "promote", "provider_outage"].map(ev => (
                      <label key={ev} className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" defaultChecked className="rounded border-gray-300 text-violet-600 focus:ring-violet-500" />
                        <span className="text-[13px] font-mono text-gray-700">{ev}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </Section>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-6">
                <p className="text-[12px] text-gray-500 font-mono">
                  Verify with: <code className="text-violet-600">X-Repath-Signature: sha256=...</code>
                </p>
              </div>
              <button className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                Save webhook
              </button>
            </div>
          )}

          {/* ── SECURITY ── */}
          {active === "security" && (
            <div>
              <Section title="Password" desc="Change your account password.">
                <Field label="Current password">
                  <Input type="password" placeholder="Current password" />
                </Field>
                <Field label="New password">
                  <Input type="password" placeholder="At least 8 characters" />
                </Field>
                <Field label="Confirm new password">
                  <Input type="password" placeholder="Repeat new password" />
                </Field>
              </Section>

              <Section title="Sessions" desc="Active login sessions on your account.">
                <div className="space-y-3">
                  {[
                    { device: "MacBook Air — Chrome", location: "Mumbai, India", time: "Active now", current: true },
                    { device: "iPhone — Safari", location: "Mumbai, India", time: "2 hours ago", current: false },
                  ].map(s => (
                    <div key={s.device} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-[13px] font-medium text-gray-900 flex items-center gap-2">
                          {s.device}
                          {s.current && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">Current</span>}
                        </p>
                        <p className="text-[12px] text-gray-400 mt-0.5">{s.location} · {s.time}</p>
                      </div>
                      {!s.current && (
                        <button className="text-[12px] text-red-500 hover:text-red-700 font-medium">Revoke</button>
                      )}
                    </div>
                  ))}
                </div>
              </Section>

              <button className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                Update password
              </button>
            </div>
          )}

          {/* ── BILLING ── */}
          {active === "billing" && (
            <div>
              <Section title="Current Plan">
                <div className="rounded-xl border border-gray-200 p-5 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[14px] font-semibold text-gray-900">Trial Plan</p>
                      <p className="text-[12px] text-gray-500 mt-0.5">7-day free trial · 1,000 evaluations included</p>
                    </div>
                    <Link href="/billing" className="px-3 py-1.5 border border-violet-200 text-violet-600 text-[13px] font-medium rounded-lg hover:bg-violet-50 transition-colors">
                      Upgrade plan
                    </Link>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500 rounded-full" style={{ width: "23%" }} />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">230 / 1,000 evaluations used this month</p>
                </div>
              </Section>

              <Section title="Payment Method" desc="Manage your payment details.">
                <Field label="Payment method">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-[13px] text-gray-600">
                      <CreditCard className="w-4 h-4 text-gray-400" />
                      No payment method added
                    </div>
                    <Link href="/billing" className="text-[13px] text-violet-600 hover:underline font-medium">Add method</Link>
                  </div>
                </Field>
                <Field label="Billing email">
                  <Input defaultValue="tejassriavinasha@gmail.com" type="email" />
                </Field>
                <Field label="Country">
                  <select className="px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white max-w-sm w-full">
                    <option>India</option>
                    <option>United States</option>
                    <option>United Kingdom</option>
                    <option>Singapore</option>
                    <option>Australia</option>
                  </select>
                </Field>
              </Section>

              <Section title="Invoices" desc="Download your past invoices.">
                <p className="text-[13px] text-gray-400 py-4">No invoices yet. Invoices will appear here after your first payment.</p>
              </Section>
            </div>
          )}

          {/* ── DANGER ZONE ── */}
          {active === "danger" && (
            <div>
              <Section title="Danger Zone" desc="Irreversible actions. Be careful.">

                <div className="rounded-xl border border-red-200 bg-red-50 p-5 mb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[14px] font-semibold text-gray-900">Pause all rollouts</p>
                      <p className="text-[13px] text-gray-500 mt-0.5">
                        Immediately pauses all active rollouts. Traffic stays at current split. Resumable.
                      </p>
                    </div>
                    <button className="shrink-0 px-3 py-1.5 border border-amber-300 text-amber-700 text-[13px] font-medium rounded-lg hover:bg-amber-50 transition-colors bg-white">
                      Pause all
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50 p-5 mb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[14px] font-semibold text-gray-900">Reset all rollouts to baseline</p>
                      <p className="text-[13px] text-gray-500 mt-0.5">
                        Sets all active canary rollouts to 0% candidate traffic. Irreversible. Resets rollout step progress.
                      </p>
                    </div>
                    <button className="shrink-0 px-3 py-1.5 border border-red-300 text-red-700 text-[13px] font-medium rounded-lg hover:bg-red-100 transition-colors bg-white">
                      Reset all
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border-2 border-red-300 p-5">
                  <div className="flex items-start gap-3 mb-5">
                    <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" strokeWidth={2} />
                    <div>
                      <p className="text-[14px] font-semibold text-red-700">Delete account</p>
                      <p className="text-[13px] text-gray-600 mt-0.5">
                        Permanently deletes your account, all rollouts, evaluations, and data. This cannot be undone.
                        Your gateway URL will stop working immediately.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[12px] text-gray-500">
                      Type <strong className="font-mono text-red-600">delete my account</strong> to confirm:
                    </p>
                    <input
                      type="text"
                      value={deleteConfirm}
                      onChange={e => setDeleteConfirm(e.target.value)}
                      placeholder="delete my account"
                      className="w-full max-w-xs px-3 py-2 rounded-lg border border-red-200 text-[13px] font-mono text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                    />
                    <button
                      disabled={deleteConfirm !== "delete my account"}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-[13px] font-semibold rounded-lg hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" /> Delete my account permanently
                    </button>
                  </div>
                </div>

              </Section>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
