import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as monaco from 'monaco-editor';
import { FileDiff, Comment } from '../types';
import { DiffEditorHandle } from '../App';

export type ViewMode = 'comment' | 'edit';

let extensionToLanguageMap: Map<string, string> | null = null;

function getLanguageFromPath(path: string): string {
  const extension = "." + (path.split(".").pop()?.toLowerCase() || "");

  if (!extensionToLanguageMap) {
    extensionToLanguageMap = new Map();
    const languages = monaco.languages.getLanguages();

    for (const language of languages) {
      if (language.extensions) {
        for (const ext of language.extensions) {
          extensionToLanguageMap.set(ext.toLowerCase(), language.id);
        }
      }
    }
  }

  return extensionToLanguageMap.get(extension) || "plaintext";
}

interface DiffEditorProps {
  fileDiff: FileDiff;
  comments: Comment[];
  mode: ViewMode;
  onContentChange: (content: string) => void;
  onAddComment: (line: number, side: 'left' | 'right', text: string, selectedText?: string, startLine?: number, endLine?: number) => void;
  onNextFile?: () => void;
  onPreviousFile?: () => void;
  onNextChange?: () => void;
  onPreviousChange?: () => void;
}

const DiffEditor = forwardRef<DiffEditorHandle, DiffEditorProps>(({
  fileDiff,
  comments,
  mode,
  onContentChange,
  onAddComment,
  onNextFile,
  onPreviousFile,
  onNextChange,
  onPreviousChange
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [showCommentDialog, setShowCommentDialog] = useState<{
    line: number;
    side: 'left' | 'right';
    x: number;
    y: number;
    selectedText?: string;
    startLine?: number;
    endLine?: number;
  } | null>(null);
  const [commentText, setCommentText] = useState('');
  const currentHoveredLineRef = useRef<{left: number | null, right: number | null}>({left: null, right: null});
  const visibleGlyphsRef = useRef<Set<string>>(new Set());
  const currentChangeIndexRef = useRef<number>(-1);
  const onNextFileRef = useRef(onNextFile);
  const onPreviousFileRef = useRef(onPreviousFile);
  const onNextChangeRef = useRef(onNextChange);
  const onPreviousChangeRef = useRef(onPreviousChange);
  const modeRef = useRef<ViewMode>(mode);
  const hoverDecorationsRef = useRef<string[]>([]);

  // Keep modeRef in sync with mode prop and update editor options
  useEffect(() => {
    modeRef.current = mode;
    if (editorRef.current) {
      const modifiedEditor = editorRef.current.getModifiedEditor();
      modifiedEditor.updateOptions({ readOnly: mode === 'comment' });

      // Clear hover decorations when switching to edit mode
      if (mode === 'edit' && hoverDecorationsRef.current.length > 0) {
        hoverDecorationsRef.current = modifiedEditor.deltaDecorations(
          hoverDecorationsRef.current,
          []
        );
      }
    }
  }, [mode]);

  // Keep refs up to date
  useEffect(() => {
    onNextFileRef.current = onNextFile;
    onPreviousFileRef.current = onPreviousFile;
    onNextChangeRef.current = onNextChange;
    onPreviousChangeRef.current = onPreviousChange;
  }, [onNextFile, onPreviousFile, onNextChange, onPreviousChange]);

  // Expose navigation methods to parent
  useImperativeHandle(ref, () => ({
    goToNextChange: () => {
      const editor = editorRef.current;
      if (!editor) return;

      const lineChanges = editor.getLineChanges();
      if (!lineChanges || lineChanges.length === 0) {
        // No changes in this file, try next file
        onNextFileRef.current?.();
        return;
      }

      const modifiedEditor = editor.getModifiedEditor();
      const visibleRanges = modifiedEditor.getVisibleRanges();
      const viewBottom = visibleRanges.length > 0 ? visibleRanges[0].endLineNumber : 0;

      // Find the next change that starts below the current view
      let nextIdx = -1;
      for (let i = 0; i < lineChanges.length; i++) {
        const changeLine = lineChanges[i].modifiedStartLineNumber || 1;
        if (changeLine > viewBottom) {
          nextIdx = i;
          break;
        }
      }

      if (nextIdx === -1) {
        // No more changes below current view, try to go to next file
        if (onNextFileRef.current) {
          onNextFileRef.current();
        }
        return;
      }

      const change = lineChanges[nextIdx];
      const targetLine = change.modifiedStartLineNumber || 1;
      modifiedEditor.revealLineInCenter(targetLine);
      modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
      currentChangeIndexRef.current = nextIdx;
    },
    goToPreviousChange: () => {
      const editor = editorRef.current;
      if (!editor) return;

      const lineChanges = editor.getLineChanges();
      if (!lineChanges || lineChanges.length === 0) {
        // No changes in this file, try previous file
        onPreviousFileRef.current?.();
        return;
      }

      const modifiedEditor = editor.getModifiedEditor();
      const prevIdx = currentChangeIndexRef.current <= 0 ? -1 : currentChangeIndexRef.current - 1;

      if (prevIdx < 0) {
        // At start of file, try to go to previous file
        if (onPreviousFileRef.current) {
          onPreviousFileRef.current();
          return;
        }
        // No previous file, go to first change
        const change = lineChanges[0];
        const targetLine = change.modifiedStartLineNumber || 1;
        modifiedEditor.revealLineInCenter(targetLine);
        modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
        currentChangeIndexRef.current = 0;
        return;
      }

      const change = lineChanges[prevIdx];
      const targetLine = change.modifiedStartLineNumber || 1;
      modifiedEditor.revealLineInCenter(targetLine);
      modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
      currentChangeIndexRef.current = prevIdx;
    },
    resetChangeIndex: () => {
      currentChangeIndexRef.current = -1;
    }
  }), []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create models
    const language = getLanguageFromPath(fileDiff.path);
    const originalModel = monaco.editor.createModel(
      fileDiff.oldContent,
      language,
      monaco.Uri.file(`original-${fileDiff.path}`)
    );

    const modifiedModel = monaco.editor.createModel(
      fileDiff.newContent,
      language,
      monaco.Uri.file(`modified-${fileDiff.path}`)
    );

    // Create diff editor with light theme
    // Start in read-only mode (comment mode is default)
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'vs',
      readOnly: modeRef.current === 'comment',
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      renderIndicators: true,
      renderMarginRevertIcon: false, // Disable the revert arrows
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: true,
      wordWrap: 'on',
      glyphMargin: true,
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 4,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      lightbulb: { enabled: false },
      codeLens: false,
      contextmenu: true,
      links: false
    });

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    editorRef.current = diffEditor;

    // Listen for content changes on the modified editor
    const modifiedEditor = diffEditor.getModifiedEditor();
    const originalEditor = diffEditor.getOriginalEditor();

    // Reset change index for new file
    currentChangeIndexRef.current = -1;

    // Auto-scroll to first diff when Monaco finishes computing it (once per file)
    let hasScrolledToFirstChange = false;
    const scrollToFirstChange = () => {
      if (hasScrolledToFirstChange) return;
      const changes = diffEditor.getLineChanges();
      if (changes && changes.length > 0) {
        hasScrolledToFirstChange = true;
        const firstChange = changes[0];
        const targetLine = firstChange.modifiedStartLineNumber || 1;
        modifiedEditor.revealLineInCenter(targetLine);
        modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
        currentChangeIndexRef.current = 0;
      }
    };

    // Try immediately in case diff is already computed, then listen for update
    scrollToFirstChange();
    const diffUpdateDisposable = diffEditor.onDidUpdateDiff(scrollToFirstChange);

    // Add keybindings to both editors to prevent Monaco from intercepting our shortcuts
    const addKeybindings = (editor: monaco.editor.IStandaloneCodeEditor) => {
      // Ctrl+N: next change (or next file if at end)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
        const lineChanges = diffEditor.getLineChanges();

        // No changes in file - go to next file
        if (!lineChanges || lineChanges.length === 0) {
          onNextFileRef.current?.();
          return;
        }

        const currentLine = modifiedEditor.getPosition()?.lineNumber ?? 0;

        // Find the next change after current position
        let foundNext = false;
        for (let i = 0; i < lineChanges.length; i++) {
          const change = lineChanges[i];
          const changeLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
          if (changeLine > currentLine) {
            currentChangeIndexRef.current = i;
            const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
            modifiedEditor.revealLineInCenter(targetLine);
            modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
            foundNext = true;
            break;
          }
        }

        // No more changes after current position - go to next file
        if (!foundNext) {
          onNextFileRef.current?.();
        }
      });

      // Ctrl+P: previous change (or previous file if at start)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
        const lineChanges = diffEditor.getLineChanges();

        // No changes in file - go to previous file
        if (!lineChanges || lineChanges.length === 0) {
          onPreviousFileRef.current?.();
          return;
        }

        const currentLine = modifiedEditor.getPosition()?.lineNumber ?? Infinity;

        // Find the previous change before current position
        let foundPrev = false;
        for (let i = lineChanges.length - 1; i >= 0; i--) {
          const change = lineChanges[i];
          const changeLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
          if (changeLine < currentLine) {
            currentChangeIndexRef.current = i;
            const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
            modifiedEditor.revealLineInCenter(targetLine);
            modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
            foundPrev = true;
            break;
          }
        }

        // No more changes before current position - go to previous file
        if (!foundPrev) {
          onPreviousFileRef.current?.();
        }
      });

      // Ctrl+J: next file
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, () => {
        onNextFileRef.current?.();
      });

      // Ctrl+K: previous file
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        onPreviousFileRef.current?.();
      });
    };

    addKeybindings(modifiedEditor);
    addKeybindings(originalEditor);
    modifiedEditor.onDidChangeModelContent(() => {
      const content = modifiedEditor.getValue();
      onContentChange(content);
    });

    // Helper function to clear all visible glyphs
    const clearAllVisibleGlyphs = () => {
      visibleGlyphsRef.current.forEach((glyphId) => {
        const element = containerRef.current?.querySelector(`.${glyphId}`);
        if (element) {
          element.classList.remove('hover-visible');
        }
      });
      visibleGlyphsRef.current.clear();
    };

    // Helper function to toggle glyph visibility for a specific line
    const toggleGlyphVisibility = (lineNumber: number, visible: boolean, side: 'left' | 'right') => {
      if (visible) {
        clearAllVisibleGlyphs();
      }

      const glyphId = `comment-glyph-${side}-${lineNumber}`;
      const element = containerRef.current?.querySelector(`.${glyphId}`);
      if (element) {
        if (visible) {
          element.classList.add('hover-visible');
          visibleGlyphsRef.current.add(glyphId);
        } else {
          element.classList.remove('hover-visible');
          visibleGlyphsRef.current.delete(glyphId);
        }
      }
    };
    
    // Add glyph decorations on ALL lines for both editors
    const originalLineCount = originalModel.getLineCount();
    const originalDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (let i = 1; i <= originalLineCount; i++) {
      originalDecorations.push({
        range: new monaco.Range(i, 1, i, 1),
        options: {
          glyphMarginClassName: `comment-glyph-decoration comment-glyph-left-${i}`,
          glyphMarginHoverMessage: { value: 'Click to add comment' }
        }
      });
    }
    originalEditor.deltaDecorations([], originalDecorations);
    
    const modifiedLineCount = modifiedModel.getLineCount();
    const modifiedDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (let i = 1; i <= modifiedLineCount; i++) {
      modifiedDecorations.push({
        range: new monaco.Range(i, 1, i, 1),
        options: {
          glyphMarginClassName: `comment-glyph-decoration comment-glyph-right-${i}`,
          glyphMarginHoverMessage: { value: 'Click to add comment' }
        }
      });
    }
    modifiedEditor.deltaDecorations([], modifiedDecorations);

    // Add mouse move handler for original editor (comment mode only)
    originalEditor.onMouseMove((e) => {
      // Only show hover effects in comment mode
      if (modeRef.current !== 'comment') {
        if (currentHoveredLineRef.current.left !== null) {
          toggleGlyphVisibility(currentHoveredLineRef.current.left, false, 'left');
          currentHoveredLineRef.current.left = null;
        }
        return;
      }
      if (e.target.position) {
        const lineNumber = e.target.position.lineNumber;
        const currentHovered = currentHoveredLineRef.current.left;

        if (currentHovered !== lineNumber) {
          if (currentHovered !== null) {
            toggleGlyphVisibility(currentHovered, false, 'left');
          }
          toggleGlyphVisibility(lineNumber, true, 'left');
          currentHoveredLineRef.current.left = lineNumber;
        }
      }
    });

    // Clear glyphs when mouse leaves the editor
    originalEditor.onMouseLeave(() => {
      if (currentHoveredLineRef.current.left !== null) {
        toggleGlyphVisibility(currentHoveredLineRef.current.left, false, 'left');
        currentHoveredLineRef.current.left = null;
      }
    });

    // Add mouse move handler for modified editor (comment mode only)
    modifiedEditor.onMouseMove((e) => {
      // Only show hover effects in comment mode
      if (modeRef.current !== 'comment') {
        if (currentHoveredLineRef.current.right !== null) {
          toggleGlyphVisibility(currentHoveredLineRef.current.right, false, 'right');
          currentHoveredLineRef.current.right = null;
        }
        return;
      }
      if (e.target.position) {
        const lineNumber = e.target.position.lineNumber;
        const currentHovered = currentHoveredLineRef.current.right;

        if (currentHovered !== lineNumber) {
          if (currentHovered !== null) {
            toggleGlyphVisibility(currentHovered, false, 'right');
          }
          toggleGlyphVisibility(lineNumber, true, 'right');
          currentHoveredLineRef.current.right = lineNumber;
        }
      }
    });

    // Clear glyphs when mouse leaves the editor
    modifiedEditor.onMouseLeave(() => {
      if (currentHoveredLineRef.current.right !== null) {
        toggleGlyphVisibility(currentHoveredLineRef.current.right, false, 'right');
        currentHoveredLineRef.current.right = null;
      }
    });
    
    // Helper to open comment dialog
    const openCommentDialog = (
      editor: monaco.editor.IStandaloneCodeEditor,
      position: monaco.Position,
      side: 'left' | 'right',
      mouseEvent: MouseEvent
    ) => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      let selectedText = '';
      let startLine = position.lineNumber;
      let endLine = position.lineNumber;

      if (selection && !selection.isEmpty() && model) {
        selectedText = model.getValueInRange(selection);
        startLine = selection.startLineNumber;
        endLine = selection.endLineNumber;
      } else {
        selectedText = model?.getLineContent(position.lineNumber) || '';
      }

      setShowCommentDialog({
        line: startLine,
        side,
        x: mouseEvent.clientX + 100,
        y: mouseEvent.clientY,
        selectedText,
        startLine,
        endLine
      });
    };

    // Glyph click handler for original editor (comment mode only)
    originalEditor.onMouseDown((e) => {
      if (modeRef.current !== 'comment') return;
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        e.event.preventDefault();
        const position = e.target.position;
        if (position) {
          const mouseEvent = e.event.browserEvent as MouseEvent;
          openCommentDialog(originalEditor, position, 'left', mouseEvent);
        }
      }
    });

    // Glyph click handler for modified editor (comment mode only)
    modifiedEditor.onMouseDown((e) => {
      if (modeRef.current !== 'comment') return;

      const isGlyphClick = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
      const isLineClick =
        e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT ||
        e.target.type === monaco.editor.MouseTargetType.CONTENT_EMPTY;

      if (isGlyphClick || isLineClick) {
        e.event.preventDefault();
        const position = e.target.position;
        if (position) {
          const mouseEvent = e.event.browserEvent as MouseEvent;
          openCommentDialog(modifiedEditor, position, 'right', mouseEvent);
        }
      }
    });

    return () => {
      diffUpdateDisposable.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      diffEditor.dispose();
    };
  }, [fileDiff]);

  // Render comment decorations
  useEffect(() => {
    if (!editorRef.current || comments.length === 0) return;

    const originalEditor = editorRef.current.getOriginalEditor();
    const modifiedEditor = editorRef.current.getModifiedEditor();

    const leftComments = comments.filter(c => c.side === 'left');
    const rightComments = comments.filter(c => c.side === 'right');

    // Add decorations for left side comments
    if (leftComments.length > 0) {
      const leftDecorations = leftComments.map(comment => ({
        range: new monaco.Range(comment.line, 1, comment.line, 1),
        options: {
          isWholeLine: true,
          className: 'comment-line-light',
          glyphMarginClassName: 'comment-glyph-light',
          hoverMessage: {
            value: `**${comment.author}**: ${comment.text}`
          }
        }
      }));
      originalEditor.deltaDecorations([], leftDecorations);
    }

    // Add decorations for right side comments
    if (rightComments.length > 0) {
      const rightDecorations = rightComments.map(comment => ({
        range: new monaco.Range(comment.line, 1, comment.line, 1),
        options: {
          isWholeLine: true,
          className: 'comment-line-light',
          glyphMarginClassName: 'comment-glyph-light',
          hoverMessage: {
            value: `**${comment.author}**: ${comment.text}`
          }
        }
      }));
      modifiedEditor.deltaDecorations([], rightDecorations);
    }
  }, [comments]);

  const handleAddComment = () => {
    if (!showCommentDialog || !commentText.trim()) return;
    onAddComment(
      showCommentDialog.line,
      showCommentDialog.side,
      commentText,
      showCommentDialog.selectedText,
      showCommentDialog.startLine,
      showCommentDialog.endLine
    );
    setShowCommentDialog(null);
    setCommentText('');
  };

  const sideLabel = showCommentDialog?.side === 'left' ? 'old' : 'new';

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%'
        }}
      />

      {/* Comment Dialog */}
      {showCommentDialog && (
        <div
          style={{
            position: 'fixed',
            left: showCommentDialog.x - 200,
            top: Math.min(showCommentDialog.y, window.innerHeight - 350),
            width: '500px',
            backgroundColor: '#ffffff',
            border: '1px solid #ced4da',
            borderRadius: '6px',
            padding: '16px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000
          }}
        >
          <h4 style={{ margin: '0 0 12px 0', color: '#495057' }}>
            Add Comment (Line{showCommentDialog.startLine !== showCommentDialog.endLine ? `s ${showCommentDialog.startLine}-${showCommentDialog.endLine}` : ` ${showCommentDialog.line}`}, {sideLabel})
          </h4>
          {showCommentDialog.selectedText && (
            <div style={{
              marginBottom: '12px',
              padding: '8px',
              backgroundColor: '#f8f9fa',
              border: '1px solid #e9ecef',
              borderRadius: '4px',
              fontSize: '12px',
              fontFamily: 'monospace',
              maxHeight: '190px',
              overflowY: 'auto',
              overflowX: 'auto',
              whiteSpace: 'pre',
              lineHeight: '19px'
            }}>
              {showCommentDialog.selectedText}
            </div>
          )}
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Enter your comment..."
            style={{
              width: '100%',
              height: '120px',
              backgroundColor: '#ffffff',
              color: '#495057',
              border: '1px solid #ced4da',
              borderRadius: '4px',
              padding: '8px',
              fontSize: '14px',
              resize: 'vertical',
              outline: 'none'
            }}
            autoFocus
          />
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '12px'
          }}>
            <button
              onClick={() => setShowCommentDialog(null)}
              style={{
                padding: '6px 12px',
                backgroundColor: '#6c757d',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddComment}
              style={{
                padding: '6px 12px',
                backgroundColor: '#007bff',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Add Comment
            </button>
          </div>
        </div>
      )}

      <style>{`
        .comment-line-light {
          background-color: rgba(255, 193, 7, 0.2) !important;
        }
        .comment-glyph-light {
          background-color: #ffc107;
          width: 16px !important;
          height: 16px !important;
          border-radius: 50%;
          margin: 2px;
          border: 2px solid #ffffff;
        }
        .comment-glyph-light::after {
          content: '💬';
          font-size: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
        }
        
        /* Comment glyph decoration - hidden by default, shown on hover */
        .comment-glyph-decoration {
          width: 16px !important;
          height: 18px !important;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        
        .comment-glyph-decoration::before {
          content: '💬';
          font-size: 12px;
          line-height: 18px;
          width: 16px;
          height: 18px;
          display: block;
          text-align: center;
        }
        
        .comment-glyph-decoration.hover-visible {
          opacity: 1;
        }
      `}</style>
    </div>
  );
});

export default DiffEditor;
