# proofscan Website

Official website for proofscan - MCP/A2A Observability Tool.

## 🌐 Live Site

**Development:** https://3000-iw35nsaqm9qdkp4rrysva-583b4d74.sandbox.novita.ai

## 🚀 Quick Start

### Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

### Build

```bash
npm run build
```

Output in `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## 📁 Structure

```
website/
├── index.html              # Entry point
├── package.json
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript config
└── src/
    ├── main.tsx           # React entry
    ├── App.tsx            # Main app component
    ├── components/        # Reusable components
    │   ├── Header.tsx
    │   └── Footer.tsx
    ├── pages/            # Page components
    │   ├── Home.tsx
    │   ├── Features.tsx
    │   ├── UseCases.tsx
    │   ├── Docs.tsx
    │   └── docs/        # Documentation pages
    │       ├── GettingStarted.tsx
    │       └── ...
    └── styles/          # Global styles
        └── index.css
```

## 🎨 Design

- **Theme:** Light theme (inspired by OpenClaw and Claude Code Docs)
- **Framework:** Vite + React + TypeScript
- **Routing:** React Router v7
- **Styling:** Custom CSS with CSS variables
- **Responsive:** Mobile-first design

## 📄 Pages

### Home (/)
- Hero section with CTA
- Key features overview
- CLI demo section
- Use cases preview
- Final CTA

### Features (/features)
- Detailed feature explanations
- 7 major features with deep-dive sections
- Code examples and use cases

### Use Cases (/use-cases)
- 7 real-world scenarios
- Problem → Solution → Result format
- Command examples

### Docs (/docs/*)
- Sidebar navigation
- Getting Started (complete)
- CLI Guide, Shell Mode, Proxy, etc. (linked to GitHub docs)

## 🔧 Tech Stack

- **Vite** 7.3.1 - Build tool
- **React** 19.2.4 - UI library
- **React Router** 7.13.0 - Routing
- **TypeScript** 5.9.3 - Type safety

## 🚀 Deployment

### Cloudflare Pages

```bash
npm run build
# Deploy dist/ directory to Cloudflare Pages
```

### Vercel

```bash
npm run build
# Deploy with Vercel CLI or GitHub integration
```

### Netlify

```bash
npm run build
# Deploy dist/ directory to Netlify
```

## 📝 TODO

- [ ] Complete all documentation pages (CLI Guide, Shell Mode, etc.)
- [ ] Add dark mode support
- [ ] Add search functionality
- [ ] Add code block copy buttons
- [ ] SEO optimization (meta tags, Open Graph)
- [ ] Add analytics (Google Analytics or Plausible)
- [ ] Generate sitemap
- [ ] Add favicon and logo assets

## 🤝 Contributing

This website is part of the proofscan project. For contributing guidelines, see the main [CONTRIBUTING.md](../CONTRIBUTING.md).

## 📄 License

MIT - See [LICENSE](../LICENSE) for details.

## 🔗 Links

- **Main Repository:** https://github.com/proofofprotocol/proofscan
- **NPM Package:** https://www.npmjs.com/package/proofscan
- **Documentation:** https://github.com/proofofprotocol/proofscan/tree/main/docs
