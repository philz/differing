import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as monaco from 'monaco-editor';
import { FileDiff, Comment } from '../types';
import { DiffEditorHandle } from '../App';

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
  onContentChange: (content: string) => void;
  onAddComment: (line: number, side: 'left' | 'right', text: string, selectedText?: string, startLine?: number, endLine?: number) => void;
  onNextFile?: () => void;
  onPreviousFile?: () => void;
}

const DiffEditor = forwardRef<DiffEditorHandle, DiffEditorProps>(({
  fileDiff,
  comments,
  onContentChange,
  onAddComment,
  onNextFile,
  onPreviousFile
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

  // Expose navigation methods to parent
  useImperativeHandle(ref, () => ({
    goToNextChange: () => {
      const editor = editorRef.current;
      if (!editor) return;

      const lineChanges = editor.getLineChanges();
      if (!lineChanges || lineChanges.length === 0) return;

      const modifiedEditor = editor.getModifiedEditor();
      const currentLine = modifiedEditor.getPosition()?.lineNumber ?? 0;

      // Find the next change after current position
      let nextIndex = currentChangeIndexRef.current + 1;
      if (nextIndex >= lineChanges.length) {
        nextIndex = 0; // Wrap around to first change
      }

      // Or find the first change that starts after current line
      for (let i = 0; i < lineChanges.length; i++) {
        const change = lineChanges[i];
        const changeLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
        if (changeLine > currentLine) {
          nextIndex = i;
          break;
        }
      }

      currentChangeIndexRef.current = nextIndex;
      const change = lineChanges[nextIndex];
      const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber;

      modifiedEditor.revealLineInCenter(targetLine);
      modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
    },
    goToPreviousChange: () => {
      const editor = editorRef.current;
      if (!editor) return;

      const lineChanges = editor.getLineChanges();
      if (!lineChanges || lineChanges.length === 0) return;

      const modifiedEditor = editor.getModifiedEditor();
      const currentLine = modifiedEditor.getPosition()?.lineNumber ?? Infinity;

      // Find the previous change before current position
      let prevIndex = currentChangeIndexRef.current - 1;
      if (prevIndex < 0) {
        prevIndex = lineChanges.length - 1; // Wrap around to last change
      }

      // Or find the last change that starts before current line
      for (let i = lineChanges.length - 1; i >= 0; i--) {
        const change = lineChanges[i];
        const changeLine = change.modifiedStartLineNumber || change.originalStartLineNumber;
        if (changeLine < currentLine) {
          prevIndex = i;
          break;
        }
      }

      currentChangeIndexRef.current = prevIndex;
      const change = lineChanges[prevIndex];
      const targetLine = change.modifiedStartLineNumber || change.originalStartLineNumber;

      modifiedEditor.revealLineInCenter(targetLine);
      modifiedEditor.setPosition({ lineNumber: targetLine, column: 1 });
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
    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'vs',
      readOnly: false,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      renderIndicators: true,
      renderMarginRevertIcon: false, // Disable the revert arrows
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
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

    // Add keybindings to both editors to prevent Monaco from intercepting our shortcuts
    const addKeybindings = (editor: monaco.editor.IStandaloneCodeEditor) => {
      // Ctrl+N: next change (or next file if at end)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
        const lineChanges = diffEditor.getLineChanges();

        // No changes in file - go to next file
        if (!lineChanges || lineChanges.length === 0) {
          onNextFile?.();
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
          onNextFile?.();
        }
      });

      // Ctrl+P: previous change (or previous file if at start)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
        const lineChanges = diffEditor.getLineChanges();

        // No changes in file - go to previous file
        if (!lineChanges || lineChanges.length === 0) {
          onPreviousFile?.();
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
          onPreviousFile?.();
        }
      });

      // Ctrl+J: next file
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, () => {
        onNextFile?.();
      });

      // Ctrl+K: previous file
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        onPreviousFile?.();
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

    // Add mouse move handler for original editor
    originalEditor.onMouseMove((e) => {
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

    // Add mouse move handler for modified editor
    modifiedEditor.onMouseMove((e) => {
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
    
    // Simple glyph click handler for original editor
    originalEditor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        e.event.preventDefault();
        const position = e.target.position;
        if (position) {
          const model = originalEditor.getModel();
          const selection = originalEditor.getSelection();
          let selectedText = '';
          let startLine = position.lineNumber;
          let endLine = position.lineNumber;
          
          // Check if there's an active selection
          if (selection && !selection.isEmpty() && model) {
            selectedText = model.getValueInRange(selection);
            startLine = selection.startLineNumber;
            endLine = selection.endLineNumber;
          } else {
            // Fall back to line content if no selection
            selectedText = model?.getLineContent(position.lineNumber) || '';
          }
          
          // Use the actual mouse event coordinates for positioning
          const mouseEvent = e.event.browserEvent as MouseEvent;
          
          setShowCommentDialog({
            line: startLine,
            side: 'left',
            x: mouseEvent.clientX + 100,
            y: mouseEvent.clientY,
            selectedText: selectedText,
            startLine: startLine,
            endLine: endLine
          });
        }
      }
    });
    
    // Simple glyph click handler for modified editor
    modifiedEditor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        e.event.preventDefault();
        const position = e.target.position;
        if (position) {
          const model = modifiedEditor.getModel();
          const selection = modifiedEditor.getSelection();
          let selectedText = '';
          let startLine = position.lineNumber;
          let endLine = position.lineNumber;
          
          // Check if there's an active selection
          if (selection && !selection.isEmpty() && model) {
            selectedText = model.getValueInRange(selection);
            startLine = selection.startLineNumber;
            endLine = selection.endLineNumber;
          } else {
            // Fall back to line content if no selection
            selectedText = model?.getLineContent(position.lineNumber) || '';
          }
          
          // Use the actual mouse event coordinates for positioning
          const mouseEvent = e.event.browserEvent as MouseEvent;
          
          setShowCommentDialog({
            line: startLine,
            side: 'right',
            x: mouseEvent.clientX + 100,
            y: mouseEvent.clientY,
            selectedText: selectedText,
            startLine: startLine,
            endLine: endLine
          });
        }
      }
    });

    return () => {
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
            top: showCommentDialog.y,
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
