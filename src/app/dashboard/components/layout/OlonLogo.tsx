"use client";

import { OlonMark } from "@/components/ui/logo/OlonMark";

type OlonLogoProps = {
  className?: string;
  size?: number;
};

export function OlonLogo({ className, size = 28 }: OlonLogoProps) {
  return (
    <div className={`flex items-center ${className ?? ""}`}>
      <OlonMark size={size} />
    </div>
  );
}
