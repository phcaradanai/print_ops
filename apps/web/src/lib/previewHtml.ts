/**
 * The preview boundary deliberately accepts HTML authored in a template, but
 * it must never grant that document the dashboard's origin or capabilities.
 * Keep this policy at the rendering boundary as a defence in depth measure:
 * the API must continue to validate template content before persistence.
 */
const ALLOWED_ELEMENTS = new Set([
  'a', 'article', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'figcaption',
  'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol',
  'p', 'pre', 'section', 'small', 'span', 'strong', 'sub', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'svg', 'g', 'path',
  'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'title', 'desc', 'defs', 'clippath', 'use',
]);

const GLOBAL_ATTRIBUTES = new Set([
  'class', 'id', 'title', 'role', 'aria-label', 'aria-labelledby', 'aria-hidden',
  'width', 'height', 'viewbox', 'preserveaspectratio', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'x', 'y', 'x1',
  'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform',
  'text-anchor', 'dominant-baseline', 'font-family', 'font-size', 'font-weight',
  'xmlns',
]);

function isSafeStyle(value: string): boolean {
  const css = value.toLowerCase();
  return !/(?:expression\s*\(|url\s*\(|@import|behavior\s*:|-moz-binding)/.test(css);
}

/**
 * Removes executable elements, event handlers, external resource URLs and
 * CSS-based URL execution from HTML returned by either local or API previews.
 * It intentionally retains ordinary print layout and inline SVG barcodes.
 */
export function sanitizePreviewHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (!ALLOWED_ELEMENTS.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const safeImage = name === 'src' && /^data:image\/(?:png|gif|jpe?g|webp);/i.test(value);
      const safeFragment = (name === 'href' || name === 'xlink:href') && value.startsWith('#');
      const allowed = GLOBAL_ATTRIBUTES.has(name) || name === 'style' || safeImage || safeFragment;
      if (!allowed || name.startsWith('on') || (name === 'style' && !isSafeStyle(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return document.body.innerHTML;
}
