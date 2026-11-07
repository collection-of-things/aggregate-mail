import { Fragment, createElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { imageSource, type MailAttachment } from "../../shared/types";
import { embeddedImageTypes, mailLink, mailStyle, mailStylesheet, parseMailContent, privateMailLink, type MailContentNode } from "../../shared/mail-content";
import { segmentPrivateParts, type PrivacySegment } from "../privacy";
import { useRemoteImage } from "./remote-image";
import { useFitWidth, useReadableInk, useScopedSheet } from "./scoped-mail";

type Presentation = { className?: string; id?: string };

type Props = {
  mailId?: string;
  attachments?: readonly MailAttachment[];
  html: string | null | undefined;
  showImages: boolean;
  renderText: (text: string, segments?: readonly PrivacySegment[]) => ReactNode;
  redactText: (text: string) => string;
  privacy: boolean;
  privateNames?: readonly string[];
  fallbackText?: string;
  fallback?: ReactNode;
};

// Parent owns opening-specific consent and text redaction. Hooks: formatted-mail,
// formatted-mail-fallback, formatted-mail-image and formatted-mail-image-placeholder.
export function FormattedMail({ mailId, attachments = [], html, showImages, renderText, redactText, privacy, privateNames = [], fallbackText = "", fallback }: Props) {
  const stylesheet = useMemo(() => mailStylesheet(html || ""), [html]);
  // Mail with supported sender rules keeps its colors and classes; other mail
  // takes the themed reader colors.
  const styled = !!stylesheet.css;
  const nodes = useMemo(() => typeof html === "string" ? parseMailContent(html, styled) : null, [html, styled]);
  const textParts = nodes ? contentParts(nodes) : [];
  const privateParts = privacy ? segmentPrivateParts(textParts, privateNames) : undefined;
  const embeddedFiles = new Map<string, MailAttachment>();
  const visitImages = (items: readonly MailContentNode[]) => {
    for (const node of items) if (typeof node !== "string") {
      if (node.tag === "img" && (!privacy || !privateMailLink(node.attributes.src || "", redactText))) {
        const file = embeddedAttachment(node.attributes.src || "", attachments);
        if (file) embeddedFiles.set(file.id, file);
      }
      visitImages(node.children);
    }
  };
  if (nodes && showImages) visitImages(nodes);
  const embeddedSources = useEmbeddedImages(mailId, [...embeddedFiles.values()]);
  let textIndex = 0;
  const render = (node: MailContentNode, key: number): ReactNode => {
    if (typeof node === "string") return <Fragment key={key}>{renderText(node, privateParts?.[textIndex++])}</Fragment>;
    const { tag, attributes: a, children } = node;
    const style: CSSProperties = {};
    // Legacy email presentation attributes pass through the same CSS validators.
    Object.assign(style, mailStyle([
      a.bgcolor && `background-color:${a.bgcolor}`, a.color && `color:${a.color}`,
      a.valign && `vertical-align:${a.valign}`,
      a.width && `width:${/^\d+$/.test(a.width) ? a.width + "px" : a.width}`,
      a.height && `height:${/^\d+$/.test(a.height) ? a.height + "px" : a.height}`,
    ].filter(Boolean).join(";")));
    if (tag === "font" && /^[1-7]$/.test(a.size || "")) style.fontSize = [10, 13, 16, 18, 24, 32, 48][Number(a.size) - 1];
    Object.assign(style, legacyAlign(tag, (a.align || "").toLowerCase()));
    Object.assign(style, mailStyle(a.style || ""));
    if (tag !== "img" && hasText(children)) for (const property of ["fontSize", "lineHeight", "height", "maxHeight"] as const) {
      const value = style[property];
      if (typeof value === "string" && (value === "0" || value.endsWith("px") && parseFloat(value) < 6))
        delete style[property];
    }
    // Sender sizes are already bounded; scale absolute sizes once, including legacy fonts.
    if (style.fontSize) style.fontSize = `calc(${typeof style.fontSize === "number" ? `${style.fontSize}px` : style.fontSize} * var(--text-scale, 1))`;
    // Quotes take the app's own inset and bar, so nested replies keep their width.
    if (tag === "blockquote") for (const property of Object.keys(style) as (keyof CSSProperties)[])
      if (/^(margin|padding|border)/.test(property)) delete style[property];
    if (!styled) {
      delete style.color;
      // Code and pre drop the sender background so the shared chip/surface
      // styling applies; everything else keeps its transparent field.
      if (tag === "code" || tag === "pre") delete style.backgroundColor;
      else style.backgroundColor = "transparent";
      if (style.borderColor) style.borderColor = "var(--line)";
      for (const property of ["border", "borderTop", "borderRight", "borderBottom", "borderLeft"] as const) {
        if (style[property]) style[property] = String(style[property]).replace(/^(\d+(?:\.\d+)?px (?:solid|dashed|dotted) ).+$/, "$1var(--line)");
      }
    }
    const presentation: Presentation = styled ? {
      className: (a.class || "").split(/\s+/).map(name => stylesheet.identifiers.get('.' + name)).filter(Boolean).join(' ') || undefined,
      id: a.id ? stylesheet.identifiers.get('#' + a.id) : undefined,
    } : {};
    if (tag === "img") {
      // An empty box at the image's size keeps the sender layout; small icon
      // cells would otherwise wrap the reason one letter per line.
      if (!showImages) return <ImagePlaceholder {...presentation} key={key} style={style} reason="Image blocked. Use Show images to load it." />;
      const cid = /^cid:(.+)$/i.exec(a.src || "")?.[1];
      const embedded = embeddedAttachment(a.src || "", attachments);
      if (cid && privacy && privateMailLink(a.src, redactText))
        return <ImagePlaceholder {...presentation} key={key} style={style} reason="Image unavailable while personal information is hidden." />;
      if (embedded && mailId) {
        const source = embeddedSources[embedded.id];
        return source?.src ? <FormattedImage {...presentation} key={`${key}:${source.src}`} src={source.src} alt={redactText(a.alt || "").slice(0, 500)} style={style} /> :
          <ImagePlaceholder {...presentation} key={key} style={style} reason={source?.failed ? "Embedded image could not be loaded." : "Loading embedded image…"} />;
      }
      const src = imageSource(a.src || "");
      if (privacy && (privateMailLink(a.src || "", redactText) || (src && privateMailLink(src, redactText))))
        return <ImagePlaceholder {...presentation} key={key} style={style} reason="Image unavailable while personal information is hidden." />;
      return src ? <FormattedImage {...presentation} key={`${key}:${src}`} mailId={mailId} src={src} alt={redactText(a.alt || "").slice(0, 500)} style={style} /> :
        <ImagePlaceholder {...presentation} key={key} style={style} reason="Unsupported image." />;
    }
    const props: Record<string, unknown> = { key, style, ...presentation };
    let element = tag === "font" ? "span" : tag === "center" ? "div" : tag;
    if (tag === "a") {
      const href = mailLink(a.href || "");
      if (href && (!privacy || (!privateMailLink(a.href, redactText) && !privateMailLink(href, redactText)))) {
        style.color = "var(--link)";
        // Sender-set decoration stays; plain links underline on hover via CSS.
        Object.assign(props, { href, target: "_blank", rel: "noopener noreferrer", referrerPolicy: "no-referrer" });
      }
      else element = "span";
    }
    if (tag === "td" || tag === "th") {
      for (const [attribute, property] of [["colspan", "colSpan"], ["rowspan", "rowSpan"]]) {
        if (/^\d{1,2}$/.test(a[attribute] || "") && Number(a[attribute]) >= 1 && Number(a[attribute]) <= 20)
          props[property] = Number(a[attribute]);
      }
    }
    if (tag === "table") {
      for (const [attribute, property] of [["cellpadding", "cellPadding"], ["cellspacing", "cellSpacing"], ["border", "border"]]) {
        if (/^\d{1,2}$/.test(a[attribute] || "") && Number(a[attribute]) <= (attribute === "border" ? 4 : 24))
          props[property] = Number(a[attribute]);
      }
    }
    if (tag === "ol" && /^-?\d{1,4}$/.test(a.start || "")) props.start = Number(a.start);
    const content = children.map(render);
    // Consume the same block separator used by cross-leaf privacy matching.
    if (blockTags.has(tag)) textIndex++;
    if (["br", "hr", "col"].includes(tag)) return createElement(element, props);
    return createElement(element, props, content);
  };
  const formatted = !!nodes && !!(textParts.join("").trim() || hasImage(nodes, attachments));
  const scoped = styled && formatted;
  const root = useRef<HTMLDivElement>(null);
  const sheet = useScopedSheet(scoped ? stylesheet.css : "");
  useReadableInk(root, scoped && !sheet.failed);
  useFitWidth(root, [html, showImages, privacy, scoped, sheet.failed]);
  if (scoped && sheet.failed) return <div className="formatted-mail formatted-mail-fallback">{fallback ?? renderText(fallbackText || textParts.join(''))}</div>;
  // The mail renders in the reader's own document, so the reader is its only
  // scroller. Wide mail is zoomed to fit; what still overflows scrolls inside
  // this box without a visible bar.
  const body = <div ref={root} className={formatted ? "formatted-mail" : "formatted-mail formatted-mail-fallback"} data-mail-scope={scoped ? sheet.scope : undefined}
    style={{ maxWidth: "100%", minWidth: 0, overflowX: "auto", overflowWrap: formatted ? "break-word" : "anywhere", contain: "layout paint", isolation: "isolate", whiteSpace: formatted ? "normal" : "pre-wrap" }}>
    {formatted ? nodes.map(render) : fallback ?? renderText(fallbackText)}
  </div>;
  // Sender width queries measure this frame, the width the message gets.
  return scoped ? <div className="formatted-mail-frame">{body}</div> : body;
}

// Holds a blocked image's place at its own size (24px when unsized); the reason
// is a label and tooltip because a small icon cell cannot fit it as text.
function ImagePlaceholder({ style, reason, className, id }: { style: CSSProperties; reason: string } & Presentation) {
  return <span id={id} className={["formatted-mail-image-placeholder", className].filter(Boolean).join(" ")} role="img" aria-label={reason} title={reason}
    style={placeholderShape(style)} />;
}

// A placeholder narrows exactly as its image would. An image's max-width lets a
// table cell shrink it, but a sized empty box would hold the cell open and
// widen the whole mail, so a px width becomes min(width, 100%) and a px width
// and height keep their ratio instead of a fixed height.
function placeholderShape(style: CSSProperties): CSSProperties {
  const width = pxLength(style.width), height = pxLength(style.height);
  return {
    width: width ? `min(${width}px, 100%)` : style.width ?? 24,
    ...(width && height ? { height: "auto", aspectRatio: `${width} / ${height}` } : { height: style.height ?? 24 }),
    maxHeight: style.maxHeight,
  };
}

// CID URLs encode Content-ID characters; ambiguous IDs never resolve.
function embeddedAttachment(source: string, attachments: readonly MailAttachment[]): MailAttachment | undefined {
  const cid = /^cid:(.+)$/i.exec(source)?.[1];
  if (!cid) return;
  let decoded: string;
  try { decoded = decodeURIComponent(cid); } catch { return; }
  const matches = attachments.filter((file) => file.contentId === decoded);
  return matches.length === 1 && !matches[0].unavailable && embeddedImageTypes.has(matches[0].contentType.toLowerCase()) ? matches[0] : undefined;
}

type EmbeddedSource = { src?: string; failed?: boolean };
// One fetch/blob per unique referenced attachment, shared by all image occurrences.
function useEmbeddedImages(mailId: string | undefined, files: readonly MailAttachment[]) {
  // The value key avoids re-fetches when parent renders recreate the same metadata.
  const fileKey = JSON.stringify(files.map(({ id, size, contentType }) => ({ id, size, contentType })));
  const binding = JSON.stringify([mailId, fileKey]);
  const [state, setState] = useState<{ binding: string; sources: Record<string, EmbeddedSource> }>({ binding, sources: {} });
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    const controller = new AbortController();
    setState({ binding, sources: {} });
    if (mailId) for (const file of files) void (async () => {
      const response = await fetch(`/api/messages/${encodeURIComponent(mailId)}/attachments/${encodeURIComponent(file.id)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Embedded image unavailable");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== file.size || bytes.byteLength > 524288) throw new Error("Embedded image limit");
      if (!active) return;
      const src = URL.createObjectURL(new Blob([bytes], { type: file.contentType.toLowerCase() }));
      urls.push(src);
      setState((current) => ({ binding, sources: { ...current.sources, [file.id]: { src } } }));
    })().catch(() => { if (active) setState((current) => ({ binding, sources: { ...current.sources, [file.id]: { failed: true } } })); });
    return () => { active = false; controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [mailId, fileKey, binding]);
  return state.binding === binding ? state.sources : {};
}

function FormattedImage({ mailId, src, alt, style, ...presentation }: { mailId?: string; src: string; alt: string; style: CSSProperties } & Presentation) {
  const remote = useRemoteImage(mailId, src);
  if (remote.failed || remote.retrying) return <span className="formatted-mail-image" style={{ display: "contents" }}>
    <ImagePlaceholder {...presentation} style={style} reason={remote.failed ? "Image could not be loaded." : "Loading image…"} />
  </span>;
  // `display: contents` keeps the image in the sender's line, so its own
  // vertical-align and float apply as they would in a mail client.
  return <span className="formatted-mail-image" style={{ display: "contents" }}>
    <img {...presentation} src={remote.src} alt={alt} referrerPolicy="no-referrer" decoding="async" loading="lazy"
      // The sender's declared shape wins: a px width and height become an
      // aspect ratio so spacers and dividers keep their proportions when
      // max-width narrows them, a declared height alone stays fixed, and
      // unsized images keep their natural shape.
      style={{ ...style, maxWidth: "100%", ...imageShape(style) }}
      onError={remote.onError} />
  </span>;
}

const pxLength = (value: unknown) =>
  typeof value === "string" ? /^(\d+(?:\.\d+)?)px$/.exec(value)?.[1] : undefined;
function imageShape(style: CSSProperties): CSSProperties {
  const width = pxLength(style.width), height = pxLength(style.height);
  if (width && height) return { height: "auto", aspectRatio: `${width} / ${height}` };
  if (style.height !== undefined) return { height: style.height };
  return { height: "auto" };
}

// HTML's align attribute as browsers apply it: a centered table gets auto
// margins, an aligned image floats, and other elements use the -webkit- text
// alignment that also centers nested tables, which mail layouts rely on.
function legacyAlign(tag: string, align: string): CSSProperties {
  if (tag === "center") return { textAlign: "-webkit-center" as CSSProperties["textAlign"] };
  if (tag === "table") return align === "center" ? { marginLeft: "auto", marginRight: "auto" }
    : align === "left" ? { float: "left" } : align === "right" ? { float: "right" } : {};
  if (tag === "img") return align === "left" || align === "right" ? { float: align }
    : /^(top|middle|bottom|baseline)$/.test(align) ? { verticalAlign: align } : {};
  if (align === "justify") return { textAlign: "justify" };
  return /^(left|center|right)$/.test(align) ? { textAlign: `-webkit-${align}` as CSSProperties["textAlign"] } : {};
}

const blockTags = new Set("div p br hr h1 h2 h3 h4 h5 h6 blockquote pre ul ol li table tr td th caption center".split(" "));
function contentParts(nodes: MailContentNode[]): string[] {
  return nodes.flatMap((node) => typeof node === "string" ? [node] :
    [...contentParts(node.children), ...(blockTags.has(node.tag) ? ["\n"] : [])]);
}

function hasText(nodes: readonly MailContentNode[]): boolean {
  return nodes.some((node) => typeof node === "string" ? !!node.trim() : hasText(node.children));
}

function hasImage(nodes: MailContentNode[], attachments: readonly MailAttachment[] = []): boolean {
  return nodes.some((node) => {
    if (typeof node === "string") return false;
    const embedded = !!embeddedAttachment(node.attributes.src || "", attachments);
    return node.tag === "img" && (!!imageSource(node.attributes.src || "") || embedded) || hasImage(node.children, attachments);
  });
}
