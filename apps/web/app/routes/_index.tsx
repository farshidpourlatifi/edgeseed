import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@starter/ui/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@starter/ui/components/ui/card";
import { ThemeToggle } from "@starter/ui/components/ui/theme-toggle";
import { Menu, X, Zap, Shield, Users, BarChart3, Globe, Layers } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Optimized for speed with edge computing and smart caching strategies.",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description: "Bank-grade encryption and compliance with SOC2, GDPR, and HIPAA.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Built-in tools for seamless team communication and project management.",
  },
  {
    icon: BarChart3,
    title: "Advanced Analytics",
    description: "Real-time insights and customizable dashboards for data-driven decisions.",
  },
  {
    icon: Globe,
    title: "Global Scale",
    description: "Deploy worldwide with automatic scaling and 99.99% uptime guarantee.",
  },
  {
    icon: Layers,
    title: "Flexible Integrations",
    description: "Connect with 100+ tools and build custom workflows with our API.",
  },
];

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Layers className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">Starter</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <a
            href="#features"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Features
          </a>
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <ThemeToggle />
          <Link
            to="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign In
          </Link>
          <Button asChild>
            <Link to="/register">Get Started</Link>
          </Button>
        </div>

        {/* Mobile menu */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-11 w-11 items-center justify-center rounded-md md:hidden"
          aria-label={isOpen ? "Close menu" : "Open menu"}
        >
          {isOpen ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Menu className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Mobile menu panel */}
      {isOpen && (
        <div className="border-t bg-background px-4 py-6 md:hidden">
          <nav className="flex flex-col gap-2">
            <a
              href="#features"
              className="flex min-h-[44px] items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setIsOpen(false)}
            >
              Features
            </a>
          </nav>
          <hr className="my-4 border-border" />
          <div className="flex flex-col gap-3">
            <div className="flex min-h-[44px] items-center justify-between px-1">
              <span className="text-sm text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <Button variant="outline" className="h-11" asChild>
              <Link to="/login" onClick={() => setIsOpen(false)}>
                Sign In
              </Link>
            </Button>
            <Button className="h-11" asChild>
              <Link to="/register" onClick={() => setIsOpen(false)}>
                Get Started
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-background to-background" />
      <div className="container mx-auto px-4 py-24 md:py-32 lg:py-40">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
            Build your next <span className="text-primary">SaaS product</span> in record time
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground md:text-xl">
            The complete starter kit for modern web applications. Authentication, payments, and
            beautiful UI components out of the box.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild>
              <Link to="/register">Start Building Free</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#features">Learn More</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="features" className="border-t bg-muted/30 py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to ship faster
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Packed with powerful features to help you build, deploy, and scale your application.
          </p>
        </div>
        <div className="mx-auto mt-16 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card key={feature.title} className="border-0 bg-background shadow-sm">
              <CardHeader>
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
                <CardDescription className="text-base">{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
            <Layers className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Starter
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="#"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Privacy
          </a>
          <a
            href="#"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Terms
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
      </main>
      <Footer />
    </div>
  );
}
