/**
 * RichEditor.tsx
 *
 * TipTap-powered rich text editor for document section authoring.
 * Supports headings, bold/italic/underline, lists, links, and inline media (images + video).
 * Content is stored as HTML and is backward-compatible with plain-text content.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
  Video,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  Code,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Video iframe node (safe allowlist-based) ──────────────────────────────────
import { Node, mergeAttributes } from "@tiptap/core";

const APPROVED_EMBED_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
];

export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      caption: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-video-embed]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    const { src, caption } = HTMLAttributes;
    // Only render iframe for approved origins
    const isApproved = APPROVED_EMBED_ORIGINS.some((o) => src?.startsWith(o));
    return [
      "div",
      mergeAttributes({ "data-video-embed": "true", class: "video-embed my-4" }),
      isApproved
        ? [
            "iframe",
            {
              src,
              class: "w-full aspect-video rounded-2xl border border-white/10 shadow-xl shadow-black/30",
              frameborder: "0",
              allowfullscreen: "true",
              allow: "encrypted-media",
              loading: "lazy",
            },
          ]
        : ["p", { class: "text-red-500" }, "⚠ Unsupported video source"],
      caption ? ["p", { class: "mt-2 text-center text-xs text-white/35" }, caption] : ["span"],
    ];
  },
});

// ── Toolbar button helper ─────────────────────────────────────────────────────

function ToolBtn({
  onClick,
  active,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white",
        active && "bg-[#e5484d]/15 text-[#ff9b9b]",
        disabled && "cursor-not-allowed opacity-25"
      )}
    >
      {children}
    </button>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({
  editor,
  sectionId,
  onImageInserted,
}: {
  editor: Editor;
  sectionId: string;
  onImageInserted?: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageAlt, setImageAlt] = useState("");
  const [imageCaption, setImageCaption] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoCaption, setVideoCaption] = useState("");
  const [videoError, setVideoError] = useState("");
  const [videoSaving, setVideoSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLink = () => {
    const prev = editor.getAttributes("link").href ?? "";
    setLinkUrl(prev);
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!linkUrl.trim()) {
      editor.chain().focus().unsetLink().run();
    } else {
      editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
    }
    setLinkOpen(false);
  };

  const handleImageUpload = async () => {
    if (!imageFile) { setImageError("Please select an image file."); return; }
    setImageUploading(true);
    setImageError("");
    try {
      const form = new FormData();
      form.append("image", imageFile);
      form.append("altText", imageAlt);
      form.append("caption", imageCaption);
      const res = await fetch(`/api/document-sections/${sectionId}/media/images`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Upload failed (${res.status})`);
      }
      const data = await res.json();
      editor.chain().focus().setImage({ src: data.url, alt: imageAlt, title: imageCaption }).run();
      setImageOpen(false);
      setImageFile(null);
      setImageAlt("");
      setImageCaption("");
      onImageInserted?.();
    } catch (err) {
      setImageError((err as Error).message);
    } finally {
      setImageUploading(false);
    }
  };

  const handleVideoInsert = async () => {
    if (!videoUrl.trim()) { setVideoError("Please enter a video URL."); return; }
    setVideoSaving(true);
    setVideoError("");
    try {
      const res = await fetch(`/api/document-sections/${sectionId}/media/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: videoUrl.trim(), caption: videoCaption }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Validation failed (${res.status})`);
      }
      const data = await res.json();
      editor.chain().focus().insertContent({
        type: "videoEmbed",
        attrs: { src: data.embedUrl, caption: data.caption },
      }).run();
      setVideoOpen(false);
      setVideoUrl("");
      setVideoCaption("");
    } catch (err) {
      setVideoError((err as Error).message);
    } finally {
      setVideoSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.08] bg-[#10131a] px-4 py-3 sm:px-7">
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1"><Heading1 className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2"><Heading2 className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3"><Heading3 className="w-4 h-4" /></ToolBtn>
        <div className="mx-1 h-5 w-px bg-white/[0.1]" />
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold"><Bold className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic"><Italic className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code"><Code className="w-4 h-4" /></ToolBtn>
        <div className="mx-1 h-5 w-px bg-white/[0.1]" />
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list"><List className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Ordered list"><ListOrdered className="w-4 h-4" /></ToolBtn>
        <div className="mx-1 h-5 w-px bg-white/[0.1]" />
        <ToolBtn onClick={handleLink} active={editor.isActive("link")} title="Insert/edit link"><Link2 className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => setImageOpen(true)} title="Insert image"><ImageIcon className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => setVideoOpen(true)} title="Insert video embed"><Video className="w-4 h-4" /></ToolBtn>
        <div className="mx-1 h-5 w-px bg-white/[0.1]" />
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo className="w-4 h-4" /></ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo className="w-4 h-4" /></ToolBtn>
      </div>

      {/* Link dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-sm border-white/[0.1] bg-[#151922] text-white shadow-2xl shadow-black/50">
          <DialogHeader><DialogTitle>Insert link</DialogTitle></DialogHeader>
          <input
            className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b0e14] px-3 text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/60 focus:outline-none"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyLink()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={applyLink} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image upload dialog */}
      <Dialog open={imageOpen} onOpenChange={setImageOpen}>
        <DialogContent className="max-w-md border-white/[0.1] bg-[#151922] text-white shadow-2xl shadow-black/50">
          <DialogHeader><DialogTitle>Insert image</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/55">Image file (JPEG, PNG, GIF, or WebP — max 10 MB)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="rounded-xl border border-white/[0.1] bg-[#0b0e14] px-3 py-2 text-sm text-white file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-xs file:text-white/70"
                onChange={(e) => { setImageFile(e.target.files?.[0] ?? null); setImageError(""); }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/55">Alt text (required for accessibility)</label>
              <input
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b0e14] px-3 text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/60 focus:outline-none"
                placeholder="Describe the image…"
                value={imageAlt}
                onChange={(e) => setImageAlt(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/55">Caption (optional)</label>
              <input
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b0e14] px-3 text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/60 focus:outline-none"
                placeholder="Image caption…"
                value={imageCaption}
                onChange={(e) => setImageCaption(e.target.value)}
              />
            </div>
            {imageError && <p className="text-xs text-red-600">{imageError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImageOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleImageUpload} disabled={imageUploading || !imageFile} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
              {imageUploading ? "Uploading…" : "Insert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Video URL dialog */}
      <Dialog open={videoOpen} onOpenChange={setVideoOpen}>
        <DialogContent className="max-w-md border-white/[0.1] bg-[#151922] text-white shadow-2xl shadow-black/50">
          <DialogHeader><DialogTitle>Insert video embed</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/55">YouTube or Vimeo URL</label>
              <input
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b0e14] px-3 text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/60 focus:outline-none"
                placeholder="https://www.youtube.com/watch?v=…"
                value={videoUrl}
                onChange={(e) => { setVideoUrl(e.target.value); setVideoError(""); }}
                autoFocus
              />
              <p className="mt-1 text-xs text-white/35">Only YouTube and Vimeo HTTPS links are accepted.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/55">Caption (optional)</label>
              <input
                className="h-10 w-full rounded-xl border border-white/[0.1] bg-[#0b0e14] px-3 text-sm text-white placeholder:text-white/25 focus:border-[#e5484d]/60 focus:outline-none"
                placeholder="Video caption…"
                value={videoCaption}
                onChange={(e) => setVideoCaption(e.target.value)}
              />
            </div>
            {videoError && <p className="text-xs text-red-600">{videoError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVideoOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleVideoInsert} disabled={videoSaving || !videoUrl.trim()} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
              {videoSaving ? "Inserting…" : "Insert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main RichEditor component ─────────────────────────────────────────────────

interface RichEditorProps {
  sectionId: string;
  initialContent: string;
  /** "plain" = legacy plain text, "html" = TipTap HTML */
  contentFormat: "plain" | "html";
  readOnly?: boolean;
  onChange?: (html: string) => void;
  onImageInserted?: () => void;
}

export function RichEditor({
  sectionId,
  initialContent,
  contentFormat,
  readOnly = false,
  onChange,
  onImageInserted,
}: RichEditorProps) {
  const initialHtml =
    contentFormat === "html"
      ? initialContent
      : initialContent
        ? `<p>${initialContent.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`
        : "";

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      VideoEmbed,
    ],
    content: initialHtml,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
  });

  // Update content when section changes
  useEffect(() => {
    if (!editor) return;
    const newHtml =
      contentFormat === "html"
        ? initialContent
        : initialContent
          ? `<p>${initialContent.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`
          : "";
    if (editor.getHTML() !== newHtml) {
      editor.commands.setContent(newHtml, { emitUpdate: false });
    }
  }, [initialContent, contentFormat, editor]);

  if (!editor) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#0b0e14]">
      {!readOnly && (
        <Toolbar editor={editor} sectionId={sectionId} onImageInserted={onImageInserted} />
      )}
      <EditorContent
        editor={editor}
        className={cn(
          "flex-1 overflow-y-auto px-5 py-8 text-[15px] leading-8 text-white/75 focus-within:outline-none sm:px-12 sm:py-10",
          "prose prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-white prose-p:text-white/75 prose-strong:text-white prose-a:text-[#ff9b9b] prose-li:text-white/70",
          "[&_.ProseMirror]:mx-auto [&_.ProseMirror]:min-h-full [&_.ProseMirror]:max-w-3xl [&_.ProseMirror]:outline-none",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-white/25",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
          readOnly && "bg-[#0b0e14] cursor-default"
        )}
      />
    </div>
  );
}
