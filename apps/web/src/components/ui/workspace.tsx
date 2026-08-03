/**
 * Workspace vocabulary: the patterns an editing surface needs that a list page
 * does not.
 *
 * Templates, Paper Profiles and Webhooks each grew their own version of every
 * pattern in this file — three code editors, three split layouts, three sticky
 * command bars, two collapsible sections — because the shared system only
 * covered list-and-form pages. Each fork then drifted on its own schedule.
 * These are the shared originals; feature stylesheets own domain geometry
 * (paper, canvas, rulers, barcode preview) and nothing else.
 */

import {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  type UIEvent,
} from 'react';
import { ActionIcon } from '../ActionIcon.js';
import { Chip, Input, Label } from './inputs.js';
import './workspace.css';

/* ── Evidence Canvas ─────────────────────────────────────────────────────── */

export interface EditorCanvasProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onScroll' | 'wrap'> {
  value: string;
  /** Flips the resting border to the danger token; pair it with a real message. */
  invalid?: boolean;
  /** Minimum field height. Defaults to a comfortable authoring block. */
  minHeight?: string;
}

/**
 * The dark, line-numbered authoring surface described in DESIGN.md.
 *
 * Line numbers are derived from the value rather than tracked in state, and the
 * gutter is scroll-synced to the field, so a long payload never drifts out of
 * register. The gutter is `aria-hidden` and unselectable: copying the content
 * must never pick up the numbers.
 */
export const EditorCanvas = forwardRef<HTMLTextAreaElement, EditorCanvasProps>(
  function EditorCanvas(
    { value, invalid = false, minHeight, className = '', style, ...props },
    ref,
  ) {
    const gutterRef = useRef<HTMLDivElement | null>(null);

    const lineNumbers = useMemo(() => {
      const count = value.split(/\r\n|\r|\n/).length;
      return Array.from({ length: Math.max(1, count) }, (_, index) => index + 1);
    }, [value]);

    const syncGutter = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
      if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }, []);

    return (
      <div
        className={`ui-editor-canvas${className ? ` ${className}` : ''}`}
        data-invalid={invalid || undefined}
        style={minHeight ? ({ ...style, '--editor-canvas-min': minHeight } as typeof style) : style}
      >
        <div ref={gutterRef} className="ui-editor-canvas__gutter" aria-hidden="true">
          {lineNumbers.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <textarea
          {...props}
          ref={ref}
          value={value}
          onScroll={syncGutter}
          className="ui-editor-canvas__field"
          spellCheck={props.spellCheck ?? false}
          // Non-negotiable: soft wrapping would let one logical line occupy
          // several visual rows, and every number below it would then point at
          // the wrong line. Long lines scroll horizontally instead.
          wrap="off"
          aria-invalid={props['aria-invalid'] ?? (invalid || undefined)}
        />
      </div>
    );
  },
);

/* ── Workspace split ─────────────────────────────────────────────────────── */

export type WorkspaceSplitRatio =
  /** Equal panes. */
  | 'balanced'
  /** Primary task with a reference rail: available keys, token lists. */
  | 'aside-narrow'
  /** Primary task with a live preview that needs real width to be readable. */
  | 'aside-preview'
  /** Library or navigator first, then the working pane. */
  | 'aside-wide';

export interface WorkspaceSplitProps extends HTMLAttributes<HTMLDivElement> {
  /** The supporting pane: preview, reference keys, delivery evidence. */
  aside: ReactNode;
  ratio?: WorkspaceSplitRatio;
  children: ReactNode;
}

/**
 * Two-pane editing layout with the collapse behavior DESIGN.md specifies.
 *
 * The three workspaces each hard-coded their own breakpoint for the same
 * decision — one of them at 1100px, one at 860px, one at neither. The rule
 * lives here now: side by side while both panes are usable, one column below
 * 1100px, and the supporting pane always follows the primary task in document
 * order so the keyboard path stays sensible when it stacks.
 */
export function WorkspaceSplit({
  aside,
  ratio = 'balanced',
  className = '',
  children,
  ...props
}: WorkspaceSplitProps) {
  return (
    <div {...props} className={`ui-workspace-split ui-workspace-split--${ratio}${className ? ` ${className}` : ''}`}>
      <div className="ui-workspace-split__primary">{children}</div>
      <div className="ui-workspace-split__aside">{aside}</div>
    </div>
  );
}

/* ── Workspace bar ───────────────────────────────────────────────────────── */

export interface WorkspaceBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Identity of the thing being edited: name, code, unsaved marker. */
  identity?: ReactNode;
  /** Status text — save state, validation summary, last-saved time. */
  status?: ReactNode;
  actions?: ReactNode;
  placement?: 'top' | 'bottom';
  children?: ReactNode;
}

/**
 * The sticky bar that carries an editor's identity and its commit actions.
 *
 * Flat and border-defined, per the Flat-By-Default Rule — the version this
 * replaces used a translucent white fill with `backdrop-filter: blur(12px)` and
 * a floating-panel shadow, which read as glass decoration on a surface that
 * never leaves the page. Bottom placement clears the safe-area inset so a
 * commit action is never under a home indicator.
 */
export function WorkspaceBar({
  identity,
  status,
  actions,
  placement = 'top',
  className = '',
  children,
  ...props
}: WorkspaceBarProps) {
  return (
    <div
      {...props}
      className={`ui-workspace-bar ui-workspace-bar--${placement}${className ? ` ${className}` : ''}`}
    >
      {identity != null && <div className="ui-workspace-bar__identity">{identity}</div>}
      {children}
      {status != null && <div className="ui-workspace-bar__status">{status}</div>}
      {actions != null && <div className="ui-workspace-bar__actions">{actions}</div>}
    </div>
  );
}

/* ── Collapsible section ─────────────────────────────────────────────────── */

export interface CollapsibleSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Leading affordance — an icon, count, or status dot. */
  leading?: ReactNode;
  /** Trailing content on the header row, outside the toggle. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode. Supply with `onToggle`. */
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

/**
 * Disclosure section for long editor forms.
 *
 * The toggle is the heading, so a screen reader reaches the section name and
 * its expanded state in one stop, and the panel is wired back with
 * `aria-controls`. Works controlled or uncontrolled.
 */
export function CollapsibleSection({
  title,
  description,
  leading,
  actions,
  defaultOpen = true,
  open,
  onToggle,
  className = '',
  children,
  ...props
}: CollapsibleSectionProps) {
  const panelId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const handleToggle = () => {
    if (onToggle) onToggle();
    if (!isControlled) setInternalOpen((previous) => !previous);
  };

  return (
    <section
      {...props}
      className={`ui-collapsible${isOpen ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
    >
      <div className="ui-collapsible__header">
        <button
          type="button"
          className="ui-collapsible__toggle"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={handleToggle}
        >
          <span className="ui-collapsible__chevron" aria-hidden="true">
            <ActionIcon name="chevron" />
          </span>
          {leading != null && <span className="ui-collapsible__leading">{leading}</span>}
          <span className="ui-collapsible__copy">
            <span className="ui-collapsible__title">{title}</span>
            {description != null && (
              <span className="ui-collapsible__description">{description}</span>
            )}
          </span>
        </button>
        {actions != null && <div className="ui-collapsible__actions">{actions}</div>}
      </div>
      <div id={panelId} className="ui-collapsible__panel" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

/* ── Token list ──────────────────────────────────────────────────────────── */

export interface TokenListItem {
  /** The literal string inserted into the editor, e.g. `{{jobId}}`. */
  token: string;
  description?: ReactNode;
}

export interface TokenListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  items: TokenListItem[];
  onInsert: (token: string) => void;
  /** Accessible title for each chip, e.g. "Insert {token}". */
  insertTitle?: (token: string) => string;
  /** Shown when there is nothing to offer — an empty list is a real answer. */
  empty?: ReactNode;
}

/**
 * Clickable tokens that insert themselves into the adjacent editor.
 *
 * Webhooks arrived at the right shape for this first — chips, because that is
 * what the system reserves for a compact insertable value — while Templates
 * rendered the same concept as a bare list of buttons wrapped around `<code>`.
 * This is the Webhooks version, extracted so both read as one product.
 */
export function TokenList({
  items,
  onInsert,
  insertTitle,
  empty,
  className = '',
  ...props
}: TokenListProps) {
  if (items.length === 0 && empty != null) {
    return (
      <div {...props} className={`ui-token-list${className ? ` ${className}` : ''}`}>
        {empty}
      </div>
    );
  }

  return (
    <div {...props} className={`ui-token-list${className ? ` ${className}` : ''}`}>
      {items.map((item) => (
        <div key={item.token} className="ui-token-list__row">
          <Chip
            className="ui-token-list__chip"
            title={insertTitle ? insertTitle(item.token) : undefined}
            onClick={() => onInsert(item.token)}
          >
            {item.token}
          </Chip>
          {item.description != null && (
            <span className="ui-token-list__description">{item.description}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Color field ─────────────────────────────────────────────────────────── */

export interface ColorFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the swatch picker when the label is not enough. */
  swatchLabel?: string;
  disabled?: boolean;
}

/**
 * Swatch plus hex value, kept in one control.
 *
 * The two inputs write the same value, so the text field stays authoritative
 * for anyone who types or pastes a hex and the swatch stays available for
 * anyone who would rather point at it.
 */
export function ColorField({ label, value, onChange, swatchLabel, disabled }: ColorFieldProps) {
  const id = useId();
  return (
    <div className="ui-color-field">
      <Label htmlFor={`${id}-value`}>{label}</Label>
      <div className="ui-color-field__controls">
        <input
          type="color"
          className="ui-color-field__swatch"
          value={value}
          disabled={disabled}
          aria-label={swatchLabel ?? undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          id={`${id}-value`}
          controlSize="sm"
          mono
          value={value}
          disabled={disabled}
          className="ui-color-field__value"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
