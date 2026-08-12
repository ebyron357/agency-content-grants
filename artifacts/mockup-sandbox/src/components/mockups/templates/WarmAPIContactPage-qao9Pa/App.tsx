import { useState, type ChangeEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Minus,
  Mail,
  MapPin,
  Phone,
  ArrowRight,
  Sparkles,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const TIERS = [
  {
    id: "starter",
    name: "Starter",
    monthly: 0,
    annual: 0,
    blurb: "For side projects and early prototypes.",
    cta: "Start free",
    highlight: false,
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 89,
    annual: 74,
    blurb: "For teams shipping to real customers.",
    cta: "Start 14-day trial",
    highlight: true,
  },
  {
    id: "scale",
    name: "Scale",
    monthly: null,
    annual: null,
    blurb: "For platforms with strict SLAs.",
    cta: "Talk to sales",
    highlight: false,
  },
];

type FeatureValue = string | boolean;

type FeatureRow = {
  label: string;
  values: FeatureValue[];
};

type FeatureGroupData = {
  group: string;
  rows: FeatureRow[];
};

const FEATURE_GROUPS: FeatureGroupData[] = [
  {
    group: "Usage",
    rows: [
      { label: "Monitored API endpoints", values: ["25", "500", "Unlimited"] },
      { label: "Trace retention", values: ["3 days", "30 days", "13 months"] },
      { label: "Events per month", values: ["1M", "50M", "Custom"] },
      { label: "Team seats", values: ["3", "15", "Unlimited"] },
    ],
  },
  {
    group: "Observability",
    rows: [
      { label: "Latency & error dashboards", values: [true, true, true] },
      { label: "Anomaly detection", values: [false, true, true] },
      { label: "Custom alert routing", values: [false, true, true] },
      { label: "Distributed trace replay", values: [false, false, true] },
      { label: "Per-customer SLO tracking", values: [false, false, true] },
    ],
  },
  {
    group: "Security & support",
    rows: [
      { label: "SSO / SAML", values: [false, true, true] },
      { label: "SOC 2 Type II report", values: [false, true, true] },
      { label: "Audit logs", values: ["—", "90 days", "Unlimited"] },
      {
        label: "Support",
        values: [
          "Community",
          "Next business day",
          "Dedicated engineer, 1h SLA",
        ],
      },
      { label: "Uptime SLA", values: ["—", "99.9%", "99.99%"] },
    ],
  },
];

const TOPICS = ["Sales", "Support", "Partnerships", "Press"];

export default function App() {
  const [billing, setBilling] = useState("annual");
  const [topic, setTopic] = useState("Sales");
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    size: "11–50",
    message: "",
  });

  const handleChange =
    (key: keyof typeof form) =>
    (
      event: ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm({ ...form, [key]: event.target.value });

  return (
    <div className="min-h-screen bg-[#F6F2EA] text-[#191613] antialiased selection:bg-[#E8531C] selection:text-[#FFF6EE]">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .font-display { font-family: 'Fraunces', serif; }
            .font-body { font-family: 'Inter', sans-serif; }
            .font-mono { font-family: 'IBM Plex Mono', monospace; }
            .grain {
              background-image: radial-gradient(#191613 0.65px, transparent 0.65px);
              background-size: 22px 22px;
              opacity: 0.05;
            }
            .row-hover:hover td { background: rgba(25,22,19,0.025); }
            input::placeholder, textarea::placeholder { color: #9b938a; }
            .focus-line:focus { outline: none; border-color: #E8531C; }
            @keyframes drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
          `,
        }}
      />

      {/* ============ NAV ============ */}
      <header className="font-body border-b border-[#191613]/10">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#191613] flex items-center justify-center rounded-[6px]">
              <span className="text-[#F6F2EA] font-display text-base leading-none">
                t
              </span>
            </div>
            <span className="font-display text-lg tracking-tight">
              tracelane
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-[13px] text-[#191613]/70">
            <a className="hover:text-[#191613] transition-colors" href="#">
              Product
            </a>
            <a className="hover:text-[#191613] transition-colors" href="#">
              Docs
            </a>
            <a className="hover:text-[#191613] transition-colors" href="#">
              Changelog
            </a>
            <a className="text-[#191613] font-medium" href="#">
              Contact
            </a>
          </nav>
          <button className="text-[13px] font-medium bg-[#191613] text-[#F6F2EA] px-4 py-2 rounded-full hover:bg-[#E8531C] transition-colors">
            Open dashboard
          </button>
        </div>
      </header>

      {/* ============ HERO + CONTACT ============ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grain pointer-events-none" />
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-12 gap-14 relative">
          {/* Left — copy & channels */}
          <div className="lg:col-span-5">
            <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#E8531C] mb-6">
              Contact — avg. reply 2h 14m
            </p>
            <h1 className="font-display text-[clamp(2.8rem,6vw,4.6rem)] leading-[0.98] tracking-[-0.02em] font-medium">
              Tell us where
              <br />
              your API{" "}
              <em className="italic font-normal text-[#E8531C]">hurts.</em>
            </h1>
            <p className="font-body mt-6 text-[15px] leading-relaxed text-[#191613]/65 max-w-md">
              Whether you're tracing your first endpoint or migrating 4,000
              services off a homegrown stack — a real engineer reads every
              message. No ticket queue, no chatbot purgatory.
            </p>

            <div className="mt-12 space-y-0 font-body">
              {[
                {
                  icon: Mail,
                  label: "For everything",
                  value: "hello@tracelane.io",
                },
                {
                  icon: Phone,
                  label: "Existing customers",
                  value: "+1 (415) 980-2241",
                },
                {
                  icon: MapPin,
                  label: "HQ",
                  value: "550 Bryant St, San Francisco",
                },
                {
                  icon: Clock,
                  label: "Office hours",
                  value: "Mon–Fri, 8:00–18:00 PT",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 py-4 border-t border-[#191613]/10 last:border-b group"
                >
                  <item.icon
                    size={16}
                    className="text-[#191613]/40 group-hover:text-[#E8531C] transition-colors"
                    strokeWidth={1.75}
                  />
                  <span className="text-[12px] uppercase tracking-wide text-[#191613]/45 w-36">
                    {item.label}
                  </span>
                  <span className="text-[14px] font-medium">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-10 flex items-center gap-3">
              <div className="flex -space-x-2">
                {[
                  "photo-1560250097-0b93528c311a",
                  "photo-1573496359142-b8d87734a5a2",
                  "photo-1507003211169-0a1dd7228f2d",
                ].map((id) => (
                  <img
                    key={id}
                    src={`https://images.unsplash.com/${id}?w=80&h=80&fit=crop&crop=faces`}
                    alt=""
                    className="w-8 h-8 rounded-full border-2 border-[#F6F2EA] object-cover"
                  />
                ))}
              </div>
              <p className="font-body text-[12px] text-[#191613]/55">
                You'll hear from{" "}
                <span className="font-medium text-[#191613]">
                  Mara, Deniz or Cole
                </span>{" "}
                — not a bot.
              </p>
            </div>
          </div>

          {/* Right — form card */}
          <div className="lg:col-span-7 lg:pl-6">
            <div className="bg-[#FFFCF6] border border-[#191613]/12 rounded-2xl shadow-[0_24px_60px_-30px_rgba(25,22,19,0.35)] p-7 lg:p-10 relative">
              <AnimatePresence mode="wait">
                {!submitted ? (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, y: -8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSubmitted(true);
                    }}
                    className="font-body"
                  >
                    {/* topic pills */}
                    <div className="flex flex-wrap gap-2 mb-8">
                      {TOPICS.map((t) => (
                        <button
                          type="button"
                          key={t}
                          onClick={() => setTopic(t)}
                          className={`text-[13px] px-4 py-1.5 rounded-full border transition-all ${
                            topic === t
                              ? "bg-[#191613] text-[#F6F2EA] border-[#191613]"
                              : "border-[#191613]/20 text-[#191613]/60 hover:border-[#191613]/50 hover:text-[#191613]"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-6">
                      <div>
                        <label className="block text-[12px] uppercase tracking-wide text-[#191613]/50 mb-2">
                          Full name
                        </label>
                        <input
                          required
                          value={form.name}
                          onChange={handleChange("name")}
                          placeholder="Ada Okafor"
                          className="focus-line w-full bg-transparent border-b border-[#191613]/25 pb-2 text-[15px] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] uppercase tracking-wide text-[#191613]/50 mb-2">
                          Work email
                        </label>
                        <input
                          required
                          type="email"
                          value={form.email}
                          onChange={handleChange("email")}
                          placeholder="ada@layerline.dev"
                          className="focus-line w-full bg-transparent border-b border-[#191613]/25 pb-2 text-[15px] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] uppercase tracking-wide text-[#191613]/50 mb-2">
                          Company
                        </label>
                        <input
                          value={form.company}
                          onChange={handleChange("company")}
                          placeholder="Layerline"
                          className="focus-line w-full bg-transparent border-b border-[#191613]/25 pb-2 text-[15px] transition-colors"
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] uppercase tracking-wide text-[#191613]/50 mb-2">
                          Engineering team size
                        </label>
                        <select
                          value={form.size}
                          onChange={handleChange("size")}
                          className="focus-line w-full bg-transparent border-b border-[#191613]/25 pb-2 text-[15px] transition-colors cursor-pointer"
                        >
                          {["1–10", "11–50", "51–200", "201–1000", "1000+"].map(
                            (s) => (
                              <option key={s}>{s}</option>
                            ),
                          )}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[12px] uppercase tracking-wide text-[#191613]/50 mb-2">
                          What are you trying to solve?
                        </label>
                        <textarea
                          required
                          rows={4}
                          value={form.message}
                          onChange={handleChange("message")}
                          placeholder="We're seeing p99 spikes on our checkout service every Friday and our current tooling can't tell us why…"
                          className="focus-line w-full bg-transparent border-b border-[#191613]/25 pb-2 text-[15px] leading-relaxed resize-none transition-colors"
                        />
                      </div>
                    </div>

                    <div className="mt-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <p className="text-[12px] text-[#191613]/45 max-w-[260px]">
                        We never share your details. Read our{" "}
                        <a
                          href="#"
                          className="underline underline-offset-2 hover:text-[#E8531C]"
                        >
                          privacy note
                        </a>
                        .
                      </p>
                      <button
                        type="submit"
                        className="group inline-flex items-center gap-2 bg-[#E8531C] text-[#FFF6EE] text-[14px] font-medium pl-6 pr-5 py-3 rounded-full hover:bg-[#191613] transition-colors"
                      >
                        Send message
                        <ArrowUpRight
                          size={16}
                          className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </button>
                    </div>
                  </motion.form>
                ) : (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-body py-16 text-center"
                  >
                    <div className="mx-auto w-12 h-12 rounded-full bg-[#E8531C]/10 flex items-center justify-center mb-6">
                      <Check className="text-[#E8531C]" size={22} />
                    </div>
                    <h3 className="font-display text-3xl tracking-tight mb-3">
                      On its way.
                    </h3>
                    <p className="text-[14px] text-[#191613]/60 max-w-sm mx-auto leading-relaxed">
                      Thanks, {form.name.split(" ")[0] || "friend"}. Your note
                      about{" "}
                      <span className="font-medium text-[#191613]">
                        {topic.toLowerCase()}
                      </span>{" "}
                      just landed in our inbox — expect a reply at{" "}
                      <span className="font-medium text-[#191613]">
                        {form.email}
                      </span>{" "}
                      within a couple of hours.
                    </p>
                    <button
                      onClick={() => setSubmitted(false)}
                      className="mt-8 text-[13px] underline underline-offset-4 text-[#191613]/60 hover:text-[#E8531C] transition-colors"
                    >
                      Send another message
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PRICING COMPARISON ============ */}
      <section className="bg-[#191613] text-[#F6F2EA]">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-20 lg:py-28">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-14">
            <div>
              <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#E8531C] mb-5">
                Pricing — no surprises
              </p>
              <h2 className="font-display text-[clamp(2.2rem,4.5vw,3.6rem)] leading-[1.02] tracking-[-0.02em] font-medium">
                Compare every plan,
                <br />
                line by line.
              </h2>
            </div>

            {/* billing toggle */}
            <div className="font-body flex items-center gap-3 self-start lg:self-auto">
              <span
                className={`text-[13px] transition-colors ${billing === "monthly" ? "text-[#F6F2EA]" : "text-[#F6F2EA]/45"}`}
              >
                Monthly
              </span>
              <button
                onClick={() =>
                  setBilling(billing === "monthly" ? "annual" : "monthly")
                }
                className="relative w-12 h-6 rounded-full bg-[#F6F2EA]/15 border border-[#F6F2EA]/20"
                aria-label="Toggle billing period"
              >
                <motion.div
                  animate={{ x: billing === "annual" ? 24 : 2 }}
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-[#E8531C]"
                />
              </button>
              <span
                className={`text-[13px] transition-colors ${billing === "annual" ? "text-[#F6F2EA]" : "text-[#F6F2EA]/45"}`}
              >
                Annual <span className="text-[#E8531C]">−17%</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto -mx-6 px-6 lg:mx-0 lg:px-0">
            <table className="w-full min-w-[760px] font-body border-collapse">
              {/* tier header */}
              <thead>
                <tr>
                  <th className="text-left align-bottom pb-8 w-[28%]"></th>
                  {TIERS.map((tier) => (
                    <th
                      key={tier.id}
                      className={`text-left align-bottom pb-8 px-6 w-[24%] ${
                        tier.highlight ? "bg-[#F6F2EA]/[0.05] rounded-t-xl" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <span className="font-display text-2xl font-medium tracking-tight">
                          {tier.name}
                        </span>
                        {tier.highlight && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium bg-[#E8531C] text-[#FFF6EE] px-2 py-[3px] rounded-full">
                            <Sparkles size={10} /> Popular
                          </span>
                        )}
                      </div>
                      <div className="mb-2 h-12 flex items-end">
                        {tier.monthly === null ? (
                          <span className="font-display text-3xl">Custom</span>
                        ) : (
                          <div className="flex items-baseline gap-1">
                            <span className="font-display text-4xl tracking-tight">
                              $
                              {billing === "annual"
                                ? tier.annual
                                : tier.monthly}
                            </span>
                            <span className="text-[12px] text-[#F6F2EA]/50">
                              /seat·mo
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-[12px] leading-relaxed text-[#F6F2EA]/55 font-normal mb-5 max-w-[200px]">
                        {tier.blurb}
                      </p>
                      <button
                        className={`w-full text-[13px] font-medium py-2.5 rounded-full transition-colors flex items-center justify-center gap-1.5 ${
                          tier.highlight
                            ? "bg-[#E8531C] text-[#FFF6EE] hover:bg-[#F6F2EA] hover:text-[#191613]"
                            : "border border-[#F6F2EA]/25 hover:border-[#F6F2EA] text-[#F6F2EA]"
                        }`}
                      >
                        {tier.cta} <ArrowRight size={14} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {FEATURE_GROUPS.map((group) => (
                  <FeatureGroup key={group.group} group={group} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="font-body text-[12px] text-[#F6F2EA]/40 mt-8">
            All prices in USD. Annual plans billed up front. Scale pricing
            typically lands between $35k–$240k/yr depending on event volume —{" "}
            <a
              href="#"
              className="underline underline-offset-2 hover:text-[#E8531C] transition-colors"
            >
              use the form above
            </a>{" "}
            and we'll quote within a day.
          </p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="font-body bg-[#F6F2EA] border-t border-[#191613]/10">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#191613] flex items-center justify-center rounded-[5px]">
              <span className="text-[#F6F2EA] font-display text-sm leading-none">
                t
              </span>
            </div>
            <span className="text-[13px] text-[#191613]/55">
              © 2025 Tracelane Systems, Inc.
            </span>
          </div>
          <div className="flex gap-6 text-[13px] text-[#191613]/55">
            <a href="#" className="hover:text-[#E8531C] transition-colors">
              Status
            </a>
            <a href="#" className="hover:text-[#E8531C] transition-colors">
              Security
            </a>
            <a href="#" className="hover:text-[#E8531C] transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-[#E8531C] transition-colors">
              X / Twitter
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureGroup({ group }: { group: FeatureGroupData }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-10 pb-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#E8531C]">
            {group.group}
          </span>
        </td>
      </tr>
      {group.rows.map((row, i) => (
        <tr key={i} className="row-hover border-t border-[#F6F2EA]/[0.08]">
          <td className="py-4 pr-6 text-[14px] text-[#F6F2EA]/80">
            {row.label}
          </td>
          {row.values.map((v, j) => (
            <td
              key={j}
              className={`py-4 px-6 text-[14px] ${j === 1 ? "bg-[#F6F2EA]/[0.05]" : ""} ${
                FEATURE_GROUPS[FEATURE_GROUPS.length - 1] === group &&
                i === group.rows.length - 1 &&
                j === 1
                  ? "rounded-b-xl"
                  : ""
              }`}
            >
              {v === true ? (
                <Check size={16} className="text-[#E8531C]" strokeWidth={2.5} />
              ) : v === false ? (
                <Minus size={16} className="text-[#F6F2EA]/25" />
              ) : (
                <span
                  className={j === 1 ? "text-[#F6F2EA]" : "text-[#F6F2EA]/70"}
                >
                  {v}
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
