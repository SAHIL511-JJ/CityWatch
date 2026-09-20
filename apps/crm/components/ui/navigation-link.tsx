"use client";

import Link, { type LinkProps } from "next/link";
import * as React from "react";
import { normalizeInternalPath, useNavigationFeedback } from "./navigation-feedback";

type NavigationLinkProps = LinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>;

export function NavigationLink({ href, onClick, children, target, ...props }: NavigationLinkProps) {
  const { beginNavigation, isTargetPending } = useNavigationFeedback();
  const stringHref = typeof href === "string" ? href : null;
  const isPending = !!stringHref && isTargetPending(stringHref);

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const internalPath = stringHref ? normalizeInternalPath(stringHref) : null;
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || (target && target !== "_self")
      || !internalPath
      || internalPath === window.location.pathname
    ) return;
    beginNavigation(stringHref as string);
  };

  return (
    <Link
      {...props}
      href={href}
      target={target}
      onClick={handleClick}
      aria-busy={isPending || undefined}
    >
      {children}
      {isPending && (
        <span aria-hidden className="ml-1 inline-flex h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current align-[-1px] motion-reduce:animate-none" />
      )}
    </Link>
  );
}
