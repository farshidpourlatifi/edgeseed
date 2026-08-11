import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/dashboard";
import { authClient } from "~/lib/auth-client";
import { requireUser } from "~/lib/require-user";
import { cn } from "@starter/ui/lib/utils";
import { Button } from "@starter/ui/components/ui/button";
import { Separator } from "@starter/ui/components/ui/separator";
import { Avatar, AvatarFallback } from "@starter/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@starter/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@starter/ui/components/ui/tooltip";
import { ThemeToggle } from "@starter/ui/components/ui/theme-toggle";
import {
  LayoutDashboard,
  Settings,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  User,
  Menu,
  Building2,
  ChevronsUpDown,
  Plus,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { PRODUCT_NAME } from "@starter/config/product";
import { BrandMark } from "~/components/brand/brand-mark";

export async function loader({ context, request }: Route.LoaderArgs) {
  // Guards this loader's own data only. Every child loader calls `requireUser`
  // itself — children run in parallel with this one, so it cannot protect them
  // (audit #10).
  const session = await requireUser(context, request);

  // Get user's organizations
  let organizations: Array<{ id: string; name: string; slug: string }> = [];
  try {
    const orgs = await context.auth.api.listOrganizations({
      headers: request.headers,
    });
    if (orgs) {
      organizations = orgs.map((o: { id: string; name: string; slug: string | null }) => ({
        id: o.id,
        name: o.name,
        slug: o.slug ?? o.id,
      }));
    }
  } catch {
    // Organizations not available yet
  }

  return {
    user: session.user,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    organizations,
  };
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

function OrganizationSwitcher({
  collapsed,
  organizations,
  activeOrganizationId,
}: {
  collapsed: boolean;
  organizations: Array<{ id: string; name: string; slug: string }>;
  activeOrganizationId: string | null;
}) {
  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) ?? organizations[0];

  async function switchOrg(orgId: string) {
    await authClient.organization.setActive({ organizationId: orgId });
    toast.success("Organization switched");
    window.location.reload();
  }

  if (!activeOrg && organizations.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn("w-full justify-start gap-2", collapsed ? "px-2" : "px-3")}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-4 w-4" />
          </div>
          {!collapsed && (
            <>
              <div className="flex flex-1 flex-col items-start text-left">
                <span className="truncate text-sm font-medium">{activeOrg?.name ?? "No Org"}</span>
              </div>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[240px]"
        align="start"
        side={collapsed ? "right" : "bottom"}
      >
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => switchOrg(org.id)}
            className="cursor-pointer"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="ml-2 flex flex-1 flex-col">
              <span className="text-sm font-medium">{org.name}</span>
            </div>
            {activeOrg?.id === org.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {/*
          Disabled rather than wired up or removed. Creating an organization is
          the first workstream of the Organizations epic (#24) — slug handling,
          the creator's membership row and active-org selection all come with
          it — so the honest state until then is a control that says why it
          cannot be used, not one that reports a success nothing performed.
        */}
        <DropdownMenuItem disabled className="flex-col items-start gap-1">
          <span className="flex items-center">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Create organization
          </span>
          <span className="text-xs text-muted-foreground">
            Not available yet — organization management is still being built.
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  user,
  organizations,
  activeOrganizationId,
}: {
  collapsed: boolean;
  onToggle: () => void;
  user: { name: string; email: string };
  organizations: Array<{ id: string; name: string; slug: string }>;
  activeOrganizationId: string | null;
}) {
  const location = useLocation();
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  async function handleSignOut() {
    await authClient.signOut();
    toast.success("Signed out successfully");
    window.location.href = "/";
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-sidebar transition-all duration-300",
          collapsed ? "w-[60px]" : "w-[260px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b",
            collapsed ? "justify-center px-2" : "px-4",
          )}
        >
          {collapsed ? (
            <Link to="/dashboard" className="flex items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <BrandMark className="h-5 w-5 text-primary-foreground" />
              </div>
            </Link>
          ) : (
            <Link to="/dashboard" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <BrandMark className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-semibold">{PRODUCT_NAME}</span>
            </Link>
          )}
        </div>

        <div className={cn("p-2", collapsed && "flex justify-center")}>
          <OrganizationSwitcher
            collapsed={collapsed}
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
          />
        </div>

        <Separator />

        <nav className="flex-1 space-y-1 p-2">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            const linkContent = (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-2",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.name}</TooltipContent>
                </Tooltip>
              );
            }

            return <div key={item.name}>{linkContent}</div>;
          })}
        </nav>

        <Separator />

        <div className="p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className={cn("w-full min-h-[44px]", collapsed ? "px-2" : "justify-start")}
              >
                {collapsed ? (
                  <PanelLeft className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <>
                    <PanelLeftClose className="mr-2 h-5 w-5" aria-hidden="true" />
                    <span>Collapse</span>
                  </>
                )}
              </Button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Expand</TooltipContent>}
          </Tooltip>
        </div>

        <Separator />

        <div className="p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn("w-full justify-start gap-2", collapsed ? "px-2" : "px-3")}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary">{initials}</AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="flex flex-1 flex-col items-start text-left">
                    <span className="truncate text-sm font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[200px]"
              align="start"
              side={collapsed ? "right" : "top"}
            >
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/dashboard/settings" className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/dashboard/settings" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function Topbar({
  sidebarCollapsed,
  user,
}: {
  sidebarCollapsed: boolean;
  user: { name: string; email: string };
}) {
  const location = useLocation();
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  async function handleSignOut() {
    await authClient.signOut();
    toast.success("Signed out successfully");
    window.location.href = "/";
  }

  const getBreadcrumbs = () => {
    const segments = location.pathname.split("/").filter(Boolean);
    return segments.map((segment, index) => {
      const href = "/" + segments.slice(0, index + 1).join("/");
      const name = segment.charAt(0).toUpperCase() + segment.slice(1);
      const isLast = index === segments.length - 1;
      return { name, href, isLast };
    });
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-4 transition-all duration-300",
        sidebarCollapsed ? "md:pl-[76px]" : "md:pl-[276px]",
      )}
    >
      <div className="flex items-center gap-4">
        {/* Mobile hamburger — opens a simple menu panel */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Open menu">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuLabel>Navigation</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {navigation.map((item) => (
              <DropdownMenuItem key={item.name} asChild>
                <Link to={item.href} className="cursor-pointer">
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.name}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Breadcrumb */}
        <nav className="hidden text-sm text-muted-foreground md:flex" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.href} className="flex items-center">
              {index > 0 && <span className="mx-2">/</span>}
              {crumb.isLast ? (
                <span className="font-medium text-foreground">{crumb.name}</span>
              ) : (
                <Link to={crumb.href} className="hover:text-foreground">
                  {crumb.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />

        {/*
          No notification bell here. There is no notification consumer to send
          a user to, and an icon button that opens nothing is indistinguishable
          from one that is broken. It comes back with the feature.
        */}

        {/* Mobile user avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Open user menu">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/dashboard/settings" className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const { user, organizations, activeOrganizationId } = loaderData;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="hidden md:block">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          user={user}
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
        />
      </div>
      <Topbar sidebarCollapsed={sidebarCollapsed} user={user} />
      <main
        className={cn(
          "min-h-[calc(100vh-4rem)] p-4 transition-all duration-300 md:p-6",
          sidebarCollapsed ? "md:ml-[60px]" : "md:ml-[260px]",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
