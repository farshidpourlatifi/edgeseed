import { FlaskConical, GitBranch, MonitorPlay, Sigma } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@starter/ui/components/ui/card";

// Static snapshot of the pipeline — update alongside major test additions.
const stats = [
  {
    key: "unit",
    label: "Unit tests",
    value: "60",
    detail: "Vitest, 8 suites across packages",
    icon: FlaskConical,
  },
  {
    key: "e2e",
    label: "E2E tests",
    value: "8",
    detail: "Playwright: auth flow + health",
    icon: MonitorPlay,
  },
  {
    key: "mutation",
    label: "Mutation score",
    value: "46%",
    detail: "Stryker, 169 mutants on core logic",
    icon: Sigma,
  },
  {
    key: "ci",
    label: "CI jobs",
    value: "4",
    detail: "quality, drift, e2e, gitleaks",
    icon: GitBranch,
  },
];

export function QualityStats() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.key}>
          <CardHeader className="gap-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <stat.icon className="size-4 text-primary" aria-hidden="true" />
              {stat.label}
            </CardTitle>
            <p className="text-3xl font-semibold tracking-tight">{stat.value}</p>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">{stat.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
