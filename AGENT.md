# Agent Development Guide

## Testing the Application

### Building and Running

```bash
# Build everything (frontend + backend into single binary)
make build

# Run the application
./differing -port 3845 -addr 0.0.0.0

# Or run in background
./differing -port 3845 -addr 0.0.0.0 &
```

### Frontend Development

```bash
# Install dependencies
cd frontend && npm install

# Build frontend only
cd frontend && npm run build

# Type check
cd frontend && npm run typecheck

# Lint
cd frontend && npm run lint
```

## Architecture Notes

### Comment System

- **Comments are entirely frontend-based** - stored in React state, no backend API
- Comments persist across file navigation within the same session
- Each comment includes:
  - `filePath`: which file the comment is on
  - `diffId`: which diff/commit the comment belongs to
  - `line`, `startLine`, `endLine`: line numbers
  - `side`: 'left' (old) or 'right' (new)
  - `selectedText`: the actual text that was selected when commenting
  - `text`: the comment text itself

### Component Structure

- `App.tsx`: Main app, manages all comments in state, filters by current file
- `SimpleDiffEditor.tsx`: Monaco diff editor wrapper, detects text selections
- `FloatingCommentPanel.tsx`: Displays all comments grouped by file

## Testing Comments Manually

1. Start the app and navigate to any diff
2. Select text in the editor (or just click a line)
3. Click the glyph margin (the area to the left of line numbers)
4. A comment dialog appears showing:
   - Selected text preview (up to 10 lines with scrollbars)
   - Large textarea (500px wide, 120px tall)
5. Enter comment text and click "Add Comment"
6. The line highlights in yellow
7. Switch to a different file
8. Add another comment
9. Open the Comments panel (button in header)
10. Verify both comments are shown, grouped by file
11. Switch back to the first file
12. Verify the comment highlight is still there

## Browser Testing with Sketch

When testing with the browser tools:

```javascript
// Select text in Monaco (doesn't work easily via automation)
// Instead, comments default to line content if no selection

// Trigger comment dialog by clicking glyph margin
const rightEditor = document.querySelectorAll('.monaco-editor')[1];
const glyphMargin = rightEditor.querySelector('.margin-view-overlays');
const rect = glyphMargin.getBoundingClientRect();
const mousedown = new MouseEvent('mousedown', {
  bubbles: true,
  clientX: rect.left + 10,
  clientY: rect.top + 100, // adjust Y for different lines
  button: 0
});
glyphMargin.dispatchEvent(mousedown);

// Enter comment text (need to use React's value setter)
const textarea = document.querySelector('textarea[placeholder="Enter your comment..."]');
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
).set;
nativeInputValueSetter.call(textarea, 'Your comment text');
textarea.dispatchEvent(new Event('input', { bubbles: true }));

// Click Add Comment button
const buttons = Array.from(document.querySelectorAll('button'));
const addButton = buttons.find(b => b.textContent.includes('Add Comment'));
addButton.click();

// Open Comments panel
const commentsButton = buttons.find(b => b.textContent.includes('Comments'));
commentsButton.click();
```

## Key Files

- `main.go`: Backend server, Git integration, NO comment storage
- `backend/main.go`: Old backend (not used in production build)
- `frontend/src/App.tsx`: Comment state management
- `frontend/src/components/SimpleDiffEditor.tsx`: Monaco editor, comment dialog
- `frontend/src/components/FloatingCommentPanel.tsx`: Comment display panel
- `frontend/src/types.ts`: TypeScript interfaces including Comment type
