/**
 * Example: Dashboard with stats, activity table, and quick actions.
 *
 * To use: copy to app/routes/dashboard._index.tsx
 * The loader is already wired — just replace the static data with real queries.
 */
import { Link } from "react-router";
import type { Route } from "../+types/dashboard._index";
import { requireUser } from "~/lib/require-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@starter/ui/components/ui/card";
import { Button } from "@starter/ui/components/ui/button";
import { Users, Building2, Activity, Plus, Settings, FileText, Inbox, Zap } from "lucide-react";

const stats = [
  {
    title: "Total Users",
    value: "0",
    icon: Users,
    noDataLabel: "No data yet",
  },
  {
    title: "Organizations",
    value: "0",
    icon: Building2,
    noDataLabel: "No data yet",
  },
  {
    title: "API Requests",
    value: "0",
    icon: Activity,
    noDataLabel: "No data yet",
  },
];

const quickActions = [
  {
    title: "Add Team Member",
    description: "Invite someone to your organization",
    icon: Plus,
    href: "/dashboard/settings",
  },
  {
    title: "Configure Settings",
    description: "Manage your account preferences",
    icon: Settings,
    href: "/dashboard/settings",
  },
  {
    title: "View Documentation",
    description: "Learn how to use the platform",
    icon: FileText,
    href: "#",
  },
];

export async function loader({ context, request }: Route.LoaderArgs) {
  // Guards before it reads anything, and stays here even though the stats below
  // are static — this file is a copy-paste starting point, so whatever it does
  // is what the next dashboard page will do. The layout loader is not a
  // security boundary in React Router v7 (audit #10).
  await requireUser(context, request);

  // TODO: query real stats from DB
  return {};
}

export default function DashboardWithWidgets() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here&apos;s an overview of your account.
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.noDataLabel}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Activity section with empty state */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest events from your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="font-medium">No recent activity</p>
                <p className="text-sm text-muted-foreground">
                  Activity from your organization will appear here.
                </p>
              </div>
              <Button className="mt-2 min-h-[44px]" asChild>
                <Link to="/dashboard/settings">
                  <Zap className="mr-2 h-4 w-4" aria-hidden="true" />
                  Create your first action
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks to get started</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickActions.map((action) => (
              <Button
                key={action.title}
                variant="outline"
                className="h-auto min-h-[44px] w-full justify-start p-4"
                asChild
              >
                <Link to={action.href}>
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <action.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    </div>
                    <div className="text-left">
                      <div className="font-medium">{action.title}</div>
                      <div className="text-sm text-muted-foreground">{action.description}</div>
                    </div>
                  </div>
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
