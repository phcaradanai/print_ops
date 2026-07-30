import { PAPER_PRESETS } from '../model/defaults.js';
import type { PaperProfileEditor } from '../hooks/usePaperProfileEditor.js';
import type { PaperProfilePopups } from '../hooks/usePaperProfilePopups.js';
import type { Translate } from './types.js';

export function PresetMenu({ editor, popups, t }: {
  editor: PaperProfileEditor;
  popups: PaperProfilePopups;
  t: Translate;
}) {
  return (
    <div className="pp-presets" ref={popups.presetsContainerRef}>
      <button type="button" className="pp-icon-btn" ref={popups.presetsTriggerRef}
        onClick={popups.togglePresets} title={t('page.paperProfiles.presets')}
        aria-label={t('page.paperProfiles.presets')} aria-expanded={popups.presetsOpen} aria-haspopup="menu">
        <span aria-hidden="true">📋</span>
      </button>
      {popups.presetsOpen && (
        <div className="pp-presets-menu" role="menu">
          {PAPER_PRESETS.map((preset) => (
            <button type="button" key={preset.label} className="pp-preset-option" role="menuitem"
              onClick={() => { editor.applyPreset(preset); popups.closePresets(); }}>
              <span aria-hidden="true">▸</span>{preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
