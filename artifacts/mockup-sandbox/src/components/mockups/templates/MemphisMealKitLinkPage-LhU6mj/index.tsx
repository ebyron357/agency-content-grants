import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Copy,
  Check,
  Play,
  BookOpen,
  Receipt,
  Mail,
  Instagram,
  Youtube,
  Twitter,
} from "lucide-react";

const GRAY = "#c9c9c9";

/* ---------- tiny memphis SVG bits ---------- */

const Squiggle = ({ className = "", stroke = "#000", width = 90 }) => (
  <svg
    className={className}
    width={width}
    height="22"
    viewBox="0 0 90 22"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2 11c5.5-9 11-9 16.5 0s11 9 16.5 0 11-9 16.5 0 11 9 16.5 0 11-9 16.5 0"
      stroke={stroke}
      strokeWidth="4"
      strokeLinecap="round"
    />
  </svg>
);

const ZigZag = ({ className = "", stroke = "#000" }) => (
  <svg
    className={className}
    width="100%"
    height="14"
    viewBox="0 0 320 14"
    preserveAspectRatio="none"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M0 12 L16 2 L32 12 L48 2 L64 12 L80 2 L96 12 L112 2 L128 12 L144 2 L160 12 L176 2 L192 12 L208 2 L224 12 L240 2 L256 12 L272 2 L288 12 L304 2 L320 12"
      stroke={stroke}
      strokeWidth="3"
    />
  </svg>
);

const Cross = ({ className = "", size = 18, color = "#000" }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 18 18"
    aria-hidden="true"
  >
    <path
      d="M2 2 L16 16 M16 2 L2 16"
      stroke={color}
      strokeWidth="3.5"
      strokeLinecap="round"
    />
  </svg>
);

const HalfCircle = ({ className = "", size = 36, fill = "#000" }) => (
  <svg
    className={className}
    width={size}
    height={size / 2}
    viewBox="0 0 36 18"
    aria-hidden="true"
  >
    <path d="M0 18 A18 18 0 0 1 36 18 Z" fill={fill} />
  </svg>
);

const Triangle = ({
  className = "",
  size = 26,
  fill = "none",
  stroke = "#000",
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 26 26"
    aria-hidden="true"
  >
    <path
      d="M13 2 L24 23 L2 23 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth="3"
      strokeLinejoin="round"
    />
  </svg>
);

/* ---------- data ---------- */

const LINKS = [
  {
    icon: ArrowUpRight,
    label: "Order the Launch Box",
    sub: "4 dinners · serves 2 · $54 flat. That’s it.",
    badge: "NEW",
    href: "#",
    big: true,
  },
  {
    icon: Play,
    label: "Watch us cook box #1",
    sub: "11 min, one take, no jump cuts hiding the mess",
    href: "#",
  },
  {
    icon: BookOpen,
    label: "This week’s 4 recipes",
    sub: "Smashed chickpea melts → 22 minutes",
    href: "#",
  },
  {
    icon: Receipt,
    label: "The honest pricing page",
    sub: "Where every dollar of the $54 actually goes",
    href: "#",
  },
  {
    icon: Mail,
    label: "Tuesday email (1 per week)",
    sub: "A grocery list you can ignore and one good idea",
    href: "#",
  },
];

const SOCIALS = [
  { icon: Instagram, label: "Instagram" },
  { icon: Youtube, label: "YouTube" },
  { icon: Twitter, label: "Twitter" },
];

/* ---------- component ---------- */

export default function App() {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const copyCode = () => {
    try {
      navigator.clipboard?.writeText("FIRSTBOX");
    } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="db-root min-h-screen w-full bg-white text-black">
      <link
        href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Grotesk:wght@400;500;700&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .db-root {
              font-family: 'Space Grotesk', sans-serif;
              background-color: #fff;
              background-image:
                radial-gradient(${GRAY} 1.6px, transparent 1.6px);
              background-size: 26px 26px;
            }
            .db-display { font-family: 'Archivo Black', sans-serif; }
            .hard-shadow { box-shadow: 7px 7px 0 0 #000; }
            .hard-shadow-sm { box-shadow: 4px 4px 0 0 #000; }
            .hard-shadow-gray { box-shadow: 7px 7px 0 0 ${GRAY}; }
            .db-link {
              transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
            }
            .db-link:hover {
              transform: translate(-3px, -3px);
              box-shadow: 10px 10px 0 0 #000;
            }
            .db-link:active {
              transform: translate(2px, 2px);
              box-shadow: 3px 3px 0 0 #000;
            }
            @keyframes db-marquee {
              from { transform: translateX(0); }
              to { transform: translateX(-50%); }
            }
            .db-marquee-track {
              animation: db-marquee 18s linear infinite;
            }
            @keyframes db-spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            .db-spin-slow { animation: db-spin 14s linear infinite; }
            @keyframes db-bob {
              0%, 100% { transform: translateY(0) rotate(-6deg); }
              50% { transform: translateY(-8px) rotate(-2deg); }
            }
            .db-bob { animation: db-bob 4s ease-in-out infinite; }
            ::selection { background: #000; color: #fff; }
          `,
        }}
      />

      {/* ===== top marquee ===== */}
      <div className="w-full border-b-4 border-black bg-black overflow-hidden">
        <div className="db-marquee-track flex whitespace-nowrap py-2">
          {[...Array(2)].map((_, i) => (
            <span key={i} className="flex items-center">
              {[...Array(8)].map((_, j) => (
                <span
                  key={j}
                  className="flex items-center text-white text-xs tracking-[0.3em] db-display"
                >
                  <span className="px-4">NOW SHIPPING</span>
                  <span
                    className="text-base leading-none"
                    style={{ color: GRAY }}
                  >
                    ✕
                  </span>
                  <span className="px-4">BOX №1</span>
                  <span
                    className="text-base leading-none"
                    style={{ color: GRAY }}
                  >
                    ●
                  </span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <main className="mx-auto w-full max-w-[640px] px-5 pb-20 pt-12 relative">
        {/* scattered decorations along the column */}
        <Cross
          className="absolute left-1 top-40 rotate-12"
          color={GRAY}
          size={22}
        />
        <Triangle
          className="absolute right-0 top-72 -rotate-12"
          stroke={GRAY}
        />
        <HalfCircle
          className="absolute -left-2 top-[560px] rotate-90"
          fill={GRAY}
        />
        <Cross className="absolute right-2 top-[760px] -rotate-12" size={16} />
        <Squiggle
          className="absolute left-2 top-[980px] -rotate-6"
          stroke={GRAY}
          width={70}
        />

        {/* ===== header ===== */}
        <motion.header
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative flex flex-col items-center text-center"
        >
          {/* avatar block */}
          <div className="relative">
            <div className="db-spin-slow absolute -right-9 -top-7 h-12 w-12 rounded-full border-[5px] border-black border-dashed" />
            <div className="db-bob absolute -left-12 top-8">
              <Squiggle width={56} />
            </div>
            <div className="hard-shadow relative h-32 w-32 overflow-hidden border-4 border-black bg-white rotate-[-3deg]">
              <img
                src="https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=400&h=400&fit=crop&sat=-100"
                alt="Two hands cooking dinner in a regular kitchen"
                className="h-full w-full object-cover grayscale contrast-125"
              />
            </div>
            <div className="absolute -bottom-3 -right-4 rotate-6 border-[3px] border-black bg-white px-2 py-0.5 text-[11px] db-display tracking-wide hard-shadow-sm">
              EST. TUESDAY
            </div>
          </div>

          <h1 className="db-display mt-9 text-[2.6rem] leading-[0.95] tracking-tight">
            DINNER,
            <br />
            <span className="relative inline-block">
              BASICALLY<span className="text-black">.</span>
              <ZigZag
                className="absolute -bottom-3 left-0 w-full"
                stroke={GRAY}
              />
            </span>
          </h1>

          <p
            className="mt-6 max-w-[440px] text-[15px] leading-relaxed font-medium"
            style={{ color: "#000" }}
          >
            We’re a meal kit for people who are not “foodies.” Four normal,
            genuinely good dinners a week. No 14-step sauces. No ingredients
            you’ll use once and bury in the pantry.
          </p>

          {/* stat strip */}
          <div className="mt-7 flex w-full border-4 border-black bg-white hard-shadow-gray">
            {[
              ["22", "min avg cook"],
              ["$6.75", "per plate"],
              ["0", "weird gadgets"],
            ].map(([num, label], i) => (
              <div
                key={label}
                className={`flex-1 px-2 py-3 text-center ${i < 2 ? "border-r-4 border-black" : ""} ${
                  i === 1 ? "bg-black text-white" : "bg-white"
                }`}
              >
                <div className="db-display text-xl leading-none">{num}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.18em] font-bold opacity-90">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </motion.header>

        {/* ===== launch announcement ===== */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="relative mt-12"
        >
          <div className="absolute -top-4 left-5 z-10 rotate-[-4deg] border-[3px] border-black bg-black px-3 py-1 text-xs db-display tracking-[0.2em] text-white">
            ★ LAUNCH WEEK
          </div>

          <div className="hard-shadow relative border-4 border-black bg-white p-6 pt-8">
            {/* corner pattern */}
            <div
              className="absolute right-0 top-0 h-16 w-16 border-b-4 border-l-4 border-black"
              style={{
                backgroundImage: `repeating-linear-gradient(45deg, ${GRAY} 0 5px, transparent 5px 12px)`,
              }}
            />
            <h2 className="db-display text-2xl leading-tight pr-14">
              Box №1 ships this Friday.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed font-medium">
              We made 500 of them. Not artificial scarcity — that’s honestly all
              the fridge space we could rent. Code below takes{" "}
              <span className="db-display">$10</span> off your first box,
              forever-no-strings, cancel from the same page you ordered on.
            </p>

            {/* promo code */}
            <button
              onClick={copyCode}
              className="db-link group mt-5 flex w-full items-center justify-between border-4 border-black bg-black px-4 py-3 text-left hard-shadow-sm"
              style={{ boxShadow: `4px 4px 0 0 ${GRAY}` }}
            >
              <span className="flex items-center gap-3">
                <span className="db-display text-lg tracking-[0.25em] text-white">
                  FIRSTBOX
                </span>
                <span
                  className="hidden sm:inline text-[11px] uppercase tracking-widest font-bold"
                  style={{ color: GRAY }}
                >
                  $10 off · tap to copy
                </span>
              </span>
              <span className="grid h-9 w-9 place-items-center border-2 border-white bg-white text-black">
                {copied ? (
                  <Check size={18} strokeWidth={3} />
                ) : (
                  <Copy size={18} strokeWidth={2.5} />
                )}
              </span>
            </button>
            <div className="mt-2 h-5 text-center text-[11px] font-bold uppercase tracking-[0.2em]">
              {copied ? "Copied. See? Easy." : ""}
            </div>
          </div>
        </motion.section>

        {/* divider */}
        <div className="mt-10 flex items-center justify-center gap-4">
          <Cross size={14} color={GRAY} />
          <Squiggle width={80} />
          <span className="db-display text-xs tracking-[0.3em]">THE LINKS</span>
          <Squiggle width={80} stroke={GRAY} />
          <Triangle size={16} stroke="#000" />
        </div>

        {/* ===== links ===== */}
        <section className="mt-8 flex flex-col gap-5">
          {LINKS.map((link, i) => {
            const Icon = link.icon;
            const isHover = hovered === i;
            return (
              <motion.a
                key={link.label}
                href={link.href}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.18 + i * 0.07 }}
                className={`db-link hard-shadow group relative flex items-center gap-4 border-4 border-black px-5 py-4 ${
                  link.big ? "bg-black text-white" : "bg-white text-black"
                } ${i % 2 === 0 ? "rotate-[-0.6deg]" : "rotate-[0.6deg]"}`}
              >
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center border-[3px] ${
                    link.big
                      ? "border-white bg-white text-black"
                      : "border-black"
                  } ${!link.big && isHover ? "bg-black text-white" : ""} transition-colors duration-150 ${
                    i % 2 === 0 ? "rounded-full" : ""
                  }`}
                  style={
                    !link.big && !isHover && i % 3 === 1
                      ? { backgroundColor: GRAY }
                      : undefined
                  }
                >
                  <Icon size={22} strokeWidth={2.5} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="db-display text-[15px] leading-snug">
                      {link.label}
                    </span>
                    {link.badge && (
                      <span
                        className="db-display rotate-[-3deg] border-2 border-white px-1.5 py-0.5 text-[10px] tracking-widest"
                        style={{
                          backgroundColor: GRAY,
                          color: "#000",
                          borderColor: "#000",
                        }}
                      >
                        {link.badge}
                      </span>
                    )}
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[12px] font-medium ${link.big ? "" : ""}`}
                    style={{
                      color: link.big ? GRAY : "#000",
                      opacity: link.big ? 1 : 0.65,
                    }}
                  >
                    {link.sub}
                  </span>
                </span>

                <ArrowUpRight
                  size={20}
                  strokeWidth={3}
                  className={`shrink-0 transition-transform duration-150 ${isHover ? "translate-x-1 -translate-y-1" : ""}`}
                />
              </motion.a>
            );
          })}
        </section>

        {/* ===== honest note ===== */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="relative mt-12 rotate-[1deg] border-4 border-dashed border-black p-5"
          style={{ backgroundColor: GRAY }}
        >
          <HalfCircle className="absolute -top-[18px] left-8" />
          <p className="text-[13px] leading-relaxed font-bold">
            Full honesty corner: we’re three people, one rented kitchen, and a
            van named Gravy. If your box is late, it’s because the van is. Reply
            to any email and a real person (probably Dana) answers within a day.
          </p>
          <p className="db-display mt-3 text-xs tracking-[0.2em]">
            — SAM, DANA & PRIYA
          </p>
        </motion.section>

        {/* ===== footer ===== */}
        <footer className="mt-12 flex flex-col items-center gap-6">
          <div className="flex gap-4">
            {SOCIALS.map(({ icon: Icon, label }, i) => (
              <a
                key={label}
                href="#"
                aria-label={label}
                className="db-link hard-shadow-sm grid h-12 w-12 place-items-center border-[3px] border-black bg-white"
                style={
                  i === 1
                    ? { borderRadius: "9999px" }
                    : i === 2
                      ? { backgroundColor: GRAY }
                      : undefined
                }
              >
                <Icon size={20} strokeWidth={2.5} />
              </a>
            ))}
          </div>

          <ZigZag className="w-40" />

          <p
            className="text-center text-[11px] font-bold uppercase tracking-[0.25em]"
            style={{ color: "#000", opacity: 0.55 }}
          >
            dinner-basically.com · made in a regular kitchen · 2025
          </p>
        </footer>
      </main>
    </div>
  );
}
