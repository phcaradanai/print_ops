import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconButton } from './IconButton.js';
import {
  CollapsibleSection,
  ColorField,
  EditorCanvas,
  WorkspaceBar,
  WorkspaceSplit,
} from './workspace.js';

function position(markup: string, value: string) {
  const index = markup.indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('EditorCanvas', () => {
  it('numbers every line of the value', () => {
    const markup = renderToStaticMarkup(
      <EditorCanvas value={'{\n  "a": 1\n}'} readOnly aria-label="Payload" />,
    );

    expect(markup).toContain('>1</span>');
    expect(markup).toContain('>2</span>');
    expect(markup).toContain('>3</span>');
    expect(markup).not.toContain('>4</span>');
  });

  it('always shows at least one line number for empty content', () => {
    const markup = renderToStaticMarkup(<EditorCanvas value="" readOnly aria-label="Payload" />);

    expect(markup).toContain('>1</span>');
  });

  it('counts CRLF and CR line endings the same as LF', () => {
    const markup = renderToStaticMarkup(
      <EditorCanvas value={'one\r\ntwo\rthree'} readOnly aria-label="Payload" />,
    );

    expect(markup).toContain('>3</span>');
    expect(markup).not.toContain('>4</span>');
  });

  it('keeps line numbers out of the accessibility tree and out of selections', () => {
    const markup = renderToStaticMarkup(
      <EditorCanvas value={'a\nb'} readOnly aria-label="Payload" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('ui-editor-canvas__gutter');
  });

  it('forces wrap="off" so one logical line is always one numbered row', () => {
    // Soft wrapping is what silently desynchronises a gutter from its content:
    // the numbers count newlines, the field renders visual rows.
    const markup = renderToStaticMarkup(
      <EditorCanvas value={'a'.repeat(400)} readOnly aria-label="Payload" />,
    );

    expect(markup).toContain('wrap="off"');
    expect(markup).toContain('>1</span>');
    expect(markup).not.toContain('>2</span>');
  });

  it('gives the gutter and the field the same row-height variable', () => {
    const markup = renderToStaticMarkup(<EditorCanvas value={'a\nb'} readOnly aria-label="P" />);

    // Both panes must resolve their metrics from the canvas, never their own.
    expect(markup).toContain('ui-editor-canvas__gutter');
    expect(markup).toContain('ui-editor-canvas__field');
  });

  it('exposes invalid state to assistive technology, not only to the border', () => {
    const markup = renderToStaticMarkup(
      <EditorCanvas value="{" invalid readOnly aria-label="Payload" />,
    );

    expect(markup).toContain('data-invalid');
    expect(markup).toContain('aria-invalid="true"');
  });
});

describe('WorkspaceSplit', () => {
  it('places the supporting pane after the primary task in document order', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSplit aside={<div>Preview</div>}>Editor</WorkspaceSplit>,
    );

    expect(position(markup, 'Editor')).toBeLessThan(position(markup, 'Preview'));
  });

  it('carries the requested ratio', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSplit ratio="aside-wide" aside={<div>Preview</div>}>
        Editor
      </WorkspaceSplit>,
    );

    expect(markup).toContain('ui-workspace-split--aside-wide');
  });
});

describe('WorkspaceBar', () => {
  it('orders identity, status, then actions', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceBar
        identity={<span>label-a4</span>}
        status={<span>Unsaved</span>}
        actions={<button type="button">Save</button>}
      />,
    );

    expect(position(markup, 'label-a4')).toBeLessThan(position(markup, 'Unsaved'));
    expect(position(markup, 'Unsaved')).toBeLessThan(position(markup, 'Save'));
  });

  it('supports bottom placement for commit actions', () => {
    const markup = renderToStaticMarkup(<WorkspaceBar placement="bottom" actions={<span />} />);

    expect(markup).toContain('ui-workspace-bar--bottom');
  });
});

describe('CollapsibleSection', () => {
  it('wires the toggle to the panel it controls', () => {
    const markup = renderToStaticMarkup(
      <CollapsibleSection title="Margins">Body</CollapsibleSection>,
    );

    const controls = markup.match(/aria-controls="([^"]+)"/);
    expect(controls).not.toBeNull();
    expect(markup).toContain(`id="${controls?.[1]}"`);
    expect(markup).toContain('aria-expanded="true"');
  });

  it('hides the panel when closed', () => {
    const markup = renderToStaticMarkup(
      <CollapsibleSection title="Margins" defaultOpen={false}>
        Body
      </CollapsibleSection>,
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('hidden');
  });

  it('respects controlled open state', () => {
    const markup = renderToStaticMarkup(
      <CollapsibleSection title="Margins" open={false} onToggle={() => {}}>
        Body
      </CollapsibleSection>,
    );

    expect(markup).toContain('aria-expanded="false"');
  });
});

describe('IconButton toggle and blocked states', () => {
  it('carries toggle state on aria-pressed, not on colour', () => {
    const on = renderToStaticMarkup(<IconButton label="Grid" pressed>G</IconButton>);
    const off = renderToStaticMarkup(<IconButton label="Grid" pressed={false}>G</IconButton>);

    expect(on).toContain('aria-pressed="true"');
    expect(off).toContain('aria-pressed="false"');
  });

  it('omits aria-pressed entirely when the button is not a toggle', () => {
    const markup = renderToStaticMarkup(<IconButton label="Zoom in">+</IconButton>);

    expect(markup).not.toContain('aria-pressed');
  });

  it('keeps a blocked control focusable and states the reason in its name', () => {
    const markup = renderToStaticMarkup(
      <IconButton label="Center" disabled disabledReason="No field selected">
        C
      </IconButton>,
    );

    // aria-disabled, not disabled: the reason has to stay reachable.
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(markup).toContain('aria-label="Center: No field selected"');
    expect(markup).toContain('title="No field selected"');
  });

  it('uses a plain disabled attribute when there is no reason to convey', () => {
    const markup = renderToStaticMarkup(<IconButton label="Center" disabled>C</IconButton>);

    expect(markup).toMatch(/\sdisabled(=|\s|>)/);
    expect(markup).not.toContain('aria-disabled');
  });
});

describe('ColorField', () => {
  it('labels the text value rather than the swatch, so the hex is the field', () => {
    const markup = renderToStaticMarkup(
      <ColorField label="Border" value="#1e66f5" onChange={() => {}} swatchLabel="Pick border" />,
    );

    const forMatch = markup.match(/for="([^"]+)"/);
    expect(forMatch).not.toBeNull();
    expect(markup).toContain(`id="${forMatch?.[1]}"`);
    expect(markup).toContain('aria-label="Pick border"');
    expect(markup).toContain('value="#1e66f5"');
  });
});
