"use client";

import Link from "next/link";
import { GitBranch, ExternalLink, RefreshCw } from "lucide-react";

type PreviewStatus = "pending" | "ready" | "failed" | null;

export type ProjectCardProps = {
  id: string;
  name: string;
  slug: string;
  publicUrl: string;
  repoLabel: string;
  previewImageUrl?: string | null;
  previewStatus: PreviewStatus;
  isLive: boolean;
  onRefreshPreview?: () => void;
  isRefreshingPreview?: boolean;
};

export function ProjectCard(props: ProjectCardProps) {
  const {
    id,
    name,
    slug,
    publicUrl,
    repoLabel,
    previewImageUrl,
    previewStatus,
    isLive,
    onRefreshPreview,
    isRefreshingPreview = false,
  } = props;

  const showPreviewImage = !!previewImageUrl && previewStatus === "ready";

  return (
    <Link href={`/dashboard/${id}`} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-2xl">
      <div className="overflow-hidden rounded-2xl border border-border bg-card/90 shadow-[0_0_0_1px_color-mix(in_oklab,var(--border)_35%,transparent)] transition-all hover:border-ring/40 hover:shadow-hover-deep">
        {/* Visual area */}
        <div className="relative aspect-[16/9] overflow-hidden">
          {showPreviewImage ? (
            <div className="absolute inset-0">
              <div
                className="absolute inset-0 bg-cover bg-top"
                style={{ backgroundImage: `url(${previewImageUrl})` }}
                aria-hidden="true"
              />
              <div
                className="absolute inset-0 bg-gradient-to-br from-background/10 via-background/40 to-background/80"
                aria-hidden="true"
              />
            </div>
          ) : (
            <div
              className="card-thumbnail-placeholder absolute inset-0"
              aria-hidden="true"
            />
          )}

          {/* Status + meta */}
          <div className="relative z-10 flex items-start justify-between px-4 pt-3">
            <div className="flex flex-col gap-1">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-background/50 text-xs font-semibold uppercase text-foreground shadow-sm ring-1 ring-border/70">
                {name.charAt(0).toUpperCase()}
              </span>
              {previewStatus === "pending" && (
                <span className="status-warning inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                  preview updating
                </span>
              )}
              {previewStatus === "failed" && (
                <span className="status-destructive inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
                  preview failed
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {onRefreshPreview && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRefreshPreview();
                  }}
                  title="Refresh preview"
                  aria-label="Refresh preview"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-background/55 text-foreground/80 transition hover:bg-background/75 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isRefreshingPreview}
                >
                  <RefreshCw size={13} className={isRefreshingPreview ? "animate-spin" : ""} />
                </button>
              )}
              {isLive && (
                <div className="status-success inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shadow-sm">
                  <span className="glow-success h-2 w-2 rounded-full bg-success-indicator" />
                  <span>live</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer area */}
        <div className="flex flex-col gap-1 border-t border-border/70 bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-foreground">
              {name}
            </p>
            <ExternalLink
              size={14}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-hidden="true"
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate underline-offset-2 hover:text-foreground hover:underline"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {publicUrl}
            </a>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <GitBranch size={12} className="shrink-0" />
            <span className="truncate font-mono">{repoLabel}</span>
          </div>

          <p className="mt-0.5 text-[10px] font-mono text-muted-foreground/80">
            {slug}
          </p>
        </div>
      </div>
    </Link>
  );
}
