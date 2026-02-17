# OpenClaw Docs Design Analysis (Light Theme)

## 🎨 Design Characteristics

### Color Scheme (Light Theme)
- **Background**: White (#ffffff)
- **Secondary BG**: Light gray (#f8f9fa ~ #f3f4f6)
- **Primary Accent**: Blue (#3b82f6 ~ #2563eb)
- **Text Primary**: Dark gray/black (#1f2937 ~ #111827)
- **Text Secondary**: Medium gray (#6b7280)
- **Border**: Light gray (#e5e7eb)
- **Code BG**: Very light gray (#f9fafb)

### Layout Structure

#### 1. Header (Sticky)
```
┌─────────────────────────────────────────────────┐
│ Logo    Docs  Channels  Tools  [Search] GitHub │
└─────────────────────────────────────────────────┘
```
- Height: ~60px
- Background: White with bottom border
- Box shadow on scroll
- Logo + Navigation (left)
- Search bar (center/right)
- GitHub link (right)

#### 2. Main Layout (3-column)
```
┌──────────┬────────────────────┬──────────┐
│          │                    │          │
│ Sidebar  │  Main Content      │  TOC     │
│ (Nav)    │                    │ (On This │
│          │                    │  Page)   │
│  250px   │      flex-1        │  200px   │
└──────────┴────────────────────┴──────────┘
```

##### Left Sidebar (Navigation)
- Width: 240-260px
- Sticky position
- Collapsible categories
- Hierarchical structure
- Active page highlight (blue background)
- Hover states
- Category icons

##### Main Content Area
- Max-width: 800px
- Padding: 40px
- Clean typography
- Generous line-height (1.7)

##### Right Sidebar (On This Page - TOC)
- Width: 200-220px
- Sticky position
- Current section highlight
- Smooth scroll links
- Only visible on desktop

#### 3. Breadcrumbs
```html
Home > Documentation > Getting Started
```
- Above page title
- Light gray text
- Blue links on hover
- Separator: ">" or "/"

#### 4. Content Structure
```
Breadcrumbs
────────────
Page Title (h1)
Short description

## Section 1
Content...

## Section 2
Content...
```

### Typography

```css
/* Headings */
h1: 36px, 700 weight, #111827
h2: 28px, 600 weight, #1f2937, margin-top: 48px
h3: 22px, 600 weight, #374151, margin-top: 32px
h4: 18px, 600 weight, #4b5563

/* Body */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
font-size: 16px
line-height: 1.7
color: #374151

/* Code */
font-family: 'Monaco', 'Courier New', monospace
font-size: 14px
```

### UI Components

#### Code Blocks
```css
.code-block {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin: 24px 0;
  overflow-x: auto;
  position: relative;
}

/* Copy button */
.copy-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  background: #f3f4f6;
  border-color: #3b82f6;
}
```

#### Navigation Sidebar
```css
.sidebar {
  width: 260px;
  background: #ffffff;
  border-right: 1px solid #e5e7eb;
  position: sticky;
  top: 60px;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.sidebar-category {
  padding: 8px 16px;
  font-weight: 600;
  color: #6b7280;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-item {
  display: block;
  padding: 8px 16px;
  color: #4b5563;
  text-decoration: none;
  border-radius: 6px;
  margin: 2px 8px;
  transition: all 0.15s;
}

.sidebar-item:hover {
  background: #f3f4f6;
  color: #1f2937;
}

.sidebar-item.active {
  background: #dbeafe;
  color: #1e40af;
  font-weight: 500;
}
```

#### Table of Contents (Right Sidebar)
```css
.toc {
  width: 220px;
  position: sticky;
  top: 80px;
  padding: 16px;
}

.toc-title {
  font-weight: 600;
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 12px;
}

.toc-link {
  display: block;
  padding: 6px 0;
  padding-left: 16px;
  border-left: 2px solid #e5e7eb;
  font-size: 14px;
  color: #6b7280;
  text-decoration: none;
  transition: all 0.2s;
}

.toc-link:hover {
  color: #3b82f6;
  border-left-color: #3b82f6;
}

.toc-link.active {
  color: #2563eb;
  border-left-color: #2563eb;
  font-weight: 500;
}
```

#### Breadcrumbs
```css
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 16px;
}

.breadcrumb a {
  color: #6b7280;
  text-decoration: none;
  transition: color 0.2s;
}

.breadcrumb a:hover {
  color: #3b82f6;
}

.breadcrumb-separator {
  color: #d1d5db;
}
```

#### Info/Warning/Note Boxes
```css
.note {
  padding: 16px 20px;
  border-radius: 8px;
  margin: 24px 0;
  border-left: 4px solid;
}

.note.info {
  background: #eff6ff;
  border-left-color: #3b82f6;
  color: #1e40af;
}

.note.warning {
  background: #fef3c7;
  border-left-color: #f59e0b;
  color: #92400e;
}

.note.tip {
  background: #d1fae5;
  border-left-color: #10b981;
  color: #065f46;
}
```

#### Search Bar
```css
.search-bar {
  position: relative;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: 8px 16px 8px 40px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  background: #f9fafb;
  transition: all 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: #3b82f6;
  background: white;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #9ca3af;
}
```

### Responsive Behavior

#### Desktop (>1024px)
- 3-column layout (sidebar + content + TOC)
- Full navigation sidebar
- TOC visible

#### Tablet (768px - 1024px)
- 2-column layout (sidebar + content)
- TOC hidden
- Sidebar collapsible

#### Mobile (<768px)
- 1-column layout
- Sidebar as hamburger menu
- TOC in page top
- Full-width content

## ProofScan Adaptation

### Color Palette
```css
:root {
  /* Primary - Blue (docs standard) */
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --primary-light: #dbeafe;
  
  /* Background */
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-code: #f9fafb;
  
  /* Text */
  --text-primary: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  
  /* Border */
  --border-light: #e5e7eb;
  --border-medium: #d1d5db;
  
  /* Accent colors */
  --success: #10b981;
  --warning: #f59e0b;
  --info: #3b82f6;
}
```

### Page Structure Template
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>ProofScan Documentation</title>
  <link rel="stylesheet" href="/css/docs.css">
</head>
<body>
  <!-- Header -->
  <header class="docs-header">
    <div class="container">
      <a href="/" class="logo">ProofScan</a>
      <nav class="main-nav">
        <a href="/features.html">Features</a>
        <a href="/docs/">Docs</a>
        <a href="/examples.html">Examples</a>
      </nav>
      <div class="header-actions">
        <div class="search-bar">
          <input type="search" placeholder="Search docs...">
        </div>
        <a href="https://github.com/proofofprotocol/proofscan" class="github-link">
          GitHub
        </a>
      </div>
    </div>
  </header>

  <!-- Main Layout -->
  <div class="docs-layout">
    <!-- Sidebar -->
    <aside class="docs-sidebar">
      <nav>
        <div class="sidebar-category">Getting Started</div>
        <a href="/docs/guide.html" class="sidebar-item">User Guide</a>
        <a href="/installation.html" class="sidebar-item">Installation</a>
        
        <div class="sidebar-category">Modes</div>
        <a href="/docs/shell.html" class="sidebar-item">Shell Mode</a>
        <a href="/docs/proxy.html" class="sidebar-item">Proxy</a>
        
        <!-- ... -->
      </nav>
    </aside>

    <!-- Main Content -->
    <main class="docs-content">
      <!-- Breadcrumb -->
      <nav class="breadcrumb">
        <a href="/">Home</a>
        <span class="separator">›</span>
        <a href="/docs/">Documentation</a>
        <span class="separator">›</span>
        <span class="current">User Guide</span>
      </nav>

      <!-- Page Content -->
      <h1>User Guide</h1>
      <p class="lead">Complete guide to using ProofScan...</p>

      <h2 id="section-1">Section 1</h2>
      <p>Content...</p>

      <!-- ... -->
    </main>

    <!-- TOC -->
    <aside class="docs-toc">
      <div class="toc-title">On This Page</div>
      <a href="#section-1" class="toc-link">Section 1</a>
      <a href="#section-2" class="toc-link">Section 2</a>
      <!-- ... -->
    </aside>
  </div>
</body>
</html>
```
