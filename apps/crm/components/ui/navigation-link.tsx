"use client";

import Link, { type LinkProps } from "next/link";
import * as React from "react";

type NavigationLinkProps = LinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>;

export function NavigationLink({ children, ...props }: NavigationLinkProps) {
  return <Link {...props}>{children}</Link>;
}
