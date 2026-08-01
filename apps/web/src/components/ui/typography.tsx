/**
 * Text atoms (FE-02).
 *
 * Before this existed, every page reached for an inline style to say the same
 * five things: `{ color: 'var(--neutral-text-muted)' }`, `{ fontFamily:
 * 'monospace' }`, `{ fontWeight: 600 }`, `{ fontSize: '0.75rem' }`,
 * `{ whiteSpace: 'nowrap' }`. `AuditLogs` alone carried five of them in one
 * table and one hardcoded `#888` that fails AA on white. There is one way to
 * say each of those now, and each maps to a token in `DESIGN.md`.
 *
 * `mono` is the evidence layer, not decoration: job ids, printer addresses,
 * template codes, payloads, trace values. Ordinary prose stays sans-serif.
 */

import type { ElementType, HTMLAttributes, ReactNode } from 'react';

export type TextTone =
  | 'default'
  | 'muted'
  | 'strong'
  | 'primary'
  | 'danger'
  | 'warning'
  | 'success'
  | 'info';

export type TextSize = 'label' | 'body' | 'title' | 'stat';
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  tone?: TextTone;
  size?: TextSize;
  weight?: TextWeight;
  /** Monospace. Only for strings whose exact characters matter operationally. */
  mono?: boolean;
  /** Single-line ellipsis. Pair with `title` so the full value stays reachable. */
  truncate?: boolean;
  nowrap?: boolean;
  /**
   * Uppercase + tracking. Opt-in and Latin-only by intent — Thai glyph clusters
   * must never be transformed, so this is never applied to localized copy.
   */
  caps?: boolean;
  children?: ReactNode;
}

export function Text({
  as: Component = 'span',
  tone = 'default',
  size = 'body',
  weight,
  mono = false,
  truncate = false,
  nowrap = false,
  caps = false,
  className = '',
  children,
  ...props
}: TextProps) {
  const classes = [
    'ui-text',
    `ui-text--${tone}`,
    `ui-text--${size}`,
    weight ? `ui-text--${weight}` : '',
    mono ? 'ui-text--mono' : '',
    truncate ? 'ui-text--truncate' : '',
    nowrap ? 'ui-text--nowrap' : '',
    caps ? 'ui-text--caps' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Component {...props} className={classes}>
      {children}
    </Component>
  );
}

/** Shorthand for the evidence layer: `<Mono>{job.id}</Mono>`. */
export function Mono({ children, ...props }: Omit<TextProps, 'mono'>) {
  return (
    <Text {...props} mono>
      {children}
    </Text>
  );
}

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Document level. Chosen for outline correctness, independent of size. */
  level?: 1 | 2 | 3 | 4;
  /** Visual size. Defaults to the size that matches `level`. */
  size?: 'page' | 'section' | 'subsection';
  children: ReactNode;
}

const HEADING_DEFAULT_SIZE = {
  1: 'page',
  2: 'section',
  3: 'subsection',
  4: 'subsection',
} as const;

export function Heading({ level = 2, size, className = '', children, ...props }: HeadingProps) {
  const Component = `h${level}` as ElementType;
  const visual = size ?? HEADING_DEFAULT_SIZE[level];
  return (
    <Component {...props} className={`ui-heading ui-heading--${visual}${className ? ` ${className}` : ''}`}>
      {children}
    </Component>
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2 | 3 | 4;
  id?: string;
}

/**
 * Heading + optional supporting line + optional actions on one baseline.
 *
 * Replaces `section-heading`, `section-title`, `wh-form-section-title`,
 * `wh-panel-header` and `job-panel__heading`, which were five spellings of this.
 * Actions wrap below the title on narrow widths rather than squeezing it.
 */
export function SectionHeading({ title, description, actions, level = 2, id }: SectionHeadingProps) {
  return (
    <div className="ui-section-heading">
      <div className="ui-section-heading__copy">
        <Heading level={level} id={id}>
          {title}
        </Heading>
        {description != null && (
          <Text as="p" tone="muted" className="ui-section-heading__description">
            {description}
          </Text>
        )}
      </div>
      {actions != null && <div className="ui-section-heading__actions">{actions}</div>}
    </div>
  );
}

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  children: ReactNode;
  /** Caps the height and scrolls instead of pushing the page down. */
  scroll?: boolean;
  label?: string;
}

/**
 * Multi-line evidence: request payloads, webhook bodies, rendered template
 * source. Scrolls inside its own box so a long payload never widens the page.
 */
export function CodeBlock({ children, scroll = true, label, className = '', ...props }: CodeBlockProps) {
  return (
    <pre
      {...props}
      className={`ui-code-block${scroll ? ' ui-code-block--scroll' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      tabIndex={0}
    >
      <code>{children}</code>
    </pre>
  );
}
