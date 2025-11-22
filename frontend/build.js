const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const isDev = process.argv.includes('--dev');
const outDir = path.join(__dirname, 'dist');

// Clean dist directory
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

// Copy Monaco editor assets
function copyMonacoAssets() {
  const monacoEditorDir = path.join(outDir, 'monaco', 'min', 'vs', 'editor');
  const codiconDir = path.join(outDir, 'monaco', 'min', 'vs', 'base', 'browser', 'ui', 'codicons', 'codicon');

  fs.mkdirSync(monacoEditorDir, { recursive: true });
  fs.mkdirSync(codiconDir, { recursive: true });

  // Copy Monaco editor CSS
  const editorCssPath = path.join(__dirname, 'node_modules', 'monaco-editor', 'min', 'vs', 'editor', 'editor.main.css');
  const editorCssDest = path.join(monacoEditorDir, 'editor.main.css');
  fs.copyFileSync(editorCssPath, editorCssDest);

  // Copy Codicon font
  const codiconFontPath = path.join(__dirname, 'node_modules', 'monaco-editor', 'min', 'vs', 'base', 'browser', 'ui', 'codicons', 'codicon', 'codicon.ttf');
  const codiconFontDest = path.join(codiconDir, 'codicon.ttf');
  fs.copyFileSync(codiconFontPath, codiconFontDest);

  console.log('✓ Copied Monaco assets');
}

// Build Monaco workers
async function buildMonacoWorkers() {
  const workers = [
    { name: 'editor.worker', entry: 'monaco-editor/esm/vs/editor/editor.worker.js' },
    { name: 'ts.worker', entry: 'monaco-editor/esm/vs/language/typescript/ts.worker.js' },
    { name: 'json.worker', entry: 'monaco-editor/esm/vs/language/json/json.worker.js' },
    { name: 'css.worker', entry: 'monaco-editor/esm/vs/language/css/css.worker.js' },
    { name: 'html.worker', entry: 'monaco-editor/esm/vs/language/html/html.worker.js' },
  ];

  for (const worker of workers) {
    await esbuild.build({
      entryPoints: [require.resolve(worker.entry)],
      bundle: true,
      format: 'iife',
      outfile: path.join(outDir, `${worker.name}.js`),
      minify: !isDev,
      sourcemap: isDev,
      logLevel: 'error',
    });
  }

  console.log('✓ Built Monaco workers');
}

// Build main app
async function buildApp() {
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'index.tsx')],
    bundle: true,
    format: 'esm',
    outfile: path.join(outDir, isDev ? 'bundle.js' : `bundle.${crypto.randomBytes(8).toString('hex')}.js`),
    minify: !isDev,
    sourcemap: true,
    loader: {
      '.ttf': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.eot': 'file',
      '.otf': 'file',
    },
    define: {
      'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
    },
    logLevel: 'info',
    metafile: true,
    publicPath: '/',
  });

  console.log('✓ Built main app');
  return result;
}

// Generate HTML
function generateHTML(bundleFilename) {
  const templatePath = path.join(__dirname, 'public', 'index.html');
  const template = fs.readFileSync(templatePath, 'utf-8');

  // Get CSS filename (same as JS but with .css extension)
  const cssFilename = bundleFilename.replace(/\.js$/, '.css');
  const cssPath = path.join(outDir, cssFilename);
  const hasCss = fs.existsSync(cssPath);

  // Inject CSS and script tags
  let html = template;
  
  if (hasCss) {
    html = html.replace(
      '</head>',
      `    <link rel="stylesheet" href="/${cssFilename}">\n</head>`
    );
  }
  
  html = html.replace(
    '</body>',
    `<script type="module" src="/${bundleFilename}"></script>\n</body>`
  );

  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log('✓ Generated index.html');
}

// Run TypeScript type checking
function typecheck() {
  console.log('Running TypeScript type checking...');
  const { execSync } = require('child_process');
  try {
    execSync('npm run typecheck', { stdio: 'inherit', cwd: __dirname });
    console.log('✓ TypeScript check passed');
  } catch (error) {
    console.error('✗ TypeScript check failed');
    process.exit(1);
  }
}

// Main build function
async function build() {
  try {
    console.log(`Building in ${isDev ? 'development' : 'production'} mode...`);

    // Run TypeScript type checking
    typecheck();

    // Copy Monaco assets
    copyMonacoAssets();

    // Build Monaco workers
    await buildMonacoWorkers();

    // Build main app
    const result = await buildApp();

    // Extract bundle filename from metafile
    const outfiles = Object.keys(result.metafile.outputs).filter(f => f.endsWith('.js') && !f.includes('worker'));
    const bundleFilename = path.basename(outfiles[0]);

    // Generate HTML
    generateHTML(bundleFilename);

    console.log('\n✅ Build complete!');
    console.log(`Output directory: ${outDir}`);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
