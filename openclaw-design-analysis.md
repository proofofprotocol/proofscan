# OpenClaw Design Analysis for ProofScan Website

## 🎨 OpenClaw Design Characteristics

### Color Scheme
- **Primary**: Dark background (#0a0a0a ~ #1a1a1a)
- **Accent**: Vibrant orange/coral (#ff6b35 ~ #ff8c42) 
- **Text**: High contrast white on dark
- **Secondary**: Muted gray for descriptions
- **Code blocks**: Dark with syntax highlighting

### Typography
- **Headings**: Bold, sans-serif (Inter/System)
- **Body**: Clean, readable (16px base)
- **Code**: Monospace (JetBrains Mono)
- **Line height**: Generous spacing for readability

### Layout Structure
1. **Hero Section**
   - Large headline with emoji/icon
   - Catchy tagline
   - Quick value proposition
   - Prominent CTA buttons
   - Terminal/Code demo showcase

2. **Top Navigation**
   - Logo (left)
   - Main menu items (center)
   - Search icon
   - GitHub star button (right)
   - Sticky on scroll

3. **Content Sections**
   - Full-width containers
   - Alternating background colors
   - Icons for each feature
   - Code snippets with copy button
   - Responsive grid layout (1/2/3 columns)

4. **Documentation Sidebar** (docs pages)
   - Collapsible categories
   - Hierarchical structure
   - Active page highlight
   - Smooth scroll

5. **Footer**
   - Multi-column layout
   - Quick links
   - Social media icons
   - Copyright

### UI Components

#### Buttons
```css
/* Primary CTA */
background: linear-gradient(135deg, #ff6b35, #ff8c42);
border-radius: 8px;
padding: 12px 32px;
font-weight: 600;
box-shadow: 0 4px 12px rgba(255, 107, 53, 0.3);
transition: transform 0.2s;

/* Hover */
transform: translateY(-2px);
box-shadow: 0 6px 16px rgba(255, 107, 53, 0.4);
```

#### Cards
```css
background: #1a1a1a;
border: 1px solid #2a2a2a;
border-radius: 12px;
padding: 24px;
transition: all 0.3s;

/* Hover */
border-color: #ff6b35;
transform: translateY(-4px);
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
```

#### Code Blocks
```css
background: #0d1117;
border: 1px solid #30363d;
border-radius: 8px;
padding: 16px;
font-family: 'JetBrains Mono', monospace;
position: relative;

/* Copy button */
position: absolute;
top: 8px;
right: 8px;
opacity: 0.7;
transition: opacity 0.2s;
```

### Breadcrumbs
```html
<nav class="breadcrumb">
  <a href="/">Home</a>
  <span class="separator">›</span>
  <a href="/docs/">Documentation</a>
  <span class="separator">›</span>
  <span class="current">User Guide</span>
</nav>
```

```css
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #8b949e;
  margin-bottom: 24px;
}

.breadcrumb a {
  color: #58a6ff;
  text-decoration: none;
  transition: color 0.2s;
}

.breadcrumb a:hover {
  color: #ff6b35;
}

.breadcrumb .separator {
  color: #484f58;
}

.breadcrumb .current {
  color: #c9d1d9;
  font-weight: 500;
}
```

## 📐 ProofScan Adaptation

### Color Palette (ProofScan Version)
```css
:root {
  /* Primary - Indigo (ProofScan brand) */
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --primary-light: #818cf8;
  
  /* Secondary - Emerald (success/positive) */
  --secondary: #10b981;
  --secondary-hover: #059669;
  
  /* Accent - Amber (highlights) */
  --accent: #f59e0b;
  --accent-hover: #d97706;
  
  /* Dark theme (OpenClaw style) */
  --bg-dark: #0a0a0a;
  --bg-card: #1a1a1a;
  --bg-hover: #2a2a2a;
  --border: #2a2a2a;
  --border-hover: #6366f1;
  
  /* Text */
  --text-primary: #ffffff;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
}
```

### Key Design Elements for ProofScan

1. **Hero with Terminal Demo** (like OpenClaw)
   - Live typing animation
   - Syntax-highlighted output
   - Copy-to-clipboard button

2. **Feature Cards with Icons**
   - SVG icons or emoji
   - Gradient backgrounds on hover
   - Subtle animations

3. **Documentation Sidebar**
   - Sticky position
   - Collapsible categories
   - Search within docs
   - Progress indicator

4. **Breadcrumb Navigation**
   - All pages except homepage
   - Accessible (aria-labels)
   - SEO-friendly

5. **Search Bar** (global header)
   - Command-K shortcut
   - Fuzzy search
   - Recent searches

6. **Code Examples**
   - Multiple language tabs
   - Copy button
   - Line numbers (optional)
   - Dark theme optimized
