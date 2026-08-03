import { PAPER_PRESETS } from '../model/defaults.js';
import { IconButton } from '../../../components/ui/index.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { Translate } from './types.js';
import { PaperProfileIcon } from './PaperProfileIcon.js';

export function PresetMenu({ editor, popups, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  t: Translate;
}) {
  return (
    <div className="pp-presets" ref={popups.presetsContainerRef}>
      <IconButton ref={popups.presetsTriggerRef}
        label={t('page.paperProfiles.presets')} onClick={popups.togglePresets}
        aria-expanded={popups.presetsOpen} aria-haspopup="menu">
        <PaperProfileIcon name="presets" />
      </IconButton>
      {popups.presetsOpen && (
        <div className="pp-presets-menu" role="menu">
          {PAPER_PRESETS.map((preset) => (
            <button type="button" key={preset.label} className="pp-preset-option" role="menuitem"
              onClick={() => { editor.applyPreset(preset); popups.closePresets(); }}>
              <PaperProfileIcon name="chevron" />{preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
