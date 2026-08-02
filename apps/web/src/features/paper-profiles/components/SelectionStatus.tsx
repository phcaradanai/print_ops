import { DEFAULT_BARCODE_HEIGHT_MM, DEFAULT_QR_SIZE_MM } from '../model/defaults.js';
import type { DynamicField } from '../model/types.js';
import type { Translate } from './types.js';

export function SelectionStatus({ field, t }: { field: DynamicField | null; t: Translate }) {
  if (!field) {
    return (
      <div className="pp-selection-status" aria-live="polite">
        <strong>{t('page.paperProfiles.noFieldSelected')}</strong>
        <span>{t('page.paperProfiles.selectAnItemHint')}</span>
      </div>
    );
  }
  const size = field.type === 'qrcode'
    ? `${field.qrSizeMm ?? DEFAULT_QR_SIZE_MM} × ${field.qrSizeMm ?? DEFAULT_QR_SIZE_MM} mm`
    : field.type === 'barcode'
      ? `${field.barcodeHeightMm ?? DEFAULT_BARCODE_HEIGHT_MM} mm high`
      : `${field.fontSize} pt`;
  return (
    <div className="pp-selection-status" aria-live="polite">
      <strong>{field.label || field.key || t('page.paperProfiles.untitledField')}</strong>
      <span>{field.type} · X {field.xMm.toFixed(1)} · Y {field.yMm.toFixed(1)} mm · {size}</span>
    </div>
  );
}
