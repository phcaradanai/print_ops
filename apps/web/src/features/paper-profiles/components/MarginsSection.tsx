import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import { Section } from './editorPrimitives.js';
import { DimensionInput } from './DimensionsSection.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function MarginsSection({ editor, t, anchorRef }: {
  editor: PaperProfileEditor;
  t: Translate;
  anchorRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={anchorRef} className="pp-section-anchor">
      <Section title={t('page.paperProfiles.margins')} icon={<PaperProfileIcon name="margins" />}
        open={editor.state.sectionsOpen.margins}
        onToggle={() => editor.setSection('margins', !editor.state.sectionsOpen.margins)}>
        <div className="pp-form-grid pp-form-grid--four">
          <DimensionInput editor={editor} field="marginTopMm" label="page.paperProfiles.top" t={t} />
          <DimensionInput editor={editor} field="marginRightMm" label="page.paperProfiles.right" t={t} />
          <DimensionInput editor={editor} field="marginBottomMm" label="page.paperProfiles.bottom" t={t} />
          <DimensionInput editor={editor} field="marginLeftMm" label="page.paperProfiles.left" t={t} />
        </div>
      </Section>
    </div>
  );
}
