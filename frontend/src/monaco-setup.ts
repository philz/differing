// Monaco Editor environment setup for esbuild
// This replaces the monaco-editor-webpack-plugin functionality

import * as monaco from 'monaco-editor';

// Configure Monaco environment
self.MonacoEnvironment = {
  getWorkerUrl: function (moduleId: string, label: string) {
    if (label === 'json') {
      return '/json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return '/css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return '/html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return '/ts.worker.js';
    }
    return '/editor.worker.js';
  },
};

// Disable semantic validation (import errors, config issues) but keep syntax validation
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true,
});

monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true,
});

export { monaco };
