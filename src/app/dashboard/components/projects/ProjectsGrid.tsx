"use client";

import type { ProjectCardProps } from "./ProjectCard";
import { ProjectCard } from "./ProjectCard";

type ProjectsGridProps = {
  projects: ProjectCardProps[];
};

export function ProjectsGrid({ projects }: ProjectsGridProps) {
  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} {...project} />
      ))}
    </div>
  );
}

