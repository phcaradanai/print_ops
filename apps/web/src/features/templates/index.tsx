import { TemplateWorkspaceProvider } from './hooks/useTemplateWorkspace.js';
import { TemplateWorkspaceInner } from './TemplateWorkspace.js';

export function TemplatesFeature() {
  return (
    <TemplateWorkspaceProvider>
      <TemplateWorkspaceInner />
    </TemplateWorkspaceProvider>
  );
}

export * from './model/types.js';
