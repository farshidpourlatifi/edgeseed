import { CopyCommand } from "./copy-command";
import { GITHUB_URL } from "./site";

const steps = [
  {
    title: "Clone the starter",
    description:
      "Clone with full history so you can keep pulling starter updates through the upstream remote later.",
    command: `git clone ${GITHUB_URL} my-app`,
  },
  {
    title: "Make it yours",
    description:
      "Installs dependencies, wires the git hooks, and stamps your product name onto the Workers and config.",
    command: "pnpm install && pnpm init:product my-app",
  },
  {
    title: "Apply migrations and seed",
    description: "Runs Drizzle migrations against local D1 and loads a demo user and organization.",
    command: "pnpm db:migrate && pnpm db:seed",
  },
  {
    title: "Start developing",
    description: "Boots the app at http://localhost:5173 with hot reload against local D1.",
    command: "pnpm dev",
  },
];

export function GettingStarted() {
  return (
    <section id="getting-started" className="scroll-mt-16 border-b">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-4 py-20 sm:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Running locally in four commands
          </h2>
          <p className="text-base leading-relaxed text-muted-foreground text-pretty">
            No dashboard clicking required. Everything below works against local D1 before you
            deploy.
          </p>
        </div>

        <ol className="flex flex-col gap-8">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3 sm:flex-row sm:gap-5">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-sm font-medium"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                    {step.description}
                  </p>
                </div>
                <CopyCommand command={step.command} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
