const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf-8');

const sections = {
  Header: { start: '<!-- ══════════ NAV ══════════ -->', end: '<!-- ══════════ HERO ══════════ -->' },
  Hero: { start: '<!-- ══════════ HERO ══════════ -->', end: '<!-- ══════════ HOW IT WORKS ══════════ -->' },
  Process: { start: '<!-- ══════════ HOW IT WORKS ══════════ -->', end: '<!-- ══════════ 3 ROLES ══════════ -->' },
  Roles: { start: '<!-- ══════════ 3 ROLES ══════════ -->', end: '<!-- ══════════ CLOSED MEETING ══════════ -->' },
  Meeting: { start: '<!-- ══════════ CLOSED MEETING ══════════ -->', end: '<!-- ══════════ REVENUE ══════════ -->' },
  Revenue: { start: '<!-- ══════════ REVENUE ══════════ -->', end: '<!-- ══════════ AI LAYER ══════════ -->' },
  AI: { start: '<!-- ══════════ AI LAYER ══════════ -->', end: '<!-- ══════════ ROADMAP ══════════ -->' },
  Roadmap: { start: '<!-- ══════════ ROADMAP ══════════ -->', end: '<!-- ══════════ MANIFESTO ══════════ -->' },
  Manifesto: { start: '<!-- ══════════ MANIFESTO ══════════ -->', end: '<!-- ══════════ TECH STACK ══════════ -->' },
  TechStack: { start: '<!-- ══════════ TECH STACK ══════════ -->', end: '<!-- ══════════ FINAL CTA ══════════ -->' },
  Footer: { start: '<!-- ══════════ FINAL CTA ══════════ -->', end: '</div><!-- /page-wrap -->' },
};

const componentsDir = path.join(__dirname, 'src', 'components');
if (!fs.existsSync(componentsDir)) {
  fs.mkdirSync(componentsDir, { recursive: true });
}

let renderImports = [];
let renderCalls = [];

for (const [name, markers] of Object.entries(sections)) {
  const startIdx = html.indexOf(markers.start);
  const endIdx = html.indexOf(markers.end);
  if (startIdx === -1 || endIdx === -1) {
    console.error(`Could not find markers for ${name}`);
    continue;
  }
  
  let content = html.substring(startIdx, endIdx).trim();
  // remove trailing <div class="divline"></div> if present at the end of the extracted block
  content = content.replace(/<div class="divline"><\/div>\s*$/, '').trim();

  const jsContent = `export const ${name} = () => \`\n${content}\n\`;\n`;
  fs.writeFileSync(path.join(componentsDir, `${name}.js`), jsContent);
  
  renderImports.push(`import { ${name} } from './components/${name}.js';`);
  renderCalls.push(`\${${name}()}`);
  if (name !== 'Header' && name !== 'Roadmap' && name !== 'Manifesto' && name !== 'TechStack' && name !== 'Footer') {
     renderCalls.push(`<div class="divline"></div>`);
  }
}

// Write render.js
const renderJs = `
${renderImports.join('\n')}

export function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = \`
    \${Header()}
    \${Hero()}
    <div class="divline"></div>
    \${Process()}
    <div class="divline"></div>
    \${Roles()}
    <div class="divline"></div>
    \${Meeting()}
    <div class="divline"></div>
    \${Revenue()}
    <div class="divline"></div>
    \${AI()}
    <div class="divline"></div>
    \${Roadmap()}
    \${Manifesto()}
    \${TechStack()}
    \${Footer()}
  \`;
}
`;
fs.writeFileSync(path.join(__dirname, 'src', 'render.js'), renderJs.trim());

// Extract inline scripts to animations.js
const scriptStart = html.indexOf('<script>');
const scriptEnd = html.indexOf('</script>', scriptStart);
let scriptContent = html.substring(scriptStart + 8, scriptEnd).trim();

// Since toggleLang is called inline onclick="toggleLang()", it needs to be attached to window
scriptContent = scriptContent.replace('function toggleLang(){', 'window.toggleLang = function(){');

fs.writeFileSync(path.join(__dirname, 'src', 'animations.js'), scriptContent);

// Build clean index.html
const headEnd = html.indexOf('</head>');
const headContent = html.substring(0, headEnd + 7);

const cleanHtml = `${headContent}
<body>
  <canvas id="canvas3d"></canvas>
  <div id="cur"></div>
  <div id="cur-ring"></div>
  <div class="page-wrap" id="app"></div>

  <script type="module">
    import { renderApp } from '/src/render.js';
    renderApp();
    // Re-initialize animations and scroll reveal after DOM injection
    import('/src/animations.js');
    import('/src/main.js');
  </script>
</body>
</html>`;

fs.writeFileSync(htmlPath, cleanHtml);

console.log('Extraction complete!');
